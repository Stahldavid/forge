import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestCanonical, sha256Digest } from "../../src/forge/agent-fabric/canonical.ts";
import { AgentFabricError } from "../../src/forge/agent-fabric/errors.ts";
import { LocalControlStore } from "../../src/forge/agent-fabric/local-control-store.ts";
import type {
  OwnerAuthorization, OwnerAuthorizationVerifier,
} from "../../src/forge/agent-fabric/types.ts";
import { PgliteAdapter } from "../../src/forge/runtime/db/pglite-adapter.ts";
import type { DbAdapter } from "../../src/forge/runtime/db/adapter.ts";

const rootExecutionId = "run:local-store";
const clock = { now: () => 1_000 };
const verifier: OwnerAuthorizationVerifier = {
  verify(_authorization, authorizationDigest) {
    return {
      verifierId: "local-store-test",
      authorizationDigest,
      evidenceDigest: sha256Digest(`owner:${authorizationDigest}`),
    };
  },
  verifyRecorded(authorization, verification) {
    const digest = digestCanonical(authorization, sha256Digest);
    return verification.verifierId === "local-store-test" &&
      verification.authorizationDigest === digest &&
      verification.evidenceDigest === sha256Digest(`owner:${digest}`);
  },
};

function authorization(suffix: string): OwnerAuthorization {
  return {
    authorizationId: `auth:${suffix}`, principalId: "owner:local",
    rootExecutionId, goalIds: [`goal:${suffix}`], subjectIds: ["worker:local"],
    capabilities: ["model.invoke"], sourceIds: ["source:local"],
    targetIds: ["target:ollama:local"], effectClasses: ["read", "bounded_external_inference"],
    notBefore: 1_000, expiresAt: 10_000, maximumAttempts: 2,
    maximumDelegationDepth: 0, resourceCeilings: {},
  };
}

async function withPglite(
  run: (adapter: PgliteAdapter, dataDir: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "forge-fabric-control-"));
  const adapter = new PgliteAdapter(join(directory, "data"));
  try {
    await run(adapter, join(directory, "data"));
  } finally {
    await adapter.close().catch(() => undefined);
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("local PGlite control store", () => {
  test("persists an acknowledged transition and validates it after restart", async () => {
    await withPglite(async (adapter, dataDir) => {
      const store = new LocalControlStore({ adapter, clock, ownerAuthorizationVerifier: verifier });
      const saved = await store.transition(rootExecutionId, (conductor) => {
        conductor.registerOwnerAuthorization(authorization("first"));
        return conductor.state().authorizations["auth:first"]?.authorizationId;
      });
      expect(saved.result).toBe("auth:first");
      expect(saved.events).toHaveLength(1);
      await store.close();

      const reopenedAdapter = new PgliteAdapter(dataDir);
      const reopened = new LocalControlStore({
        adapter: reopenedAdapter, clock, ownerAuthorizationVerifier: verifier,
      });
      try {
        expect(await reopened.readAll(rootExecutionId)).toEqual(saved.events);
        const next = await reopened.transition(rootExecutionId, (conductor) => {
          conductor.registerOwnerAuthorization(authorization("second"));
          return conductor.state().authorizations["auth:second"]?.authorizationId;
        });
        expect(next.result).toBe("auth:second");
        expect(next.events.map((event) => event.sequence)).toEqual([1, 2]);
      } finally {
        await reopened.close();
      }
    });
  });

  test("discards an in-memory transition that throws before commit", async () => {
    await withPglite(async (adapter) => {
      const store = new LocalControlStore({ adapter, clock, ownerAuthorizationVerifier: verifier });
      await expect(store.transition(rootExecutionId, (conductor) => {
        conductor.registerOwnerAuthorization(authorization("aborted"));
        throw new Error("stop before commit");
      })).rejects.toThrow("stop before commit");
      expect(await store.readAll(rootExecutionId)).toHaveLength(0);
    });
  });

  test("serializes concurrent transitions without losing either event", async () => {
    await withPglite(async (adapter) => {
      const store = new LocalControlStore({ adapter, clock, ownerAuthorizationVerifier: verifier });
      await Promise.all(["one", "two"].map((suffix) =>
        store.transition(rootExecutionId, (conductor) => {
          conductor.registerOwnerAuthorization(authorization(suffix));
        })));
      const events = await store.readAll(rootExecutionId);
      expect(events.map((event) => event.sequence)).toEqual([1, 2]);
      expect(events.map((event) => event.eventId)).toEqual([
        "event:owner-authorization:auth:one", "event:owner-authorization:auth:two",
      ]);
    });
  });

  test("reads committed state during an external call and blocks same-root transitions", async () => {
    await withPglite(async (adapter) => {
      const store = new LocalControlStore({ adapter, clock, ownerAuthorizationVerifier: verifier });
      let started!: () => void;
      let release!: () => void;
      const inFlight = new Promise<void>((resolve) => { started = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const running = store.runExternal(rootExecutionId, async (conductor) => {
        conductor.registerOwnerAuthorization(authorization("external"));
        started();
        await gate;
        return "done";
      });
      await inFlight;
      expect(await store.readAll(rootExecutionId)).toHaveLength(0);
      await expect(store.transition(rootExecutionId, (conductor) => {
        conductor.registerOwnerAuthorization(authorization("intruder"));
      })).rejects.toMatchObject({ code: "AF_CONFLICT" });
      release();
      expect((await running).result).toBe("done");
      expect((await store.readAll(rootExecutionId)).map((event) => event.sequence)).toEqual([1]);
      await store.close();
    });
  });

  test("rolls back a partial SQL batch and never acknowledges it", async () => {
    await withPglite(async (adapter) => {
      let inserts = 0;
      const failingAdapter: DbAdapter = {
        kind: "pglite",
        query: (sql, params) => adapter.query(sql, params),
        async begin() {
          const transaction = await adapter.begin();
          return {
            query(sql: string, params?: unknown[]) {
              if (sql.includes("INSERT INTO _forge_agent_fabric_control_events") && ++inserts === 2) {
                throw new Error("injected second insert failure");
              }
              return transaction.query(sql, params);
            },
            commit: () => transaction.commit(),
            rollback: () => transaction.rollback(),
          };
        },
        close: () => adapter.close(),
      };
      const store = new LocalControlStore({
        adapter: failingAdapter, clock, ownerAuthorizationVerifier: verifier,
      });
      await expect(store.transition(rootExecutionId, (conductor) => {
        conductor.registerOwnerAuthorization(authorization("one"));
        conductor.registerOwnerAuthorization(authorization("two"));
      })).rejects.toThrow("injected second insert failure");
      expect(await store.readAll(rootExecutionId)).toHaveLength(0);
    });
  });

  test("rejects tampered storage before exposing control state", async () => {
    await withPglite(async (adapter) => {
      const store = new LocalControlStore({ adapter, clock, ownerAuthorizationVerifier: verifier });
      await store.transition(rootExecutionId, (conductor) => {
        conductor.registerOwnerAuthorization(authorization("first"));
      });
      await adapter.query(
        "UPDATE _forge_agent_fabric_control_events SET envelope_json = $1 WHERE root_execution_id = $2",
        ["{}", rootExecutionId],
      );
      await expect(store.readAll(rootExecutionId)).rejects.toBeInstanceOf(AgentFabricError);
    });
  });
});
