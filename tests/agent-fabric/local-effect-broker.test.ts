import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPgliteAdapter } from "../../src/forge/runtime/db/pglite-adapter.ts";
import {
  LocalEffectBroker, type LocalArtifactEffectRequest, type LocalEffectAuthorization,
  type LocalEffectBoundary,
} from "../../src/forge/agent-fabric/local-effect-broker.ts";
import type { Digest } from "../../src/forge/agent-fabric/types.ts";

const digest = (character: string): Digest => `sha256:${character.repeat(64)}` as Digest;
const request: LocalArtifactEffectRequest = {
  kind: "immutable_local_artifact_v1", taskId: `task:${"a".repeat(64)}`,
  subjectDigest: digest("b"), content: "reviewed local artifact",
};
const roots: string[] = [];

async function fixture(boundary?: LocalEffectBoundary) {
  const root = await mkdtemp(join(tmpdir(), "forge-local-effect-"));
  roots.push(root);
  const adapter = await createPgliteAdapter(join(root, "pglite"));
  let verifications = 0;
  const makeBroker = (onBoundary?: LocalEffectBoundary) => new LocalEffectBroker({
    adapter, repositoryRoot: root, ownerId: "local-owner",
    verifyOwner: () => { verifications += 1; return true; },
    ...(onBoundary ? { onBoundary: (point: LocalEffectBoundary) => {
      if (point === onBoundary) throw new Error(`simulated crash at ${point}`);
    } } : {}),
  });
  const broker = makeBroker(boundary);
  const expiresAt = Date.now() + 60_000;
  const challenge = broker.prepare(request, expiresAt);
  const authorization: LocalEffectAuthorization = {
    ownerId: "local-owner", challengeDigest: challenge.challengeDigest,
    expiresAt, proof: "trusted-local-owner-proof",
  };
  return { root, adapter, broker, makeBroker, challenge, authorization,
    verifications: () => verifications };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("local consequential effect broker", () => {
  test("rejects non-artifact effects, arbitrary targets, oversized content and wrong owner binding", async () => {
    const f = await fixture();
    try {
      expect(() => f.broker.prepare({ ...request, kind: "shell" }, Date.now() + 10_000)).toThrow();
      expect(() => f.broker.prepare({ ...request, command: "git push" }, Date.now() + 10_000)).toThrow();
      expect(() => f.broker.prepare({ ...request, target: "../../outside" }, Date.now() + 10_000)).toThrow();
      expect(() => f.broker.prepare({ ...request, content: "a".repeat(4097) }, Date.now() + 10_000)).toThrow();
      await expect(f.broker.dispatch(request, { ...f.authorization, ownerId: "agent" })).rejects.toThrow();
      await expect(f.broker.dispatch(request, { ...f.authorization, challengeDigest: digest("c") })).rejects.toThrow();
      await expect(f.broker.dispatch(request, { ...f.authorization, expiresAt: Date.now() - 1 })).rejects.toThrow();
      expect(f.verifications()).toBe(0);
      expect((await f.broker.inspect(f.challenge.requestDigest)).state).toBe("not_dispatched");
    } finally {
      await f.adapter.close();
    }
  });

  test("commits intent before bounded materialization, then verifies disk and persists receipt", async () => {
    const f = await fixture();
    try {
      const result = await f.broker.dispatch(request, f.authorization);
      expect(result.state).toBe("receipted");
      if (result.state !== "receipted") throw new Error("missing receipt");
      expect(result.receipt.artifactDigest).toBe(f.challenge.artifactDigest);
      expect(result.receipt.readbackDigest).toBe(f.challenge.artifactDigest);
      expect(f.challenge.request).toEqual(request);
      expect(f.challenge.repositoryRoot).toBe(f.root);
      const path = join(f.root, ".forge", "local", "agent-fabric", "effects",
        `${f.challenge.requestDigest.slice(7)}.json`);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
        version: 1, taskId: request.taskId, subjectDigest: request.subjectDigest,
        content: request.content,
      });
      const replay = await f.broker.dispatch(request, f.authorization);
      expect(replay).toEqual(result);
      expect(f.verifications()).toBe(1);
      await writeFile(path, "tampered");
      expect((await f.broker.reconcile(f.challenge.requestDigest)).state).toBe("receipt_mismatch");
    } finally {
      await f.adapter.close();
    }
  });

  test.each(["after_intent", "after_open", "after_write", "after_readback", "after_receipt"] as LocalEffectBoundary[])(
    "restart after %s never redispatches an uncertain effect", async (boundary) => {
      const f = await fixture(boundary);
      try {
        await expect(f.broker.dispatch(request, f.authorization)).rejects.toThrow("simulated crash");
        const expected = boundary === "after_intent" ? "receipt_unknown"
          : boundary === "after_open" ? "incomplete_materialization"
          : boundary === "after_receipt" ? "receipted" : "materialized_without_receipt";
        expect((await f.broker.inspect(f.challenge.requestDigest)).state).toBe(expected);
        await f.adapter.close();
        const reopened = await createPgliteAdapter(join(f.root, "pglite"));
        const second = new LocalEffectBroker({
          adapter: reopened, repositoryRoot: f.root, ownerId: "local-owner",
          verifyOwner: () => { throw new Error("replay must not seek approval"); },
        });
        expect((await second.dispatch(request, f.authorization)).state).toBe(expected);
        expect((await second.reconcile(f.challenge.requestDigest)).state).toBe(expected);
        expect(f.verifications()).toBe(1);
        await reopened.close();
      } finally {
        await f.adapter.close().catch(() => undefined);
      }
    },
  );

  test("changed request cannot replay approval; invalid proof does not commit intent", async () => {
    const f = await fixture();
    try {
      await expect(f.broker.dispatch({ ...request, content: "changed" }, f.authorization)).rejects.toThrow();
      expect((await f.broker.inspect(f.challenge.requestDigest)).state).toBe("not_dispatched");
      const denied = new LocalEffectBroker({
        adapter: f.adapter, repositoryRoot: f.root, ownerId: "local-owner",
        verifyOwner: () => false,
      });
      await expect(denied.dispatch(request, f.authorization)).rejects.toThrow();
      expect((await denied.inspect(f.challenge.requestDigest)).state).toBe("not_dispatched");
    } finally {
      await f.adapter.close();
    }
  });

  test("authorization that expires during asynchronous owner verification cannot create an intent", async () => {
    const f = await fixture();
    try {
      let clock = 1_000;
      const broker = new LocalEffectBroker({
        adapter: f.adapter, repositoryRoot: f.root, ownerId: "local-owner",
        now: () => clock,
        verifyOwner: async () => { clock = 2_000; return true; },
      });
      const challenge = broker.prepare(request, 1_500);
      await expect(broker.dispatch(request, {
        ownerId: "local-owner", challengeDigest: challenge.challengeDigest,
        expiresAt: 1_500, proof: "trusted-local-owner-proof",
      })).rejects.toThrow("expired");
      expect((await broker.inspect(challenge.requestDigest)).state).toBe("not_dispatched");
    } finally {
      await f.adapter.close();
    }
  });

  test("concurrent requests resolve to one intent and one immutable artifact", async () => {
    const f = await fixture();
    try {
      const second = f.makeBroker();
      const outcomes = await Promise.all([
        f.broker.dispatch(request, f.authorization),
        second.dispatch(request, f.authorization),
      ]);
      expect(outcomes.every((outcome) => outcome.state !== "not_dispatched")).toBe(true);
      const count = await f.adapter.query(
        "SELECT COUNT(*)::int AS count FROM _forge_agent_fabric_local_effects",
      );
      expect(count.rows[0]?.count).toBe(1);
      expect((await f.broker.inspect(f.challenge.requestDigest)).state).toBe("receipted");
    } finally {
      await f.adapter.close();
    }
  });
});
