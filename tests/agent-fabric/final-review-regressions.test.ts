import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  AgentFabricError,
  ForgeAgentConductor,
  MemoryControlJournal,
  ResourceLedger,
  computeControlEventDigest,
  createRunPlanRevision,
  digestCanonical,
  replayControlState,
  sha256Digest,
  validateUncommittedControlEvent,
  type AttemptExecutionPermit,
  type Clock,
  type ControlEventEnvelope,
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
  return sha256Digest(value);
}

function verifier(): OwnerAuthorizationVerifier {
  return {
    verify(authorization, authorizationDigest) {
      return {
        verifierId: "final-review-verifier/v1",
        authorizationDigest,
        evidenceDigest: digest(`evidence:${authorization.authorizationId}:${authorizationDigest}`),
      };
    },
    verifyRecorded(authorization, verification) {
      return verification.verifierId === "final-review-verifier/v1" &&
        verification.evidenceDigest ===
          digest(`evidence:${authorization.authorizationId}:${verification.authorizationDigest}`);
    },
  };
}

const program: WorkflowProgramVersion = {
  programId: "workflow:final-review",
  version: 1,
  nodes: [{
    nodeId: "analyze",
    kind: "activity",
    dependsOn: [],
    agentSpecId: "agent:final-review",
    harnessSpecId: "harness:final-review",
    executionProfileId: "execution:final-review",
  }],
};

function authorization(clock: Clock): OwnerAuthorization {
  const now = clock.now();
  return {
    authorizationId: "auth:final",
    principalId: "owner:test",
    rootExecutionId: "run:final",
    goalIds: ["goal:final"],
    subjectIds: ["conductor", "worker:a", "worker:b", "worker:child:1", "worker:child:2"],
    capabilities: ["read"],
    sourceIds: ["source:one"],
    targetIds: ["target:one"],
    effectClasses: ["read"],
    notBefore: Math.max(0, now - 1),
    expiresAt: now + 100_000,
    maximumAttempts: 12,
    maximumDelegationDepth: 3,
    resourceCeilings: { calls: 5, workers: 4 },
  };
}

function goal(): GoalContract {
  return {
    goalId: "goal:final",
    revision: 1,
    authorityInvocationId: "auth:final",
    objectives: [""],
    nonObjectives: [],
    acceptanceCriteria: [""],
    allowedEffectClasses: ["read"],
    prohibitedEffectClasses: ["internal_write", "bounded_external_inference", "consequential"],
    sourceBoundary: { sourceIds: ["source:one"], allowExpansion: false },
  };
}

function parentGrant(clock: Clock): ExecutionGrant {
  const now = clock.now();
  return {
    grantId: "grant:parent",
    rootAuthorizationId: "auth:final",
    subjectId: "conductor",
    parentGrantId: null,
    capabilities: ["read"],
    sourceIds: ["source:one"],
    targetIds: ["target:one"],
    effectClasses: ["read"],
    notBefore: Math.max(0, now - 1),
    expiresAt: now + 50_000,
    maximumAttempts: 6,
    delegationDepthRemaining: 2,
    resourceCeilings: { calls: 5, workers: 4 },
  };
}

function prepare(
  clock: ManualClock,
  journal = new MemoryControlJournal(),
  ledger?: ResourceLedger,
) {
  const trustedVerifier = verifier();
  const conductor = new ForgeAgentConductor(
    "run:final",
    journal,
    clock,
    digest,
    trustedVerifier,
    ledger,
  );

  if (journal.readAll().length === 0) {
    conductor.registerOwnerAuthorization(authorization(clock));
    conductor.registerGoal(goal());
    const revision = createRunPlanRevision(
      "run:final",
      "goal:final",
      program,
      "plan:final:1",
      digest,
    );
    conductor.activatePlan(revision, null);
    const parent = parentGrant(clock);
    conductor.registerGrant(parent);
    return { conductor, journal, revision, parent, trustedVerifier };
  }

  const state = conductor.state();
  return {
    conductor,
    journal,
    revision: state.planRevisions["plan:final:1"]!,
    parent: state.grants["grant:parent"]!,
    trustedVerifier,
  };
}

function childRequest(clock: Clock, suffix: string, amount: number) {
  return {
    grantId: `grant:child:${suffix}`,
    subjectId: suffix === "1" ? "worker:child:1" : "worker:child:2",
    capabilities: ["read"],
    sourceIds: ["source:one"],
    targetIds: ["target:one"],
    effectClasses: ["read" as const],
    notBefore: clock.now(),
    expiresAt: clock.now() + 20_000,
    maximumAttempts: 1,
    delegationDepthRemaining: 1,
    reservationId: `reservation:${suffix}`,
    resourceRequests: [{ resource: "calls", amount }],
  };
}

function permitFor(
  conductor: ForgeAgentConductor,
  clock: Clock,
  revisionId: string,
  grant: ExecutionGrant,
  suffix: string,
): AttemptExecutionPermit {
  conductor.commitDispatchIntent({
    intentId: `intent:${suffix}`,
    rootExecutionId: "run:final",
    planRevisionId: revisionId,
    taskNodeId: "analyze",
    effectiveRunSpecDigest: digest(`spec:${suffix}`),
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
  return conductor.issuePermit({
    permitId: `permit:${suffix}`,
    claimId: claim.claimId,
    grantId: grant.grantId,
    maximumValidityMs: 2_000,
  });
}

function reportFor(
  permit: AttemptExecutionPermit,
  clock: Clock,
  reportId: string,
): WorkerResultReport {
  return {
    reportId,
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
  };
}

function appendEnvelope(
  events: ControlEventEnvelope[],
  event: Omit<
    ControlEventEnvelope,
    "sequence" | "predecessorEventId" | "predecessorEventDigest" | "eventDigest"
  >,
): void {
  const predecessor = events.at(-1);
  const withoutDigest: Omit<ControlEventEnvelope, "eventDigest"> = {
    ...structuredClone(event),
    sequence: events.length + 1,
    predecessorEventId: predecessor?.eventId ?? null,
    predecessorEventDigest: predecessor?.eventDigest ?? null,
  };
  events.push({ ...withoutDigest, eventDigest: computeControlEventDigest(withoutDigest) });
}

describe("final independent review regressions", () => {
  test("resume with an empty ledger hydrates accounting from replay", () => {
    const clock = new ManualClock(1_000);
    const definitions = [{ resource: "calls", semantics: "consumable" as const, limit: 5 }];
    const first = prepare(clock, new MemoryControlJournal(), new ResourceLedger(definitions));
    expect(first.conductor.deriveAndRegisterGrant(
      first.parent.grantId,
      childRequest(clock, "1", 3),
    ).outcome).toBe("allowed");

    const resumed = prepare(clock, first.journal, new ResourceLedger(definitions));
    const second = resumed.conductor.deriveAndRegisterGrant(
      resumed.parent.grantId,
      childRequest(clock, "2", 3),
    );
    expect(second.outcome).toBe("rejected");
    expect(() => resumed.conductor.state()).not.toThrow();
  });

  test("caller-owned ledger mutation cannot change canonical authority state", () => {
    const clock = new ManualClock(2_000);
    const seed = new ResourceLedger([
      { resource: "calls", semantics: "consumable", limit: 5 },
    ]);
    const prepared = prepare(clock, new MemoryControlJournal(), seed);
    expect(prepared.conductor.deriveAndRegisterGrant(
      prepared.parent.grantId,
      childRequest(clock, "1", 2),
    ).outcome).toBe("allowed");

    seed.reserve("external-only", "attacker", [{ resource: "calls", amount: 1 }]);

    // The internal ledger remains authoritative when the caller-owned seed mutates.
    expect(prepared.conductor.deriveAndRegisterGrant(
      prepared.parent.grantId,
      childRequest(clock, "2", 1),
    ).outcome).toBe("allowed");
    expect(prepared.conductor.state().resourceReservations["external-only"]).toBeUndefined();

    // Passing the mutated seed back in is explicitly rejected.
    expect(() => prepared.conductor.releaseResourceReservation("reservation:1", seed))
      .toThrow(AgentFabricError);
  });

  test("replay rejects duplicate event IDs and idempotency keys", () => {
    const clock = new ManualClock(3_000);
    const prepared = prepare(clock);
    prepared.conductor.revokeGrant(prepared.parent.grantId, "first");
    const base = prepared.journal.readAll().map((event) => structuredClone(event));
    const last = base.at(-1)!;

    const duplicateId = base.map((event) => structuredClone(event));
    appendEnvelope(duplicateId, {
      eventId: last.eventId,
      rootExecutionId: "run:final",
      occurredAt: last.occurredAt,
      idempotencyKey: "different-idempotency",
      payload: { type: "grant_revoked", grantId: prepared.parent.grantId, reason: "second" },
    });
    expect(() => replayControlState(duplicateId, {
      ownerAuthorizationVerifier: prepared.trustedVerifier,
    })).toThrow(AgentFabricError);

    const duplicateKey = base.map((event) => structuredClone(event));
    appendEnvelope(duplicateKey, {
      eventId: "event:new-revocation",
      rootExecutionId: "run:final",
      occurredAt: last.occurredAt,
      idempotencyKey: last.idempotencyKey,
      payload: { type: "grant_revoked", grantId: prepared.parent.grantId, reason: "second" },
    });
    expect(() => replayControlState(duplicateKey, {
      ownerAuthorizationVerifier: prepared.trustedVerifier,
    })).toThrow(AgentFabricError);
  });

  test("replay rejects authorization admitted outside its validity window", () => {
    const trustedVerifier = verifier();
    const auth: OwnerAuthorization = {
      ...authorization({ now: () => 100 }),
      notBefore: 100,
      expiresAt: 200,
    };
    const authorizationDigest = digestCanonical(auth, sha256Digest);
    const verification = trustedVerifier.verify(auth, authorizationDigest);
    const events: ControlEventEnvelope[] = [];
    appendEnvelope(events, {
      eventId: "event:auth:early",
      rootExecutionId: "run:final",
      occurredAt: 99,
      idempotencyKey: "auth:early",
      payload: { type: "owner_authorization_registered", authorization: auth, verification },
    });
    expect(() => replayControlState(events, {
      ownerAuthorizationVerifier: trustedVerifier,
    })).toThrow(AgentFabricError);
  });

  test("replay requires permit admission time to equal the authoritative event time", () => {
    const clock = new ManualClock(4_000);
    const prepared = prepare(clock);
    const grant: ExecutionGrant = {
      ...prepared.parent,
      grantId: "grant:worker-a",
      subjectId: "worker:a",
      maximumAttempts: 1,
      resourceCeilings: {},
    };
    prepared.conductor.registerGrant(grant);
    const permit = permitFor(
      prepared.conductor,
      clock,
      prepared.revision.revisionId,
      grant,
      "temporal",
    );
    const events = prepared.journal.readAll().map((event) => structuredClone(event));
    const permitEvent = events.find(
      (event) => event.payload.type === "attempt_execution_permit_issued" &&
        event.payload.permit.permitId === permit.permitId,
    )!;
    if (permitEvent.payload.type !== "attempt_execution_permit_issued") throw new Error("permit missing");
    permitEvent.payload.permit.notBefore -= 1;

    // Rebuild the digest chain from the mutated permit onward.
    const index = events.indexOf(permitEvent);
    for (let i = index; i < events.length; i += 1) {
      const predecessor = events[i - 1];
      events[i]!.predecessorEventId = predecessor?.eventId ?? null;
      events[i]!.predecessorEventDigest = predecessor?.eventDigest ?? null;
      const { eventDigest: _digest, ...withoutDigest } = events[i]!;
      events[i]!.eventDigest = computeControlEventDigest(withoutDigest);
    }
    expect(() => replayControlState(events, {
      ownerAuthorizationVerifier: prepared.trustedVerifier,
    })).toThrow(AgentFabricError);
  });

  test("startupReportId and reportId are stream-global identities", () => {
    const clock = new ManualClock(5_000);
    const prepared = prepare(clock);
    const grantA: ExecutionGrant = {
      ...prepared.parent,
      grantId: "grant:a",
      subjectId: "worker:a",
      maximumAttempts: 1,
      resourceCeilings: {},
    };
    const grantB: ExecutionGrant = {
      ...prepared.parent,
      grantId: "grant:b",
      subjectId: "worker:b",
      maximumAttempts: 1,
      resourceCeilings: {},
    };
    prepared.conductor.registerGrant(grantA);
    prepared.conductor.registerGrant(grantB);

    const p1 = permitFor(prepared.conductor, clock, prepared.revision.revisionId, grantA, "one");
    const p2 = permitFor(prepared.conductor, clock, prepared.revision.revisionId, grantB, "two");

    prepared.conductor.acceptStartupReport(p1, {
      startupReportId: "startup:shared",
      attemptId: p1.attemptId,
      observedSpecDigest: p1.effectiveRunSpecDigest,
      startedAt: clock.now(),
    });
    expect(() => prepared.conductor.acceptStartupReport(p2, {
      startupReportId: "startup:shared",
      attemptId: p2.attemptId,
      observedSpecDigest: p2.effectiveRunSpecDigest,
      startedAt: clock.now(),
    })).toThrow(AgentFabricError);

    prepared.conductor.acceptStartupReport(p2, {
      startupReportId: "startup:two",
      attemptId: p2.attemptId,
      observedSpecDigest: p2.effectiveRunSpecDigest,
      startedAt: clock.now(),
    });
    prepared.conductor.commitOutcome(reportFor(p1, clock, "report:shared"));
    expect(() => prepared.conductor.commitOutcome(reportFor(p2, clock, "report:shared")))
      .toThrow(AgentFabricError);
  });

  test("runtime and JSON Schema agree on structural goal text semantics", () => {
    const schema = JSON.parse(
      readFileSync("schemas/agent-fabric/v0.1/control-event.schema.json", "utf8"),
    ) as { $defs: { goal: { properties: { objectives: { items: { minLength?: number } } } } } };
    expect(schema.$defs.goal.properties.objectives.items.minLength).toBeUndefined();

    const structural = {
      eventId: "event:goal-structural",
      rootExecutionId: "run:final",
      occurredAt: 1,
      payload: {
        type: "goal_registered",
        goal: {
          ...goal(),
          objectives: [""],
          acceptanceCriteria: [""],
        },
      },
    };
    expect(() => validateUncommittedControlEvent(structural)).not.toThrow();
  });

  test("cross-item resource uniqueness remains a replay semantic invariant", () => {
    const structural = {
      eventId: "event:ledger",
      rootExecutionId: "run:final",
      occurredAt: 1,
      payload: {
        type: "resource_ledger_initialized",
        definitions: [
          { resource: "calls", semantics: "consumable", limit: 5 },
          { resource: "calls", semantics: "capacity", limit: 5 },
        ],
      },
    };
    expect(() => validateUncommittedControlEvent(structural)).not.toThrow();

    const journal = new MemoryControlJournal();
    journal.append({ expectedSequence: 0, event: structural as any });
    expect(() => replayControlState(journal.readAll(), {
      ownerAuthorizationVerifier: verifier(),
      resourceDefinitions: [{ resource: "calls", semantics: "consumable", limit: 5 }],
    })).toThrow(AgentFabricError);
  });
});
