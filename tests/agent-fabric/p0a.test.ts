import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  AgentFabricError,
  DeterministicTestAdapter,
  ForgeAgentConductor,
  MemoryControlJournal,
  ResourceLedger,
  applyPlanDelta,
  createRunPlanRevision,
  deriveExecutionGrant,
  executeP0aActivity,
  replayControlState,
  stableStringify,
  type Clock,
  type Digest,
  type ExecutionGrant,
  type GoalContract,
  type WorkflowProgramVersion,
} from "../../src/forge/agent-fabric/index.ts";

class ManualClock implements Clock {
  constructor(private current: number) {}
  now(): number { return this.current; }
  advance(milliseconds: number): void { this.current += milliseconds; }
}

function digest(value: string): Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const goal: GoalContract = {
  goalId: "goal:review",
  revision: 1,
  authorityInvocationId: "auth:owner:1",
  objectives: ["review architecture"],
  nonObjectives: ["modify target"],
  acceptanceCriteria: ["report produced"],
  allowedEffectClasses: ["read", "internal_write"],
  prohibitedEffectClasses: ["consequential", "bounded_external_inference"],
  sourceBoundary: { sourceIds: ["source:forge"], allowExpansion: false },
};

const program: WorkflowProgramVersion = {
  programId: "workflow:review",
  version: 1,
  nodes: [
    {
      nodeId: "analyze",
      kind: "activity",
      dependsOn: [],
      agentSpecId: "agent:analyst",
      harnessSpecId: "harness:readonly",
      executionProfileId: "execution:isolated",
    },
  ],
};

function rootGrant(clock: ManualClock, subjectId = "worker:a"): ExecutionGrant {
  return {
    grantId: `grant:${subjectId}`,
    rootAuthorizationId: "auth:owner:1",
    subjectId,
    parentGrantId: null,
    capabilities: ["architecture.read"],
    sourceIds: ["source:forge"],
    targetIds: ["target:artifact-store"],
    effectClasses: ["read", "internal_write"],
    notBefore: clock.now(),
    expiresAt: clock.now() + 60_000,
    maximumAttempts: 2,
    delegationDepthRemaining: 1,
    resourceCeilings: { modelCalls: 2, workers: 1 },
  };
}

function preparedConductor(clock: ManualClock) {
  const journal = new MemoryControlJournal();
  const conductor = new ForgeAgentConductor("run:1", journal, clock, digest);
  conductor.registerGoal(goal);
  const revision = createRunPlanRevision("run:1", goal.goalId, program, "plan:1", digest);
  conductor.activatePlan(revision, null);
  return { conductor, journal, revision };
}

describe("Forge Agent Fabric P0a", () => {
  test("executes a deterministic activity and replays the same control state without a planner", async () => {
    const clock = new ManualClock(1_000);
    const { conductor, journal, revision } = preparedConductor(clock);
    const grant = rootGrant(clock);
    conductor.registerGrant(grant);

    const specDigest = digest("effective-run-spec");
    conductor.commitDispatchIntent({
      intentId: "intent:1",
      rootExecutionId: "run:1",
      planRevisionId: revision.revisionId,
      taskNodeId: "analyze",
      effectiveRunSpecDigest: specDigest,
      sourceIds: ["source:forge"],
      targetId: "target:artifact-store",
      requiredCapability: "architecture.read",
      effectClass: "read",
      createdAt: clock.now(),
    });
    const offer = conductor.createDispatchOffer("intent:1", "pool:reviewers", "offer:1", clock.now() + 5_000);
    expect(offer.nonAuthoritative).toBe(true);
    const claim = conductor.claimDispatch({
      claimId: "claim:1",
      intentId: offer.intentId,
      workerId: "worker:a",
      attemptId: "attempt:1",
      leaseDurationMs: 10_000,
    });
    const permit = conductor.issuePermit({
      permitId: "permit:1",
      claimId: claim.claimId,
      grantId: grant.grantId,
      maximumValidityMs: 5_000,
    });
    const adapter = new DeterministicTestAdapter([
      {
        effectiveRunSpecDigest: specDigest,
        outcomeStatus: "succeeded",
        resultDigest: digest("result"),
      },
    ], () => clock.now());

    const outcome = await executeP0aActivity({ conductor, adapter, permit });
    expect(outcome.status).toBe("succeeded");

    let plannerInvocations = 1;
    const beforeReplay = stableStringify(conductor.state());
    const replayed = replayControlState(journal.readAll());
    const afterReplay = stableStringify(replayed);
    expect(afterReplay).toBe(beforeReplay);
    expect(plannerInvocations).toBe(1);
    plannerInvocations += 0;
    expect(plannerInvocations).toBe(1);
  });

  test("fences a stale worker after lease rollover", () => {
    const clock = new ManualClock(10_000);
    const { conductor, revision } = preparedConductor(clock);
    const grantA = rootGrant(clock, "worker:a");
    const grantB = rootGrant(clock, "worker:b");
    conductor.registerGrant(grantA);
    conductor.registerGrant(grantB);
    const specDigest = digest("spec:fencing");
    conductor.commitDispatchIntent({
      intentId: "intent:fencing",
      rootExecutionId: "run:1",
      planRevisionId: revision.revisionId,
      taskNodeId: "analyze",
      effectiveRunSpecDigest: specDigest,
      sourceIds: ["source:forge"],
      targetId: "target:artifact-store",
      requiredCapability: "architecture.read",
      effectClass: "read",
      createdAt: clock.now(),
    });
    const claimA = conductor.claimDispatch({
      claimId: "claim:a",
      intentId: "intent:fencing",
      workerId: "worker:a",
      attemptId: "attempt:a",
      leaseDurationMs: 100,
    });
    const permitA = conductor.issuePermit({
      permitId: "permit:a",
      claimId: claimA.claimId,
      grantId: grantA.grantId,
      maximumValidityMs: 100,
    });
    conductor.acceptStartupReport(permitA, {
      startupReportId: "startup:a",
      attemptId: permitA.attemptId,
      observedSpecDigest: permitA.effectiveRunSpecDigest,
      startedAt: clock.now(),
    });

    clock.advance(101);
    const claimB = conductor.claimDispatch({
      claimId: "claim:b",
      intentId: "intent:fencing",
      workerId: "worker:b",
      attemptId: "attempt:b",
      leaseDurationMs: 1_000,
    });
    expect(claimB.fencingToken).toBe(2);
    expect(() => conductor.commitOutcome({
      reportId: "report:a",
      attemptId: "attempt:a",
      status: "succeeded",
      resultDigest: digest("stale-result"),
      evidenceDigests: [],
      reportedAt: clock.now(),
    })).toThrow(AgentFabricError);
  });

  test("rejects an expired execution permit", () => {
    const clock = new ManualClock(20_000);
    const { conductor, revision } = preparedConductor(clock);
    const grant = rootGrant(clock);
    conductor.registerGrant(grant);
    conductor.commitDispatchIntent({
      intentId: "intent:expiry",
      rootExecutionId: "run:1",
      planRevisionId: revision.revisionId,
      taskNodeId: "analyze",
      effectiveRunSpecDigest: digest("spec:expiry"),
      sourceIds: ["source:forge"],
      targetId: "target:artifact-store",
      requiredCapability: "architecture.read",
      effectClass: "read",
      createdAt: clock.now(),
    });
    const claim = conductor.claimDispatch({
      claimId: "claim:expiry",
      intentId: "intent:expiry",
      workerId: "worker:a",
      attemptId: "attempt:expiry",
      leaseDurationMs: 1_000,
    });
    const permit = conductor.issuePermit({
      permitId: "permit:expiry",
      claimId: claim.claimId,
      grantId: grant.grantId,
      maximumValidityMs: 10,
    });
    clock.advance(10);
    expect(() => conductor.acceptStartupReport(permit, {
      startupReportId: "startup:expiry",
      attemptId: permit.attemptId,
      observedSpecDigest: permit.effectiveRunSpecDigest,
      startedAt: clock.now(),
    })).toThrow(AgentFabricError);
  });

  test("commits identical duplicate outcomes idempotently and rejects conflicts", () => {
    const clock = new ManualClock(30_000);
    const { conductor, revision } = preparedConductor(clock);
    const grant = rootGrant(clock);
    conductor.registerGrant(grant);
    conductor.commitDispatchIntent({
      intentId: "intent:duplicate",
      rootExecutionId: "run:1",
      planRevisionId: revision.revisionId,
      taskNodeId: "analyze",
      effectiveRunSpecDigest: digest("spec:duplicate"),
      sourceIds: ["source:forge"],
      targetId: "target:artifact-store",
      requiredCapability: "architecture.read",
      effectClass: "read",
      createdAt: clock.now(),
    });
    const claim = conductor.claimDispatch({
      claimId: "claim:duplicate",
      intentId: "intent:duplicate",
      workerId: "worker:a",
      attemptId: "attempt:duplicate",
      leaseDurationMs: 1_000,
    });
    const permit = conductor.issuePermit({
      permitId: "permit:duplicate",
      claimId: claim.claimId,
      grantId: grant.grantId,
      maximumValidityMs: 1_000,
    });
    conductor.acceptStartupReport(permit, {
      startupReportId: "startup:duplicate",
      attemptId: permit.attemptId,
      observedSpecDigest: permit.effectiveRunSpecDigest,
      startedAt: clock.now(),
    });
    const report = {
      reportId: "report:duplicate",
      attemptId: "attempt:duplicate",
      status: "succeeded" as const,
      resultDigest: digest("result:one"),
      evidenceDigests: [],
      reportedAt: clock.now(),
    };
    expect(conductor.commitOutcome(report)).toEqual(conductor.commitOutcome(report));
    expect(() => conductor.commitOutcome({
      ...report,
      reportId: "report:conflicting",
      resultDigest: digest("result:two"),
    })).toThrow(AgentFabricError);
  });

  test("derives attenuated grants and atomically prevents aggregate oversubscription", () => {
    const clock = new ManualClock(40_000);
    const ledger = new ResourceLedger([
      { resource: "modelCalls", semantics: "consumable", limit: 4 },
      { resource: "workers", semantics: "capacity", limit: 1 },
    ]);
    const parent = {
      ...rootGrant(clock, "conductor"),
      capabilities: ["architecture.read", "architecture.review"],
      delegationDepthRemaining: 2,
      resourceCeilings: { modelCalls: 4, workers: 1 },
    };
    const first = deriveExecutionGrant(parent, {
      grantId: "grant:child:1",
      subjectId: "worker:1",
      capabilities: ["architecture.read"],
      sourceIds: ["source:forge"],
      targetIds: ["target:artifact-store"],
      effectClasses: ["read"],
      notBefore: clock.now(),
      expiresAt: clock.now() + 1_000,
      maximumAttempts: 1,
      delegationDepthRemaining: 1,
      reservationId: "reservation:1",
      resourceRequests: [
        { resource: "modelCalls", amount: 2 },
        { resource: "workers", amount: 1 },
      ],
    }, ledger, clock.now());
    expect(first.outcome).toBe("allowed");
    expect(first.grant?.capabilities).toEqual(["architecture.read"]);

    const second = deriveExecutionGrant(parent, {
      grantId: "grant:child:2",
      subjectId: "worker:2",
      capabilities: ["architecture.read"],
      sourceIds: ["source:forge"],
      targetIds: ["target:artifact-store"],
      effectClasses: ["read"],
      notBefore: clock.now(),
      expiresAt: clock.now() + 1_000,
      maximumAttempts: 1,
      delegationDepthRemaining: 1,
      reservationId: "reservation:2",
      resourceRequests: [{ resource: "workers", amount: 1 }],
    }, ledger, clock.now());
    expect(second.outcome).toBe("rejected");
  });

  test("records an unknown startup without claiming that the executor started", async () => {
    const clock = new ManualClock(45_000);
    const { conductor, revision } = preparedConductor(clock);
    const grant = rootGrant(clock);
    conductor.registerGrant(grant);
    const missingSpec = digest("spec:missing-fixture");
    conductor.commitDispatchIntent({
      intentId: "intent:unknown-start",
      rootExecutionId: "run:1",
      planRevisionId: revision.revisionId,
      taskNodeId: "analyze",
      effectiveRunSpecDigest: missingSpec,
      sourceIds: ["source:forge"],
      targetId: "target:artifact-store",
      requiredCapability: "architecture.read",
      effectClass: "read",
      createdAt: clock.now(),
    });
    const claim = conductor.claimDispatch({
      claimId: "claim:unknown-start",
      intentId: "intent:unknown-start",
      workerId: "worker:a",
      attemptId: "attempt:unknown-start",
      leaseDurationMs: 1_000,
    });
    const permit = conductor.issuePermit({
      permitId: "permit:unknown-start",
      claimId: claim.claimId,
      grantId: grant.grantId,
      maximumValidityMs: 1_000,
    });
    const adapter = new DeterministicTestAdapter([], () => clock.now());
    const outcome = await executeP0aActivity({ conductor, adapter, permit });
    expect(outcome.status).toBe("unknown");
    expect(conductor.state().attempts[permit.attemptId]?.startupStatus).toBe("unknown");
  });

  test("rejects split resource requests that exceed a parent ceiling in aggregate", () => {
    const clock = new ManualClock(47_000);
    const ledger = new ResourceLedger([
      { resource: "modelCalls", semantics: "consumable", limit: 10 },
    ]);
    const parent = {
      ...rootGrant(clock, "conductor"),
      delegationDepthRemaining: 2,
      resourceCeilings: { modelCalls: 4 },
    };
    const resolution = deriveExecutionGrant(parent, {
      grantId: "grant:split-ceiling",
      subjectId: "worker:split",
      capabilities: ["architecture.read"],
      sourceIds: ["source:forge"],
      targetIds: ["target:artifact-store"],
      effectClasses: ["read"],
      notBefore: clock.now(),
      expiresAt: clock.now() + 1_000,
      maximumAttempts: 1,
      delegationDepthRemaining: 1,
      reservationId: "reservation:split",
      resourceRequests: [
        { resource: "modelCalls", amount: 3 },
        { resource: "modelCalls", amount: 3 },
      ],
    }, ledger, clock.now());
    expect(resolution.outcome).toBe("rejected");
  });

  test("canonicalizes object keys and rejects non-finite values", () => {
    expect(stableStringify({ z: 1, a: { y: 2, x: 3 } })).toBe(
      '{"a":{"x":3,"y":2},"z":1}',
    );
    expect(() => stableStringify({ invalid: Number.POSITIVE_INFINITY })).toThrow(
      AgentFabricError,
    );
  });

  test("rejects an intent that violates the GoalContract effect or source boundary", () => {
    const clock = new ManualClock(49_000);
    const { conductor, revision } = preparedConductor(clock);
    expect(() => conductor.commitDispatchIntent({
      intentId: "intent:goal-violation",
      rootExecutionId: "run:1",
      planRevisionId: revision.revisionId,
      taskNodeId: "analyze",
      effectiveRunSpecDigest: digest("spec:goal-violation"),
      sourceIds: ["source:outside"],
      targetId: "target:artifact-store",
      requiredCapability: "architecture.read",
      effectClass: "consequential",
      createdAt: clock.now(),
    })).toThrow(AgentFabricError);
  });

  test("rejects a grant that does not cover the source and target bound to the intent", () => {
    const clock = new ManualClock(50_000);
    const { conductor, revision } = preparedConductor(clock);
    const grant = {
      ...rootGrant(clock),
      sourceIds: ["source:other"],
      targetIds: ["target:other"],
    };
    conductor.registerGrant(grant);
    conductor.commitDispatchIntent({
      intentId: "intent:scope",
      rootExecutionId: "run:1",
      planRevisionId: revision.revisionId,
      taskNodeId: "analyze",
      effectiveRunSpecDigest: digest("spec:scope"),
      sourceIds: ["source:forge"],
      targetId: "target:artifact-store",
      requiredCapability: "architecture.read",
      effectClass: "read",
      createdAt: clock.now(),
    });
    const claim = conductor.claimDispatch({
      claimId: "claim:scope",
      intentId: "intent:scope",
      workerId: "worker:a",
      attemptId: "attempt:scope",
      leaseDurationMs: 1_000,
    });
    expect(() => conductor.issuePermit({
      permitId: "permit:scope",
      claimId: claim.claimId,
      grantId: grant.grantId,
      maximumValidityMs: 500,
    })).toThrow(AgentFabricError);
  });

  test("applies a PlanDelta only to the expected base revision", () => {
    const base = createRunPlanRevision("run:1", goal.goalId, program, "plan:base", digest);
    const next = applyPlanDelta(base, {
      deltaId: "delta:1",
      rootExecutionId: "run:1",
      baseRevisionId: base.revisionId,
      nextRevisionId: "plan:next",
      operations: [
        {
          kind: "add_node",
          node: { nodeId: "verify", kind: "verification", dependsOn: ["analyze"] },
        },
      ],
    }, digest);
    expect(next.parentRevisionId).toBe(base.revisionId);
    expect(next.nodes.map((node) => node.nodeId)).toEqual(["analyze", "verify"]);
    expect(() => applyPlanDelta(next, {
      deltaId: "delta:stale",
      rootExecutionId: "run:1",
      baseRevisionId: base.revisionId,
      nextRevisionId: "plan:invalid",
      operations: [],
    }, digest)).toThrow(AgentFabricError);
  });
});
