import {
  ForgeAgentConductor, MemoryControlJournal, ResourceLedger, computeControlEventDigest,
  createRunPlanRevision, sha256Digest, applyPlanDelta,
  type AttemptExecutionPermit, type Clock, type ControlEventEnvelope, type DerivedGrantRequest,
  type ExecutionGrant, type OwnerAuthorization, type OwnerAuthorizationVerifier,
  type ResourceDefinition, type WorkerResultReport,
} from "../../src/forge/agent-fabric/index.ts";

export class VectorClock implements Clock {
  constructor(public time = 1_000) {}
  now() { return this.time; }
}

// Synthetic, deterministic verifier: exercises content binding, not production identity.
export const vectorVerifier: OwnerAuthorizationVerifier = {
  verify(authorization, authorizationDigest) {
    return { verifierId: "s11-vector", authorizationDigest,
      evidenceDigest: sha256Digest(`s11:${authorization.principalId}:${authorizationDigest}`) };
  },
  verifyRecorded(authorization, verification) {
    return verification.verifierId === "s11-vector" && verification.evidenceDigest ===
      sha256Digest(`s11:${authorization.principalId}:${verification.authorizationDigest}`);
  },
};

export function makeHarness(options: {
  clock?: VectorClock; authorizationEnd?: number; grantEnd?: number;
  definitions?: readonly ResourceDefinition[];
} = {}) {
  const clock = options.clock ?? new VectorClock();
  const definitions = options.definitions ?? [
    { resource: "calls", semantics: "consumable" as const, limit: 100 },
    { resource: "workers", semantics: "capacity" as const, limit: 100 },
    { resource: "attempts", semantics: "counter" as const, limit: 100 },
  ];
  const journal = new MemoryControlJournal();
  const seed = new ResourceLedger(definitions);
  const conductor = new ForgeAgentConductor("run:s11", journal, clock, sha256Digest, vectorVerifier, seed);
  const authorization: OwnerAuthorization = {
    authorizationId: "auth:s11", principalId: "owner:s11", rootExecutionId: "run:s11",
    goalIds: ["goal:s11"], subjectIds: ["worker:s11", "child:s11", "grandchild:s11"],
    capabilities: ["read"], sourceIds: ["source:s11"], targetIds: ["target:s11"],
    effectClasses: ["read"], notBefore: 0, expiresAt: options.authorizationEnd ?? 10_000,
    maximumAttempts: 100, maximumDelegationDepth: 4,
    resourceCeilings: Object.fromEntries(definitions.map((d) => [d.resource, 100])),
  };
  conductor.registerOwnerAuthorization(authorization);
  conductor.registerGoal({ goalId: "goal:s11", revision: 1, authorityInvocationId: authorization.authorizationId,
    objectives: ["synthetic conformance"], nonObjectives: [], acceptanceCriteria: ["trace matches"],
    allowedEffectClasses: ["read"], prohibitedEffectClasses: ["consequential"],
    sourceBoundary: { sourceIds: ["source:s11"], allowExpansion: false } });
  const root: ExecutionGrant = {
    grantId: "grant:s11", rootAuthorizationId: authorization.authorizationId, subjectId: "worker:s11",
    parentGrantId: null, capabilities: ["read"], sourceIds: ["source:s11"], targetIds: ["target:s11"],
    effectClasses: ["read"], notBefore: 0,
    expiresAt: options.grantEnd ?? options.authorizationEnd ?? 10_000,
    maximumAttempts: 50, delegationDepthRemaining: 3,
    resourceCeilings: Object.fromEntries(definitions.map((d) => [d.resource, 50])),
  };
  conductor.registerGrant(root);
  const revision = createRunPlanRevision("run:s11", "goal:s11", {
    programId: "program:s11", version: 1, nodes: [{ nodeId: "node:s11", kind: "activity", dependsOn: [],
      agentSpecId: "agent:s11", harnessSpecId: "harness:s11", executionProfileId: "profile:s11" }],
  }, "plan:s11", sha256Digest);
  conductor.activatePlan(revision, null);
  const trust = { ownerAuthorizationVerifier: vectorVerifier, resourceDefinitions: definitions };
  return { conductor, journal, seed, clock, definitions, authorization, root, revision, trust };
}

export type Harness = ReturnType<typeof makeHarness>;

export function childRequest(h: Harness, id = "child", parent = h.root): DerivedGrantRequest {
  return { grantId: `grant:${id}`, subjectId: id === "grandchild" ? "grandchild:s11" : "child:s11",
    capabilities: [...parent.capabilities], sourceIds: [...parent.sourceIds], targetIds: [...parent.targetIds],
    effectClasses: [...parent.effectClasses], notBefore: h.clock.now(), expiresAt: parent.expiresAt,
    maximumAttempts: 5, delegationDepthRemaining: parent.delegationDepthRemaining - 1,
    reservationId: `reservation:${id}`, resourceRequests: [{ resource: h.definitions[0]!.resource, amount: 1 }] };
}

export function deriveChild(h: Harness, id = "child", parent = h.root) {
  const resolution = h.conductor.deriveAndRegisterGrant(parent.grantId, childRequest(h, id, parent));
  if (resolution.outcome !== "allowed" || !resolution.grant) throw new Error(`fixture derivation: ${JSON.stringify(resolution)}`);
  return resolution.grant;
}

export function intent(h: Harness, id = "one") {
  const value = { intentId: `intent:${id}`, rootExecutionId: "run:s11", planRevisionId: h.revision.revisionId,
    taskNodeId: "node:s11", effectiveRunSpecDigest: sha256Digest(`spec:${id}`), sourceIds: ["source:s11"],
    targetId: "target:s11", requiredCapability: "read", effectClass: "read" as const, createdAt: h.clock.now() };
  h.conductor.commitDispatchIntent(value);
  return value;
}

export function permit(h: Harness, id = "one", grant = h.root, lease = 500, validity = 400) {
  const value = intent(h, id);
  const claim = h.conductor.claimDispatch({ claimId: `claim:${id}`, intentId: value.intentId,
    workerId: grant.subjectId, attemptId: `attempt:${id}`, leaseDurationMs: lease });
  return h.conductor.issuePermit({ permitId: `permit:${id}`, claimId: claim.claimId,
    grantId: grant.grantId, maximumValidityMs: validity });
}

export function startup(h: Harness, p: AttemptExecutionPermit, startedAt = h.clock.now()) {
  const report = { startupReportId: `startup:${p.attemptId}`, attemptId: p.attemptId,
    observedSpecDigest: p.effectiveRunSpecDigest, startedAt };
  h.conductor.acceptStartupReport(p, report);
  return report;
}

export function report(h: Harness, p: AttemptExecutionPermit): WorkerResultReport {
  return { reportId: `report:${p.attemptId}`, attemptId: p.attemptId, permitId: p.permitId,
    intentId: p.intentId, planRevisionId: p.planRevisionId, effectiveRunSpecDigest: p.effectiveRunSpecDigest,
    fencingToken: p.fencingToken, status: "succeeded", resultDigest: sha256Digest("result:s11"),
    evidenceDigests: [sha256Digest("evidence:s11")], reportedAt: h.clock.now() };
}

export function rechain(events: readonly ControlEventEnvelope[]): ControlEventEnvelope[] {
  const result = structuredClone(events) as ControlEventEnvelope[];
  for (let i = 0; i < result.length; i++) {
    const event = result[i]!;
    event.sequence = i + 1;
    event.predecessorEventId = result[i - 1]?.eventId ?? null;
    event.predecessorEventDigest = result[i - 1]?.eventDigest ?? null;
    const { eventDigest: _, ...body } = event;
    event.eventDigest = computeControlEventDigest(body);
  }
  return result;
}

/** A valid trace containing every accepted control payload variant. */
export function completeTrace() {
  const h = makeHarness();
  const child = deriveChild(h);
  const p = permit(h, "complete", child);
  startup(h, p);
  h.conductor.recordAttemptUncertainty(p, "outcome", "synthetic pending evidence");
  h.conductor.commitOutcome(report(h, p));
  h.conductor.consumeResourceReservation(child.reservationId!);
  h.conductor.releaseResourceReservation(child.reservationId!);
  const delta = { deltaId: "delta:s11", rootExecutionId: "run:s11", baseRevisionId: h.revision.revisionId,
    nextRevisionId: "plan:s11:2", operations: [] };
  h.conductor.registerPlanDelta(delta);
  h.conductor.activatePlan(applyPlanDelta(h.revision, delta, sha256Digest), h.revision.revisionId);
  h.conductor.revokeGrant(child.grantId, "synthetic revoke");
  h.conductor.revokeOwnerAuthorization(h.authorization.authorizationId, "synthetic revoke");
  return h;
}
