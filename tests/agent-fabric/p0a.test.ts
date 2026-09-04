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
  executeP0aActivity,
  replayControlState,
  stableStringify,
  type AttemptExecutionPermit,
  type Clock,
  type ControlJournal,
  type DerivedGrantRequest,
  type Digest,
  type ExecutionGrant,
  type GoalContract,
  type OwnerAuthorization,
  type OwnerAuthorizationVerifier,
  type WorkerResultReport,
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
  nodes: [{
    nodeId: "analyze",
    kind: "activity",
    dependsOn: [],
    agentSpecId: "agent:analyst",
    harnessSpecId: "harness:readonly",
    executionProfileId: "execution:isolated",
  }],
};

function ownerAuthorization(clock: ManualClock): OwnerAuthorization {
  return {
    authorizationId: "auth:owner:1",
    principalId: "owner:david",
    rootExecutionId: "run:1",
    goalIds: [goal.goalId],
    subjectIds: ["conductor", "worker:a", "worker:b", "worker:child", "worker:child:2"],
    capabilities: ["architecture.read", "architecture.review"],
    sourceIds: ["source:forge"],
    targetIds: ["target:artifact-store"],
    effectClasses: ["read", "internal_write"],
    notBefore: clock.now(),
    expiresAt: clock.now() + 120_000,
    maximumAttempts: 4,
    maximumDelegationDepth: 3,
    resourceCeilings: { modelCalls: 8, workers: 4 },
  };
}

function ownerVerifier(): OwnerAuthorizationVerifier {
  return {
    verify(authorization, authorizationDigest) {
      if (authorization.principalId !== "owner:david") {
        throw new AgentFabricError("AF_GRANT_REJECTED", "untrusted owner principal");
      }
      return {
        verifierId: "test-owner-verifier/v1",
        authorizationDigest,
        evidenceDigest: digest(`owner-evidence:${authorization.authorizationId}`),
      };
    },
    verifyRecorded(authorization, verification) {
      return verification.verifierId === "test-owner-verifier/v1" &&
        verification.evidenceDigest === digest(`owner-evidence:${authorization.authorizationId}`);
    },
  };
}

function trust(ledger?: ResourceLedger) {
  return {
    ownerAuthorizationVerifier: ownerVerifier(),
    resourceDefinitions: ledger ? Object.values(ledger.snapshot().definitions) : undefined,
  };
}

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
    delegationDepthRemaining: 2,
    resourceCeilings: { modelCalls: 4, workers: 2 },
  };
}

function preparedConductor(clock: ManualClock, ledger?: ResourceLedger) {
  const journal = new MemoryControlJournal();
  const conductor = new ForgeAgentConductor("run:1", journal, clock, digest, ownerVerifier(), ledger);
  conductor.registerOwnerAuthorization(ownerAuthorization(clock));
  conductor.registerGoal(goal);
  const revision = createRunPlanRevision("run:1", goal.goalId, program, "plan:1", digest);
  conductor.activatePlan(revision, null);
  return { conductor, journal, revision };
}

function dispatchAndPermit(
  conductor: ForgeAgentConductor,
  clock: ManualClock,
  revisionId: string,
  grant: ExecutionGrant,
  suffix: string,
  attemptId = `attempt:${suffix}`,
) {
  const specDigest = digest(`spec:${suffix}`);
  conductor.commitDispatchIntent({
    intentId: `intent:${suffix}`,
    rootExecutionId: "run:1",
    planRevisionId: revisionId,
    taskNodeId: "analyze",
    effectiveRunSpecDigest: specDigest,
    sourceIds: ["source:forge"],
    targetId: "target:artifact-store",
    requiredCapability: "architecture.read",
    effectClass: "read",
    createdAt: clock.now(),
  });
  const claim = conductor.claimDispatch({
    claimId: `claim:${suffix}`,
    intentId: `intent:${suffix}`,
    workerId: grant.subjectId,
    attemptId,
    leaseDurationMs: 10_000,
  });
  const permit = conductor.issuePermit({
    permitId: `permit:${suffix}`,
    claimId: claim.claimId,
    grantId: grant.grantId,
    maximumValidityMs: 5_000,
  });
  return { claim, permit, specDigest };
}

function reportForPermit(
  permit: AttemptExecutionPermit,
  clock: ManualClock,
  overrides: Partial<WorkerResultReport> = {},
): WorkerResultReport {
  return {
    reportId: `report:${permit.attemptId}`,
    attemptId: permit.attemptId,
    permitId: permit.permitId,
    intentId: permit.intentId,
    planRevisionId: permit.planRevisionId,
    effectiveRunSpecDigest: permit.effectiveRunSpecDigest,
    fencingToken: permit.fencingToken,
    status: "succeeded",
    resultDigest: digest(`result:${permit.attemptId}`),
    evidenceDigests: [],
    reportedAt: clock.now(),
    ...overrides,
  };
}

function childRequest(
  clock: ManualClock,
  grantId = "grant:child",
  subjectId = "worker:child",
): DerivedGrantRequest {
  return {
    grantId,
    subjectId,
    capabilities: ["architecture.read"],
    sourceIds: ["source:forge"],
    targetIds: ["target:artifact-store"],
    effectClasses: ["read"],
    notBefore: clock.now(),
    expiresAt: clock.now() + 30_000,
    maximumAttempts: 1,
    delegationDepthRemaining: 1,
    reservationId: `reservation:${grantId}`,
    resourceRequests: [
      { resource: "modelCalls", amount: 2 },
      { resource: "workers", amount: 1 },
    ],
  };
}

describe("Forge Agent Fabric P0a", () => {
  test("executes deterministic P0a and replays without planner/model calls", async () => {
    const clock = new ManualClock(1_000);
    const { conductor, journal, revision } = preparedConductor(clock);
    const grant = rootGrant(clock);
    conductor.registerGrant(grant);
    const { permit, specDigest } = dispatchAndPermit(conductor, clock, revision.revisionId, grant, "happy");
    const adapter = new DeterministicTestAdapter([{
      effectiveRunSpecDigest: specDigest,
      outcomeStatus: "succeeded",
      resultDigest: digest("result:happy"),
      evidenceDigests: [digest("evidence:happy")],
    }], () => clock.now());

    const outcome = await executeP0aActivity({ conductor, adapter, permit });
    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "unknown") throw new Error("unexpected uncertainty");
    expect(outcome.evidenceDigests).toEqual([digest("evidence:happy")]);
    expect(outcome.reportId).toBe("report:attempt:happy");
    expect(outcome.reportDigest).toMatch(/^sha256:/);
    expect(stableStringify(replayControlState(journal.readAll(), trust()))).toBe(
      stableStringify(conductor.state()),
    );
  });

  test("requires an explicit owner authorization before registering a root grant", () => {
    const clock = new ManualClock(2_000);
    const conductor = new ForgeAgentConductor("run:1", new MemoryControlJournal(), clock, digest, ownerVerifier());
    expect(() => conductor.registerGrant(rootGrant(clock))).toThrow(AgentFabricError);
  });

  test("transitive parent revocation invalidates descendant grant and permit before startup", () => {
    const clock = new ManualClock(3_000);
    const ledger = new ResourceLedger([
      { resource: "modelCalls", semantics: "consumable", limit: 8 },
      { resource: "workers", semantics: "capacity", limit: 4 },
    ]);
    const { conductor, revision } = preparedConductor(clock, ledger);
    const root = { ...rootGrant(clock, "conductor"), capabilities: ["architecture.read", "architecture.review"] };
    conductor.registerGrant(root);
    const resolution = conductor.deriveAndRegisterGrant(root.grantId, childRequest(clock));
    expect(resolution.outcome).toBe("allowed");
    const child = resolution.grant!;
    const { permit } = dispatchAndPermit(conductor, clock, revision.revisionId, child, "revoked-before");
    conductor.revokeGrant(root.grantId, "owner revoked parent");
    expect(() => conductor.authorizeAttemptDispatch(permit)).toThrow(AgentFabricError);
  });

  test("transitive parent revocation prevents outcome after startup", () => {
    const clock = new ManualClock(4_000);
    const ledger = new ResourceLedger([
      { resource: "modelCalls", semantics: "consumable", limit: 8 },
      { resource: "workers", semantics: "capacity", limit: 4 },
    ]);
    const { conductor, revision } = preparedConductor(clock, ledger);
    const root = { ...rootGrant(clock, "conductor"), capabilities: ["architecture.read", "architecture.review"] };
    conductor.registerGrant(root);
    const child = conductor.deriveAndRegisterGrant(root.grantId, childRequest(clock)).grant!;
    const { permit } = dispatchAndPermit(conductor, clock, revision.revisionId, child, "revoked-after");
    conductor.acceptStartupReport(permit, {
      startupReportId: "startup:revoked-after",
      attemptId: permit.attemptId,
      observedSpecDigest: permit.effectiveRunSpecDigest,
      startedAt: clock.now(),
    });
    conductor.revokeGrant(root.grantId, "owner revoked ancestor");
    expect(() => conductor.commitOutcome(reportForPermit(permit, clock))).toThrow(AgentFabricError);
  });

  test("attemptId is globally unique across intents", () => {
    const clock = new ManualClock(5_000);
    const { conductor, revision } = preparedConductor(clock);
    const grant = rootGrant(clock);
    conductor.registerGrant(grant);
    dispatchAndPermit(conductor, clock, revision.revisionId, grant, "identity-a", "attempt:shared");
    conductor.commitDispatchIntent({
      intentId: "intent:identity-b",
      rootExecutionId: "run:1",
      planRevisionId: revision.revisionId,
      taskNodeId: "analyze",
      effectiveRunSpecDigest: digest("spec:identity-b"),
      sourceIds: ["source:forge"],
      targetId: "target:artifact-store",
      requiredCapability: "architecture.read",
      effectClass: "read",
      createdAt: clock.now(),
    });
    expect(() => conductor.claimDispatch({
      claimId: "claim:identity-b",
      intentId: "intent:identity-b",
      workerId: grant.subjectId,
      attemptId: "attempt:shared",
      leaseDurationMs: 10_000,
    })).toThrow(AgentFabricError);
  });

  test("worker report cannot be rebound to another permit/spec/fencing generation", () => {
    const clock = new ManualClock(6_000);
    const { conductor, revision } = preparedConductor(clock);
    const grant = rootGrant(clock);
    conductor.registerGrant(grant);
    const first = dispatchAndPermit(conductor, clock, revision.revisionId, grant, "report-a");
    conductor.acceptStartupReport(first.permit, {
      startupReportId: "startup:report-a",
      attemptId: first.permit.attemptId,
      observedSpecDigest: first.permit.effectiveRunSpecDigest,
      startedAt: clock.now(),
    });
    expect(() => conductor.commitOutcome(reportForPermit(first.permit, clock, {
      permitId: "permit:other",
      effectiveRunSpecDigest: digest("spec:other"),
    }))).toThrow(AgentFabricError);
  });

  test("late uncertainty is evidence only and does not block a later retry", () => {
    const clock = new ManualClock(7_000);
    const { conductor, revision } = preparedConductor(clock);
    const grant = rootGrant(clock);
    conductor.registerGrant(grant);
    const first = dispatchAndPermit(conductor, clock, revision.revisionId, grant, "uncertain-first");
    clock.advance(10_001);
    const observation = conductor.recordAttemptUncertainty(first.permit, "startup", "late timeout");
    expect(observation.phase).toBe("startup");
    expect(conductor.state().outcomes[first.permit.attemptId]).toBeUndefined();
    const retry = conductor.claimDispatch({
      claimId: "claim:uncertain-retry",
      intentId: first.permit.intentId,
      workerId: grant.subjectId,
      attemptId: "attempt:uncertain-retry",
      leaseDurationMs: 5_000,
    });
    expect(retry.attemptId).toBe("attempt:uncertain-retry");
  });

  test("cannot derive a child after its parent or root authorization is revoked", () => {
    const clock = new ManualClock(8_000);
    const ledger = new ResourceLedger([
      { resource: "modelCalls", semantics: "consumable", limit: 8 },
      { resource: "workers", semantics: "capacity", limit: 4 },
    ]);
    const { conductor } = preparedConductor(clock, ledger);
    const root = rootGrant(clock, "conductor");
    conductor.registerGrant(root);
    conductor.revokeGrant(root.grantId, "revoked");
    expect(() => conductor.deriveAndRegisterGrant(root.grantId, childRequest(clock))).toThrow(AgentFabricError);

    const secondClock = new ManualClock(9_000);
    const secondLedger = new ResourceLedger([
      { resource: "modelCalls", semantics: "consumable", limit: 8 },
      { resource: "workers", semantics: "capacity", limit: 4 },
    ]);
    const second = preparedConductor(secondClock, secondLedger).conductor;
    const secondRoot = rootGrant(secondClock, "conductor");
    second.registerGrant(secondRoot);
    second.revokeOwnerAuthorization("auth:owner:1", "root authority revoked");
    expect(() => second.deriveAndRegisterGrant(secondRoot.grantId, childRequest(secondClock, "grant:child:2"))).toThrow(AgentFabricError);
  });

  test("direct child registration cannot bypass the resource ledger", () => {
    const clock = new ManualClock(10_000);
    const { conductor } = preparedConductor(clock);
    const parent = rootGrant(clock, "conductor");
    conductor.registerGrant(parent);
    expect(() => conductor.registerGrant({
      ...parent,
      grantId: "grant:forged-child",
      parentGrantId: parent.grantId,
      subjectId: "worker:child",
      maximumAttempts: 1,
      delegationDepthRemaining: 1,
      resourceCeilings: { modelCalls: 1 },
      reservationId: "reservation:forged",
    })).toThrow(AgentFabricError);
  });

  test("startup timestamps outside the permit window are rejected", () => {
    const clock = new ManualClock(11_000);
    const { conductor, revision } = preparedConductor(clock);
    const grant = rootGrant(clock);
    conductor.registerGrant(grant);
    const { permit } = dispatchAndPermit(conductor, clock, revision.revisionId, grant, "bad-start-time");
    expect(() => conductor.acceptStartupReport(permit, {
      startupReportId: "startup:future",
      attemptId: permit.attemptId,
      observedSpecDigest: permit.effectiveRunSpecDigest,
      startedAt: clock.now() + 1,
    })).toThrow(AgentFabricError);
  });

  test("a child plan revision cannot silently change goal/program or bypass PlanDelta provenance", () => {
    const clock = new ManualClock(12_000);
    const { conductor, revision } = preparedConductor(clock);
    const delta = {
      deltaId: "delta:2",
      rootExecutionId: "run:1",
      baseRevisionId: revision.revisionId,
      nextRevisionId: "plan:2",
      operations: [] as const,
    };
    conductor.registerPlanDelta(delta);
    const next = applyPlanDelta(revision, delta, digest);
    conductor.activatePlan(next, revision.revisionId);
    const maliciousDelta = {
      deltaId: "delta:3",
      rootExecutionId: "run:1",
      baseRevisionId: next.revisionId,
      nextRevisionId: "plan:3",
      operations: [] as const,
    };
    conductor.registerPlanDelta(maliciousDelta);
    expect(() => conductor.activatePlan({
      ...applyPlanDelta(next, maliciousDelta, digest),
      goalId: "goal:other",
    }, next.revisionId)).toThrow(AgentFabricError);
  });

  test("replay rejects a tampered authority lineage or event digest", () => {
    const clock = new ManualClock(13_000);
    const { conductor, journal } = preparedConductor(clock);
    conductor.registerGrant(rootGrant(clock));
    const events = journal.readAll().map((event) => structuredClone(event));
    const grantEvent = events.find((event) => event.payload.type === "grant_registered")!;
    if (grantEvent.payload.type !== "grant_registered") throw new Error("expected grant event");
    grantEvent.payload.grant.rootAuthorizationId = "auth:attacker";
    expect(() => replayControlState(events, trust())).toThrow(AgentFabricError);
  });

  test("replay reconstructs global resource limits and rejects a forged over-limit child", () => {
    const clock = new ManualClock(14_000);
    const ledger = new ResourceLedger([
      { resource: "modelCalls", semantics: "consumable", limit: 3 },
      { resource: "workers", semantics: "capacity", limit: 2 },
    ]);
    const { conductor, journal } = preparedConductor(clock, ledger);
    const rootOne = rootGrant(clock, "conductor");
    const rootTwo = rootGrant(clock, "worker:a");
    conductor.registerGrant(rootOne);
    conductor.registerGrant(rootTwo);
    conductor.deriveAndRegisterGrant(rootOne.grantId, childRequest(clock, "grant:child:one"));

    const forgedGrant: ExecutionGrant = {
      ...rootTwo,
      grantId: "grant:child:forged",
      subjectId: "worker:child:2",
      parentGrantId: rootTwo.grantId,
      effectClasses: ["read"],
      maximumAttempts: 1,
      delegationDepthRemaining: 1,
      resourceCeilings: { modelCalls: 2, workers: 1 },
      reservationId: "reservation:forged",
    };
    journal.append({
      expectedSequence: journal.readAll().length,
      event: {
        eventId: "event:forged-global-reservation",
        rootExecutionId: "run:1",
        occurredAt: clock.now(),
        payload: {
          type: "grant_registered",
          grant: forgedGrant,
          reservation: {
            reservationId: "reservation:forged",
            ownerId: rootTwo.grantId,
            requests: [
              { resource: "modelCalls", amount: 2 },
              { resource: "workers", amount: 1 },
            ],
            status: "active",
          },
        },
      },
    });
    expect(() => replayControlState(journal.readAll(), trust(ledger))).toThrow(AgentFabricError);
  });
});

class FailingJournal implements ControlJournal {
  private readonly inner = new MemoryControlJournal();
  failNextGrant = false;

  append(input: Parameters<ControlJournal["append"]>[0]) {
    if (this.failNextGrant && input.event.payload.type === "grant_registered" && input.event.payload.grant.parentGrantId) {
      this.failNextGrant = false;
      throw new AgentFabricError("AF_CONFLICT", "simulated journal failure");
    }
    return this.inner.append(input);
  }

  readAll() {
    return this.inner.readAll();
  }
}

describe("P0a atomic grant registration", () => {
  test("rolls back the resource reservation if derived-grant journal registration fails", () => {
    const clock = new ManualClock(15_000);
    const journal = new FailingJournal();
    const ledger = new ResourceLedger([
      { resource: "modelCalls", semantics: "consumable", limit: 8 },
      { resource: "workers", semantics: "capacity", limit: 4 },
    ]);
    const conductor = new ForgeAgentConductor("run:1", journal, clock, digest, ownerVerifier(), ledger);
    conductor.registerOwnerAuthorization(ownerAuthorization(clock));
    conductor.registerGoal(goal);
    const revision = createRunPlanRevision("run:1", goal.goalId, program, "plan:1", digest);
    conductor.activatePlan(revision, null);
    const parent = rootGrant(clock, "conductor");
    conductor.registerGrant(parent);
    const before = ledger.snapshot();
    journal.failNextGrant = true;
    expect(() => conductor.deriveAndRegisterGrant(parent.grantId, childRequest(clock))).toThrow(AgentFabricError);
    expect(ledger.snapshot()).toEqual(before);
    expect(conductor.state().grants["grant:child"]).toBeUndefined();
  });
});
