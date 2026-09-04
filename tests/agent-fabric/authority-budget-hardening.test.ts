import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  AgentFabricError,
  ForgeAgentConductor,
  MemoryControlJournal,
  ResourceLedger,
  createRunPlanRevision,
  type Clock,
  type Digest,
  type ExecutionGrant,
  type GoalContract,
  type OwnerAuthorization,
  type OwnerAuthorizationVerifier,
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
  goalId: "goal:budget",
  revision: 1,
  authorityInvocationId: "auth:budget",
  objectives: ["exercise P0a authority budgets"],
  nonObjectives: [],
  acceptanceCriteria: ["budget invariants hold"],
  allowedEffectClasses: ["read"],
  prohibitedEffectClasses: ["internal_write", "bounded_external_inference", "consequential"],
  sourceBoundary: { sourceIds: ["source:one"], allowExpansion: false },
};

const program: WorkflowProgramVersion = {
  programId: "workflow:budget",
  version: 1,
  nodes: [{
    nodeId: "analyze",
    kind: "activity",
    dependsOn: [],
    agentSpecId: "agent:budget",
    harnessSpecId: "harness:budget",
    executionProfileId: "execution:budget",
  }],
};

function authorization(clock: ManualClock): OwnerAuthorization {
  return {
    authorizationId: "auth:budget",
    principalId: "owner:test",
    rootExecutionId: "run:budget",
    goalIds: [goal.goalId],
    subjectIds: ["worker:a", "worker:b", "conductor", "worker:child:1", "worker:child:2"],
    capabilities: ["read"],
    sourceIds: ["source:one"],
    targetIds: ["target:one"],
    effectClasses: ["read"],
    notBefore: clock.now(),
    expiresAt: clock.now() + 60_000,
    maximumAttempts: 3,
    maximumDelegationDepth: 3,
    resourceCeilings: { modelCalls: 6, workers: 3 },
  };
}

function verifier(): OwnerAuthorizationVerifier {
  return {
    verify(ownerAuthorization, authorizationDigest) {
      if (ownerAuthorization.principalId !== "owner:test") {
        throw new AgentFabricError("AF_GRANT_REJECTED", "unexpected owner");
      }
      return {
        verifierId: "budget-test-verifier/v1",
        authorizationDigest,
        evidenceDigest: digest(`evidence:${ownerAuthorization.authorizationId}`),
      };
    },
  };
}

function rootGrant(
  clock: ManualClock,
  grantId: string,
  subjectId: string,
  maximumAttempts: number,
  modelCalls: number,
): ExecutionGrant {
  return {
    grantId,
    rootAuthorizationId: "auth:budget",
    subjectId,
    parentGrantId: null,
    capabilities: ["read"],
    sourceIds: ["source:one"],
    targetIds: ["target:one"],
    effectClasses: ["read"],
    notBefore: clock.now(),
    expiresAt: clock.now() + 30_000,
    maximumAttempts,
    delegationDepthRemaining: 2,
    resourceCeilings: { modelCalls, workers: 1 },
  };
}

function prepared(clock: ManualClock, ledger?: ResourceLedger) {
  const conductor = new ForgeAgentConductor(
    "run:budget",
    new MemoryControlJournal(),
    clock,
    digest,
    verifier(),
    ledger,
  );
  conductor.registerOwnerAuthorization(authorization(clock));
  conductor.registerGoal(goal);
  const revision = createRunPlanRevision(
    "run:budget",
    goal.goalId,
    program,
    "plan:budget:1",
    digest,
  );
  conductor.activatePlan(revision, null);
  return { conductor, revision };
}

function commitIntentAndPermit(
  conductor: ForgeAgentConductor,
  clock: ManualClock,
  revisionId: string,
  grant: ExecutionGrant,
  suffix: string,
  maximumValidityMs = 1_000,
) {
  const specDigest = digest(`spec:${suffix}`);
  conductor.commitDispatchIntent({
    intentId: `intent:${suffix}`,
    rootExecutionId: "run:budget",
    planRevisionId: revisionId,
    taskNodeId: "analyze",
    effectiveRunSpecDigest: specDigest,
    sourceIds: ["source:one"],
    targetId: "target:one",
    requiredCapability: "read",
    effectClass: "read",
    createdAt: clock.now(),
  });
  const claim = conductor.claimDispatch({
    claimId: `claim:${suffix}`,
    intentId: `intent:${suffix}`,
    workerId: grant.subjectId,
    attemptId: `attempt:${suffix}`,
    leaseDurationMs: 5_000,
  });
  const permit = conductor.issuePermit({
    permitId: `permit:${suffix}`,
    claimId: claim.claimId,
    grantId: grant.grantId,
    maximumValidityMs,
  });
  return { permit, specDigest };
}

describe("P0a authority budget hardening", () => {
  test("root grants cannot collectively exceed the owner authorization attempt budget", () => {
    const clock = new ManualClock(1_000);
    const { conductor } = prepared(clock);
    conductor.registerGrant(rootGrant(clock, "grant:root:a", "worker:a", 2, 2));
    expect(() => conductor.registerGrant(
      rootGrant(clock, "grant:root:b", "worker:b", 2, 2),
    )).toThrow(AgentFabricError);
  });

  test("root grants cannot collectively exceed an authorization resource ceiling", () => {
    const clock = new ManualClock(2_000);
    const { conductor } = prepared(clock);
    conductor.registerGrant(rootGrant(clock, "grant:root:a", "worker:a", 1, 4));
    expect(() => conductor.registerGrant(
      rootGrant(clock, "grant:root:b", "worker:b", 1, 3),
    )).toThrow(AgentFabricError);
  });

  test("delegated attempts consume the parent's attempt budget", () => {
    const clock = new ManualClock(3_000);
    const ledger = new ResourceLedger([
      { resource: "modelCalls", semantics: "consumable", limit: 6 },
      { resource: "workers", semantics: "capacity", limit: 3 },
    ]);
    const { conductor } = prepared(clock, ledger);
    const parent = rootGrant(clock, "grant:parent", "conductor", 2, 6);
    conductor.registerGrant(parent);

    const first = conductor.deriveAndRegisterGrant(parent.grantId, {
      grantId: "grant:child:1",
      subjectId: "worker:child:1",
      capabilities: ["read"],
      sourceIds: ["source:one"],
      targetIds: ["target:one"],
      effectClasses: ["read"],
      notBefore: clock.now(),
      expiresAt: clock.now() + 10_000,
      maximumAttempts: 1,
      delegationDepthRemaining: 1,
      reservationId: "reservation:child:1",
      resourceRequests: [{ resource: "modelCalls", amount: 2 }],
    });
    expect(first.outcome).toBe("allowed");

    const second = conductor.deriveAndRegisterGrant(parent.grantId, {
      grantId: "grant:child:2",
      subjectId: "worker:child:2",
      capabilities: ["read"],
      sourceIds: ["source:one"],
      targetIds: ["target:one"],
      effectClasses: ["read"],
      notBefore: clock.now(),
      expiresAt: clock.now() + 10_000,
      maximumAttempts: 2,
      delegationDepthRemaining: 1,
      reservationId: "reservation:child:2",
      resourceRequests: [{ resource: "modelCalls", amount: 2 }],
    });
    expect(second.outcome).toBe("rejected");
    expect(second.reasonCodes).toContain("attempt_budget_exhausted");
  });

  test("an expired AttemptExecutionPermit cannot commit a successful outcome", () => {
    const clock = new ManualClock(4_000);
    const { conductor, revision } = prepared(clock);
    const grant = rootGrant(clock, "grant:root:a", "worker:a", 1, 2);
    conductor.registerGrant(grant);
    const { permit, specDigest } = commitIntentAndPermit(
      conductor,
      clock,
      revision.revisionId,
      grant,
      "permit-expiry",
      10,
    );
    conductor.acceptStartupReport(permit, {
      startupReportId: "startup:permit-expiry",
      attemptId: permit.attemptId,
      observedSpecDigest: specDigest,
      startedAt: clock.now(),
    });
    clock.advance(10);
    expect(() => conductor.commitOutcome({
      reportId: "report:permit-expiry",
      attemptId: permit.attemptId,
      status: "succeeded",
      resultDigest: digest("result:permit-expiry"),
      evidenceDigests: [],
      reportedAt: clock.now(),
    })).toThrow(AgentFabricError);
  });
});
