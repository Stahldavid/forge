import { describe, expect, test } from "bun:test";
import {
  AgentFabricError,
  DeterministicTestAdapter,
  ForgeAgentConductor,
  MemoryControlJournal,
  ResourceLedger,
  computeControlEventDigest,
  createRunPlanRevision,
  executeP0aActivity,
  replayControlState,
  sha256Digest,
  type AgentAdapter,
  type AttemptExecutionPermit,
  type Clock,
  type Digest,
  type ExecutionGrant,
  type GoalContract,
  type OwnerAuthorization,
  type OwnerAuthorizationVerifier,
  type ReplayTrustContext,
  type WorkerResultReport,
  type WorkflowProgramVersion,
} from "../../src/forge/agent-fabric/index.ts";

class ManualClock implements Clock {
  constructor(private current: number) {}
  now(): number { return this.current; }
  advance(milliseconds: number): void { this.current += milliseconds; }
}

class AdvancingClock implements Clock {
  constructor(private current: number) {}
  now(): number { return this.current++; }
}

function digest(value: string): Digest {
  return sha256Digest(value);
}

function verifier(): OwnerAuthorizationVerifier {
  return {
    verify(authorization, authorizationDigest) {
      return {
        verifierId: "review-v2-verifier/v1",
        authorizationDigest,
        evidenceDigest: digest(`evidence:${authorization.authorizationId}:${authorizationDigest}`),
      };
    },
    verifyRecorded(authorization, verification) {
      return verification.verifierId === "review-v2-verifier/v1" &&
        verification.evidenceDigest ===
          digest(`evidence:${authorization.authorizationId}:${verification.authorizationDigest}`);
    },
  };
}

function authorization(
  authorizationId: string,
  rootExecutionId: string,
  goalId: string,
  principalId = "owner:test",
): OwnerAuthorization {
  return {
    authorizationId,
    principalId,
    rootExecutionId,
    goalIds: [goalId],
    subjectIds: ["worker:a", "worker:b", "conductor", "worker:child"],
    capabilities: ["read"],
    sourceIds: ["source:one"],
    targetIds: ["target:one"],
    effectClasses: ["read"],
    notBefore: 0,
    expiresAt: 100_000,
    maximumAttempts: 6,
    maximumDelegationDepth: 3,
    resourceCeilings: { calls: 8, workers: 4 },
  };
}

function goal(goalId: string, authorityInvocationId: string): GoalContract {
  return {
    goalId,
    revision: 1,
    authorityInvocationId,
    objectives: ["exercise P0a review invariants"],
    nonObjectives: [],
    acceptanceCriteria: ["invariants hold"],
    allowedEffectClasses: ["read"],
    prohibitedEffectClasses: ["internal_write", "bounded_external_inference", "consequential"],
    sourceBoundary: { sourceIds: ["source:one"], allowExpansion: false },
  };
}

const program: WorkflowProgramVersion = {
  programId: "workflow:review-v2",
  version: 1,
  nodes: [{
    nodeId: "analyze",
    kind: "activity",
    dependsOn: [],
    agentSpecId: "agent:review-v2",
    harnessSpecId: "harness:review-v2",
    executionProfileId: "execution:review-v2",
  }],
};

function rootGrant(
  clock: Clock,
  grantId: string,
  rootAuthorizationId: string,
  subjectId = "worker:a",
  maximumAttempts = 3,
  calls = 6,
): ExecutionGrant {
  const now = clock.now();
  return {
    grantId,
    rootAuthorizationId,
    subjectId,
    parentGrantId: null,
    capabilities: ["read"],
    sourceIds: ["source:one"],
    targetIds: ["target:one"],
    effectClasses: ["read"],
    notBefore: Math.max(0, now - 10),
    expiresAt: now + 50_000,
    maximumAttempts,
    delegationDepthRemaining: 2,
    resourceCeilings: { calls, workers: 2 },
  };
}

function prepared(
  clock: Clock,
  options: {
    rootExecutionId?: string;
    authorizationId?: string;
    goalId?: string;
    ledger?: ResourceLedger;
  } = {},
) {
  const rootExecutionId = options.rootExecutionId ?? "run:test";
  const authorizationId = options.authorizationId ?? "auth:test";
  const goalId = options.goalId ?? "goal:test";
  const journal = new MemoryControlJournal();
  const trustedVerifier = verifier();
  const conductor = new ForgeAgentConductor(
    rootExecutionId,
    journal,
    clock,
    digest,
    trustedVerifier,
    options.ledger,
  );
  conductor.registerOwnerAuthorization(authorization(authorizationId, rootExecutionId, goalId));
  const goalContract = goal(goalId, authorizationId);
  conductor.registerGoal(goalContract);
  const revision = createRunPlanRevision(
    rootExecutionId,
    goalId,
    program,
    `plan:${rootExecutionId}:1`,
    digest,
  );
  conductor.activatePlan(revision, null);
  const trust: ReplayTrustContext = {
    ownerAuthorizationVerifier: trustedVerifier,
    resourceDefinitions: options.ledger
      ? Object.values(options.ledger.snapshot().definitions)
      : undefined,
  };
  return { conductor, journal, revision, trust, goalContract };
}

function dispatchPermit(
  conductor: ForgeAgentConductor,
  clock: Clock,
  revisionId: string,
  grant: ExecutionGrant,
  suffix: string,
  validityMs = 1_000,
): AttemptExecutionPermit {
  const createdAt = clock.now();
  const specDigest = digest(`spec:${suffix}`);
  conductor.commitDispatchIntent({
    intentId: `intent:${suffix}`,
    rootExecutionId: "run:test",
    planRevisionId: revisionId,
    taskNodeId: "analyze",
    effectiveRunSpecDigest: specDigest,
    sourceIds: ["source:one"],
    targetId: "target:one",
    requiredCapability: "read",
    effectClass: "read",
    createdAt,
  });
  const claim = conductor.claimDispatch({
    claimId: `claim:${suffix}`,
    intentId: `intent:${suffix}`,
    workerId: grant.subjectId,
    attemptId: `attempt:${suffix}`,
    leaseDurationMs: Math.max(validityMs + 100, 5_000),
  });
  return conductor.issuePermit({
    permitId: `permit:${suffix}`,
    claimId: claim.claimId,
    grantId: grant.grantId,
    maximumValidityMs: validityMs,
  });
}

describe("independent review v2 regressions", () => {
  test("F-01: grant authority must be exactly bound to the plan GoalContract", () => {
    const clock = new ManualClock(1_000);
    const journal = new MemoryControlJournal();
    const trustedVerifier = verifier();
    const conductor = new ForgeAgentConductor(
      "run:test",
      journal,
      clock,
      digest,
      trustedVerifier,
    );

    conductor.registerOwnerAuthorization(authorization("auth:goal", "run:test", "goal:test"));
    conductor.registerOwnerAuthorization(authorization("auth:other", "run:test", "goal:test"));
    conductor.registerGoal(goal("goal:test", "auth:goal"));
    const revision = createRunPlanRevision("run:test", "goal:test", program, "plan:1", digest);
    conductor.activatePlan(revision, null);

    const grant = rootGrant(clock, "grant:other", "auth:other");
    conductor.registerGrant(grant);
    conductor.commitDispatchIntent({
      intentId: "intent:cross-authority",
      rootExecutionId: "run:test",
      planRevisionId: revision.revisionId,
      taskNodeId: "analyze",
      effectiveRunSpecDigest: digest("spec:cross-authority"),
      sourceIds: ["source:one"],
      targetId: "target:one",
      requiredCapability: "read",
      effectClass: "read",
      createdAt: clock.now(),
    });
    const claim = conductor.claimDispatch({
      claimId: "claim:cross-authority",
      intentId: "intent:cross-authority",
      workerId: grant.subjectId,
      attemptId: "attempt:cross-authority",
      leaseDurationMs: 5_000,
    });

    expect(() => conductor.issuePermit({
      permitId: "permit:cross-authority",
      claimId: claim.claimId,
      grantId: grant.grantId,
      maximumValidityMs: 1_000,
    })).toThrow(AgentFabricError);
  });

  test("F-01 replay: one control stream cannot mix root executions", () => {
    const clock = new ManualClock(2_000);
    const { conductor, journal, trust } = prepared(clock);
    conductor.revokeOwnerAuthorization("auth:test", "test revocation");
    const events = journal.readAll().map((event) => structuredClone(event));
    const last = events.at(-1)!;
    last.rootExecutionId = "run:other";
    const { eventDigest: _ignored, ...withoutDigest } = last;
    last.eventDigest = computeControlEventDigest(withoutDigest);
    expect(() => replayControlState(events, trust)).toThrow(AgentFabricError);
  });

  test("F-02: advancing clocks cannot create a live trace that replay rejects", () => {
    const clock = new AdvancingClock(3_000);
    const { conductor } = prepared(clock);
    const grant = rootGrant(clock, "grant:clock", "auth:test");
    conductor.registerGrant(grant);
    conductor.commitDispatchIntent({
      intentId: "intent:clock",
      rootExecutionId: "run:test",
      planRevisionId: "plan:run:test:1",
      taskNodeId: "analyze",
      effectiveRunSpecDigest: digest("spec:clock"),
      sourceIds: ["source:one"],
      targetId: "target:one",
      requiredCapability: "read",
      effectClass: "read",
      createdAt: clock.now(),
    });
    conductor.claimDispatch({
      claimId: "claim:clock",
      intentId: "intent:clock",
      workerId: grant.subjectId,
      attemptId: "attempt:clock",
      leaseDurationMs: 5_000,
    });
    expect(() => conductor.state()).not.toThrow();
  });

  test("F-02: outcome uncertainty before confirmed startup is rejected before append", () => {
    const clock = new ManualClock(4_000);
    const { conductor, revision } = prepared(clock);
    const grant = rootGrant(clock, "grant:prestart", "auth:test");
    conductor.registerGrant(grant);
    const permit = dispatchPermit(conductor, clock, revision.revisionId, grant, "prestart");
    const eventCount = conductor.events().length;
    expect(() => conductor.recordAttemptUncertainty(permit, "outcome", "too early"))
      .toThrow(AgentFabricError);
    expect(conductor.events()).toHaveLength(eventCount);
    expect(() => conductor.state()).not.toThrow();
  });

  test("F-03: caller cannot substitute a fresh ledger with identical definitions", () => {
    const clock = new ManualClock(5_000);
    const definitions = [{ resource: "calls", semantics: "consumable" as const, limit: 5 }];
    const liveLedger = new ResourceLedger(definitions);
    const { conductor } = prepared(clock, { ledger: liveLedger });
    const parent = rootGrant(clock, "grant:parent", "auth:test", "conductor", 3, 5);
    conductor.registerGrant(parent);

    const first = conductor.deriveAndRegisterGrant(parent.grantId, {
      grantId: "grant:child:one",
      subjectId: "worker:child",
      capabilities: ["read"],
      sourceIds: ["source:one"],
      targetIds: ["target:one"],
      effectClasses: ["read"],
      notBefore: clock.now(),
      expiresAt: clock.now() + 10_000,
      maximumAttempts: 1,
      delegationDepthRemaining: 1,
      reservationId: "reservation:one",
      resourceRequests: [{ resource: "calls", amount: 3 }],
    });
    expect(first.outcome).toBe("allowed");

    const substituted = new ResourceLedger(definitions);
    const before = conductor.events().length;
    expect(() => conductor.deriveAndRegisterGrant(parent.grantId, {
      grantId: "grant:child:two",
      subjectId: "worker:child",
      capabilities: ["read"],
      sourceIds: ["source:one"],
      targetIds: ["target:one"],
      effectClasses: ["read"],
      notBefore: clock.now(),
      expiresAt: clock.now() + 10_000,
      maximumAttempts: 1,
      delegationDepthRemaining: 1,
      reservationId: "reservation:two",
      resourceRequests: [{ resource: "calls", amount: 2 }],
    }, substituted)).toThrow(AgentFabricError);
    expect(conductor.events()).toHaveLength(before);
    expect(() => conductor.state()).not.toThrow();
  });

  test("F-04: a positive startup report arriving after expiry is preserved as uncertainty", async () => {
    const clock = new ManualClock(6_000);
    const { conductor, revision } = prepared(clock);
    const grant = rootGrant(clock, "grant:late-start", "auth:test");
    conductor.registerGrant(grant);
    const permit = dispatchPermit(conductor, clock, revision.revisionId, grant, "late-start", 10);

    const adapter: AgentAdapter = {
      manifest: () => ({
        adapterId: "late-start",
        version: "1",
        capabilities: [],
        supportsCancellation: false,
        supportsObservation: false,
      }),
      async startAttempt(currentPermit) {
        const startedAt = clock.now();
        clock.advance(10);
        return {
          status: "started",
          report: {
            startupReportId: "startup:late",
            attemptId: currentPermit.attemptId,
            observedSpecDigest: currentPermit.effectiveRunSpecDigest,
            startedAt,
          },
        };
      },
      async observeAttempt() { return []; },
      async collectOutcome() { return { status: "unknown", reason: "not reached" }; },
      async requestCancellation() { return { acknowledged: false }; },
      async observeTermination() { return "unknown"; },
    };

    const result = await executeP0aActivity({ conductor, adapter, permit });
    expect(result.status).toBe("unknown");
    if (result.status !== "unknown") throw new Error("expected uncertainty");
    expect(result.observation.phase).toBe("startup");
    expect(Object.keys(conductor.state().outcomes)).toHaveLength(0);
    expect(Object.keys(conductor.state().uncertaintyObservations)).toHaveLength(1);
  });

  test("F-04: a positive outcome report arriving after expiry is preserved and does not terminalize", async () => {
    const clock = new ManualClock(7_000);
    const { conductor, revision } = prepared(clock);
    const grant = rootGrant(clock, "grant:late-outcome", "auth:test", "worker:a", 2);
    conductor.registerGrant(grant);
    const permit = dispatchPermit(conductor, clock, revision.revisionId, grant, "late-outcome", 20);

    const adapter: AgentAdapter = {
      manifest: () => ({
        adapterId: "late-outcome",
        version: "1",
        capabilities: [],
        supportsCancellation: false,
        supportsObservation: false,
      }),
      async startAttempt(currentPermit) {
        return {
          status: "started",
          report: {
            startupReportId: "startup:late-outcome",
            attemptId: currentPermit.attemptId,
            observedSpecDigest: currentPermit.effectiveRunSpecDigest,
            startedAt: clock.now(),
          },
        };
      },
      async observeAttempt() { return []; },
      async collectOutcome() {
        const reportedAt = clock.now() + 19;
        clock.advance(20);
        const report: WorkerResultReport = {
          reportId: "report:late-outcome",
          attemptId: permit.attemptId,
          permitId: permit.permitId,
          intentId: permit.intentId,
          planRevisionId: permit.planRevisionId,
          effectiveRunSpecDigest: permit.effectiveRunSpecDigest,
          fencingToken: permit.fencingToken,
          status: "succeeded",
          resultDigest: digest("result:late-outcome"),
          evidenceDigests: [digest("evidence:late-outcome")],
          reportedAt,
        };
        return { status: "reported", report };
      },
      async requestCancellation() { return { acknowledged: false }; },
      async observeTermination() { return "unknown"; },
    };

    const result = await executeP0aActivity({ conductor, adapter, permit });
    expect(result.status).toBe("unknown");
    if (result.status !== "unknown") throw new Error("expected uncertainty");
    expect(result.observation.phase).toBe("outcome");
    expect(Object.keys(conductor.state().outcomes)).toHaveLength(0);

    clock.advance(5_000);
    expect(() => conductor.claimDispatch({
      claimId: "claim:retry-after-uncertainty",
      intentId: permit.intentId,
      workerId: grant.subjectId,
      attemptId: "attempt:retry-after-uncertainty",
      leaseDurationMs: 5_000,
    })).not.toThrow();
  });

  test("F-05: replay rejects a second permit for the same attempt", () => {
    const clock = new ManualClock(8_000);
    const { conductor, journal, revision, trust } = prepared(clock);
    const grant = rootGrant(clock, "grant:duplicate-permit", "auth:test", "worker:a", 2);
    conductor.registerGrant(grant);
    const permit = dispatchPermit(conductor, clock, revision.revisionId, grant, "duplicate-permit");
    journal.append({
      expectedSequence: journal.readAll().length,
      event: {
        eventId: "event:permit:duplicate-second",
        rootExecutionId: "run:test",
        occurredAt: clock.now(),
        idempotencyKey: "permit:duplicate-second",
        payload: {
          type: "attempt_execution_permit_issued",
          permit: { ...permit, permitId: "permit:duplicate-second" },
        },
      },
    });
    expect(() => replayControlState(journal.readAll(), trust)).toThrow(AgentFabricError);
  });

  test("F-06: replay recomputes the WorkerResultReport digest", async () => {
    const clock = new ManualClock(9_000);
    const { conductor, journal, revision, trust } = prepared(clock);
    const grant = rootGrant(clock, "grant:report-digest", "auth:test");
    conductor.registerGrant(grant);
    const permit = dispatchPermit(conductor, clock, revision.revisionId, grant, "report-digest");
    const adapter = new DeterministicTestAdapter([{
      effectiveRunSpecDigest: permit.effectiveRunSpecDigest,
      outcomeStatus: "succeeded",
      resultDigest: digest("result:report-digest"),
      evidenceDigests: [digest("evidence:report-digest")],
    }], () => clock.now());
    const result = await executeP0aActivity({ conductor, adapter, permit });
    expect(result.status).toBe("succeeded");

    const events = journal.readAll().map((event) => structuredClone(event));
    const outcomeEvent = events.find((event) => event.payload.type === "attempt_outcome_committed");
    if (!outcomeEvent || outcomeEvent.payload.type !== "attempt_outcome_committed") {
      throw new Error("expected outcome event");
    }
    outcomeEvent.payload.outcome.reportDigest = digest("fabricated-report-digest");
    const { eventDigest: _ignored, ...withoutDigest } = outcomeEvent;
    outcomeEvent.eventDigest = computeControlEventDigest(withoutDigest);

    expect(() => replayControlState(events, trust)).toThrow(AgentFabricError);
  });
});
