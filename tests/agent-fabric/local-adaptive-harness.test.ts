import { describe, expect, test } from "bun:test";
import {
  ForgeAgentConductor, MemoryControlJournal, ResourceLedger,
  sha256Digest, type Clock, type GoalContract,
  type OwnerAuthorization, type OwnerAuthorizationVerifier,
} from "../../src/forge/agent-fabric/index.ts";
import {
  LocalAdaptiveHarness, compileLocalAdaptiveRevision,
} from "../../src/forge/agent-fabric/local-adaptive-harness.ts";
import { LocalAdaptiveProcessAdapter } from "../../src/forge/agent-fabric/local-adaptive-worker.ts";
import { executeP0aActivity } from "../../src/forge/agent-fabric/p0a.ts";

class ManualClock implements Clock {
  constructor(private value = 1_000) {}
  now(): number { return this.value; }
  advance(ms: number): void { this.value += ms; }
}

const verifier: OwnerAuthorizationVerifier = {
  verify(_authorization, authorizationDigest) {
    return {
      verifierId: "local-harness-test/v1", authorizationDigest,
      evidenceDigest: sha256Digest("owner-presence-fixture"),
    };
  },
  verifyRecorded(_authorization, record) {
    return record.verifierId === "local-harness-test/v1" &&
      record.evidenceDigest === sha256Digest("owner-presence-fixture");
  },
};

function fixture(parentAttempts = 3, workers = 2, globalWorkerCapacity = 2) {
  const clock = new ManualClock();
  const journal = new MemoryControlJournal();
  const ledger = new ResourceLedger([{ resource: "workers", semantics: "capacity", limit: globalWorkerCapacity }]);
  const conductor = new ForgeAgentConductor(
    "run:local", journal, clock, sha256Digest, verifier, ledger,
  );
  const authorization: OwnerAuthorization = {
    authorizationId: "auth:local", principalId: "owner:local", rootExecutionId: "run:local",
    goalIds: ["goal:local"],
    subjectIds: ["fabric.local.coordinator", "fabric.local.inventory", "fabric.local.constraints"],
    capabilities: ["fabric.local.read"], sourceIds: ["source:repo"],
    targetIds: ["target:report"], effectClasses: ["read"],
    notBefore: 1_000, expiresAt: 10_000, maximumAttempts: 3,
    maximumDelegationDepth: 1, resourceCeilings: { workers: 2 },
  };
  const goal: GoalContract = {
    goalId: "goal:local", revision: 1, authorityInvocationId: authorization.authorizationId,
    objectives: ["coordinate fixed local workers"], nonObjectives: ["run commands"],
    acceptanceCriteria: ["both child outcomes and join"],
    allowedEffectClasses: ["read"], prohibitedEffectClasses: ["consequential"],
    sourceBoundary: { sourceIds: ["source:repo"], allowExpansion: false },
  };
  conductor.registerOwnerAuthorization(authorization);
  conductor.registerGoal(goal);
  const revision = compileLocalAdaptiveRevision("run:local", goal.goalId, "plan:local");
  conductor.activatePlan(revision, null);
  conductor.registerGrant({
    grantId: "grant:coordinator", rootAuthorizationId: authorization.authorizationId,
    subjectId: "fabric.local.coordinator", parentGrantId: null,
    capabilities: ["fabric.local.read"], sourceIds: ["source:repo"],
    targetIds: ["target:report"], effectClasses: ["read"],
    notBefore: 1_000, expiresAt: 9_000, maximumAttempts: parentAttempts,
    delegationDepthRemaining: 1, resourceCeilings: { workers },
  });
  const harness = new LocalAdaptiveHarness({
    conductor, clock, rootExecutionId: "run:local", revisionId: revision.revisionId,
    parentGrantId: "grant:coordinator", sourceId: "source:repo", targetId: "target:report",
    inventory: "src/a.ts", constraints: "read only",
  });
  return { harness, conductor, clock, journal, ledger };
}

describe("fixed local adaptive harness", () => {
  test("two real bounded worker processes return verified digests before join", async () => {
    const { harness, conductor } = fixture();
    const result = await harness.run();
    expect(result.children.inventory.status).toBe("succeeded");
    expect(result.children.constraints.status).toBe("succeeded");
    expect(result.workerPids.inventory).toBeNumber();
    expect(result.workerPids.constraints).toBeNumber();
    expect(result.workerPids.inventory).not.toBe(process.pid);
    expect(result.workerPids.constraints).not.toBe(process.pid);
    expect(result.workerPids.inventory).not.toBe(result.workerPids.constraints);
    expect(result.join.status).toBe("succeeded");
    expect(Object.keys(conductor.state().outcomes)).toHaveLength(3);
  });

  test("cancellation prevents a process result from authorizing the join", async () => {
    const { harness, conductor } = fixture();
    const abort = new AbortController();
    const running = harness.run(abort.signal);
    abort.abort();
    const result = await running;
    expect(result.join).toEqual({ status: "blocked", reason: "incomplete_or_failed_child" });
    expect(Object.values(conductor.state().outcomes).some((outcome) => outcome.intentId.endsWith(":join"))).toBe(false);
  });

  test("a nonzero worker exit commits failure and blocks the join", async () => {
    const { harness, conductor, clock } = fixture();
    const permits = harness.prepare();
    // Deliberately bypass the harness input bound to exercise the child failure path.
    const worker = new LocalAdaptiveProcessAdapter("inventory", "x".repeat(257), clock);
    const child = await executeP0aActivity({ conductor, adapter: worker, permit: permits.inventory });
    expect(child.status).toBe("failed");
    expect(harness.join()).toEqual({ status: "blocked", reason: "incomplete_or_failed_child" });
  });

  test("two attenuated workers join only after authoritative bounded results", () => {
    const { harness, conductor } = fixture();
    const permits = harness.prepare();
    const state = conductor.state();
    for (const role of ["inventory", "constraints"] as const) {
      const child = state.grants[permits[role].grantId];
      expect(child.parentGrantId).toBe("grant:coordinator");
      expect(child.maximumAttempts).toBe(1);
      expect(child.delegationDepthRemaining).toBe(0);
      expect(child.effectClasses).toEqual(["read"]);
    }
    expect(conductor.state().resourceReserved.workers).toBe(2);
    expect(harness.join()).toEqual({ status: "blocked", reason: "incomplete_or_failed_child" });
    harness.complete("inventory");
    expect(harness.join().status).toBe("blocked");
    harness.complete("constraints");
    const joined = harness.join();
    expect(joined.status).toBe("succeeded");
    if (joined.status !== "succeeded") throw new Error("join should succeed");
    expect(joined.outcome.status).toBe("succeeded");
    expect(conductor.state().outcomes[joined.outcome.attemptId].reportDigest).toBe(joined.outcome.reportDigest);
    expect(Object.keys(conductor.state().outcomes)).toHaveLength(3);
  });

  test("expired worker lease cannot produce a child or join outcome", () => {
    const { harness, conductor, clock } = fixture();
    harness.prepare();
    clock.advance(1_001);
    expect(() => harness.complete("inventory")).toThrow();
    expect(harness.join()).toEqual({ status: "blocked", reason: "incomplete_or_failed_child" });
    expect(Object.keys(conductor.state().outcomes)).toHaveLength(0);
  });

  test("over-budget parent cannot mint child grants", () => {
    const { harness, conductor } = fixture(2);
    expect(() => harness.prepare()).toThrow();
    expect(Object.keys(conductor.state().grants)).toHaveLength(1);
    expect(Object.keys(conductor.state().outcomes)).toHaveLength(0);
  });

  test("exhausted worker capacity never creates a join outcome", () => {
    const { harness, conductor } = fixture(3, 2, 1);
    expect(() => harness.prepare()).toThrow();
    expect(Object.values(conductor.state().outcomes).some((outcome) => outcome.intentId.endsWith(":join"))).toBe(false);
  });

  test("failed child blocks join and cannot become success", () => {
    const { harness, conductor } = fixture();
    harness.prepare();
    harness.complete("inventory");
    harness.complete("constraints", true);
    expect(harness.join()).toEqual({ status: "blocked", reason: "incomplete_or_failed_child" });
    expect(Object.values(conductor.state().outcomes).some((outcome) => outcome.intentId.endsWith(":join"))).toBe(false);
  });

  test("rejects oversized data before any authority transition", () => {
    const { conductor, clock } = fixture();
    expect(() => new LocalAdaptiveHarness({
      conductor, clock, rootExecutionId: "run:local", revisionId: "plan:local",
      parentGrantId: "grant:coordinator", sourceId: "source:repo", targetId: "target:report",
      inventory: "x".repeat(257), constraints: "short",
    })).toThrow();
    expect(Object.keys(conductor.state().grants)).toHaveLength(1);
  });
});
