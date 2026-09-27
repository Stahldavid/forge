import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestCanonical, sha256Digest } from "../../src/forge/agent-fabric/canonical.ts";
import {
  LocalEvolutionRegistry,
  type EvaluationCaseEvidence,
  type EvolutionRegistryOptions,
  type ExtensionCandidate,
  type FixedEvaluationSuite,
} from "../../src/forge/agent-fabric/local-evolution-registry.ts";
import { PgliteAdapter } from "../../src/forge/runtime/db/pglite-adapter.ts";

const suite: FixedEvaluationSuite = {
  suiteId: "coding-v1",
  caseIds: ["scope", "regression"],
  suiteDigest: digestCanonical({ suiteId: "coding-v1", caseIds: ["scope", "regression"] }, sha256Digest),
};

function candidate(name: string): ExtensionCandidate {
  return { extensionKey: "local-coder", artifactDigest: sha256Digest(`artifact:${name}`),
    manifestDigest: sha256Digest(`manifest:${name}`) };
}

const passing = (versionId: string): EvaluationCaseEvidence[] => [
  { caseId: "scope", passed: true, evidenceDigest: sha256Digest(`scope:${versionId}`) },
  { caseId: "regression", passed: true, evidenceDigest: sha256Digest(`regression:${versionId}`) },
];

function options(adapter: PgliteAdapter,
  evaluator: EvolutionRegistryOptions["evaluator"] = async (version) => passing(version.versionId),
  ownerAllowed = () => true): EvolutionRegistryOptions {
  return {
    adapter, suite, evaluator, now: () => 1_000,
    ownerVerifier: {
      async verify(challenge) {
        if (!ownerAllowed()) throw new Error("owner declined");
        const challengeDigest = digestCanonical(challenge, sha256Digest);
        return { verifierId: "local-owner-window", challengeDigest,
          evidenceDigest: sha256Digest(`owner:${challengeDigest}`) };
      },
    },
  };
}

async function withDatabase(run: (adapter: PgliteAdapter, path: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "forge-evolution-"));
  const data = join(directory, "data");
  const adapter = new PgliteAdapter(data);
  try { await run(adapter, data); }
  finally {
    await adapter.close().catch(() => undefined);
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("single-owner local evolution registry", () => {
  test("pins versions, evaluates fixed cases, selects through owner decisions, and retains old attempts", async () => {
    await withDatabase(async (adapter, data) => {
      const registry = new LocalEvolutionRegistry(options(adapter));
      const first = await registry.register(candidate("one"));
      expect((await registry.register(candidate("one"))).versionId).toBe(first.versionId);
      expect(first.versionId).toMatch(/^extension:sha256:[0-9a-f]{64}$/u);
      expect(await registry.selected("local-coder", "stable")).toBeNull();
      const firstEval = await registry.evaluate(first.versionId);
      expect(firstEval.state).toBe("passed");
      expect(firstEval.suiteDigest).toBe(suite.suiteDigest);
      await registry.decide("canary", first.versionId, null);
      expect(await registry.selected("local-coder", "canary")).toBe(first.versionId);
      await registry.decide("promote", first.versionId, null);
      const oldAttempt = await registry.bindAttempt("attempt:old", "local-coder", "stable");
      expect(oldAttempt.versionId).toBe(first.versionId);

      const second = await registry.register(candidate("two"));
      await registry.evaluate(second.versionId);
      await expect(registry.decide("rollback", second.versionId, first.versionId))
        .rejects.toMatchObject({ code: "AF_CONFLICT" });
      await registry.decide("promote", second.versionId, first.versionId);
      expect((await registry.bindAttempt("attempt:new", "local-coder", "stable")).versionId)
        .toBe(second.versionId);
      await registry.decide("rollback", first.versionId, second.versionId);
      expect(await registry.selected("local-coder", "stable")).toBe(first.versionId);
      await registry.decide("revoke", first.versionId, first.versionId);
      expect(await registry.selected("local-coder", "stable")).toBeNull();
      expect(await registry.selected("local-coder", "canary")).toBeNull();
      await expect(registry.bindAttempt("attempt:blocked", "local-coder", "stable"))
        .rejects.toMatchObject({ code: "AF_CONFLICT" });
      expect((await registry.getAttempt("attempt:old"))?.versionId).toBe(first.versionId);
      await expect(registry.bindAttempt("attempt:old", "local-coder", "stable"))
        .rejects.toMatchObject({ code: "AF_CONFLICT" });

      await adapter.close();
      const reopenedAdapter = new PgliteAdapter(data);
      try {
        const reopened = new LocalEvolutionRegistry(options(reopenedAdapter));
        expect((await reopened.getVersion(first.versionId))?.artifactDigest).toBe(first.artifactDigest);
        expect((await reopened.getEvaluation(first.versionId))?.evidenceDigest).toBe(firstEval.evidenceDigest);
        expect((await reopened.getAttempt("attempt:old"))?.versionId).toBe(first.versionId);
        expect(await reopened.selected("local-coder", "stable")).toBeNull();
      } finally { await reopenedAdapter.close(); }
    });
  });

  test("failed, malformed, and interrupted evaluations cannot promote", async () => {
    await withDatabase(async (adapter) => {
      const failing = new LocalEvolutionRegistry(options(adapter, async (version) => [
        passing(version.versionId)[0]!,
        { caseId: "regression", passed: false, evidenceDigest: sha256Digest("regression-failed") },
      ]));
      const failed = await failing.register(candidate("failed"));
      expect((await failing.evaluate(failed.versionId)).state).toBe("failed");
      await expect(failing.decide("promote", failed.versionId, null))
        .rejects.toMatchObject({ code: "AF_CONFLICT" });
      expect(await failing.selected("local-coder", "stable")).toBeNull();

      const malformed = new LocalEvolutionRegistry(options(adapter, async () => [
        { caseId: "wrong", passed: true, evidenceDigest: sha256Digest("wrong") },
      ]));
      const bad = await malformed.register(candidate("malformed"));
      expect((await malformed.evaluate(bad.versionId)).state).toBe("inconclusive");
      await expect(malformed.decide("canary", bad.versionId, null))
        .rejects.toMatchObject({ code: "AF_CONFLICT" });

      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const entered = new Promise<void>((resolve) => { started = resolve; });
      const interrupted = new LocalEvolutionRegistry(options(adapter, async () => {
        started(); await gate; throw new Error("runner unavailable");
      }));
      const pending = await interrupted.register(candidate("pending"));
      const evaluation = interrupted.evaluate(pending.versionId);
      await entered;
      expect((await interrupted.getEvaluation(pending.versionId))?.state).toBe("running");
      await expect(interrupted.decide("promote", pending.versionId, null))
        .rejects.toMatchObject({ code: "AF_CONFLICT" });
      release();
      expect((await evaluation).state).toBe("inconclusive");
    });
  });

  test("stale selection and missing owner verification cannot change state", async () => {
    await withDatabase(async (adapter) => {
      let allowed = false;
      const registry = new LocalEvolutionRegistry(options(adapter, undefined, () => allowed));
      const version = await registry.register(candidate("owner"));
      await registry.evaluate(version.versionId);
      await expect(registry.decide("promote", version.versionId, null)).rejects.toThrow("owner declined");
      expect(await registry.selected("local-coder", "stable")).toBeNull();
      allowed = true;
      await registry.decide("promote", version.versionId, null);
      await expect(registry.decide("promote", version.versionId, null))
        .rejects.toMatchObject({ code: "AF_CONFLICT" });
      await expect(registry.decide("rollback", version.versionId, null))
        .rejects.toMatchObject({ code: "AF_CONFLICT" });
    });
  });

  test("invalid suite digest is rejected at construction", async () => {
    await withDatabase(async (adapter) => {
      expect(() => new LocalEvolutionRegistry({ ...options(adapter),
        suite: { ...suite, suiteDigest: sha256Digest("wrong") } }))
        .toThrow("Invalid fixed evaluation suite");
    });
  });
});
