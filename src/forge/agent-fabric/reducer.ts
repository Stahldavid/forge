import {
  assertAuthorizationCurrent,
  assertGrantAttenuated,
  assertGrantLineageCurrent,
  assertRootGrantAuthorized,
} from "./authority.ts";
import { AgentFabricError } from "./errors.ts";
import { computeControlEventDigest } from "./journal.ts";
import { applyPlanDelta, computeRunPlanContentDigest } from "./planning.ts";
import { digestCanonical, sha256Digest, stableStringify } from "./canonical.ts";
import type {
  ControlEventEnvelope,
  ControlState,
  ExecutionGrant,
  ResourceReservation,
} from "./types.ts";
import { validateControlEventEnvelope } from "./validation.ts";

export function createEmptyControlState(): ControlState {
  return {
    lastSequence: 0,
    lastEventId: null,
    lastEventDigest: null,
    lastOccurredAt: null,
    authorizations: {},
    authorizationVerifications: {},
    revokedAuthorizations: {},
    goals: {},
    grants: {},
    revokedGrants: {},
    resourceReservations: {},
    planDeltas: {},
    planRevisions: {},
    activePlanRevisionByExecution: {},
    dispatchIntents: {},
    claims: {},
    activeClaimByIntent: {},
    permits: {},
    attempts: {},
    outcomes: {},
  };
}

function assertEnvelopeContinuity(state: ControlState, event: ControlEventEnvelope): void {
  validateControlEventEnvelope(event);
  if (event.sequence !== state.lastSequence + 1) {
    throw new AgentFabricError(
      "AF_INVALID_EVENT",
      `Expected event sequence ${state.lastSequence + 1}, received ${event.sequence}`,
    );
  }
  if (event.predecessorEventId !== state.lastEventId) {
    throw new AgentFabricError(
      "AF_INVALID_EVENT",
      `Event ${event.eventId} has an invalid predecessor`,
    );
  }
  if (event.predecessorEventDigest !== state.lastEventDigest) {
    throw new AgentFabricError(
      "AF_INVALID_EVENT",
      `Event ${event.eventId} has an invalid predecessor digest`,
    );
  }
  if (state.lastOccurredAt !== null && event.occurredAt < state.lastOccurredAt) {
    throw new AgentFabricError("AF_INVALID_EVENT", "Control event timestamps are not monotonic");
  }
  const { eventDigest: _eventDigest, ...withoutDigest } = event;
  const expectedDigest = computeControlEventDigest(withoutDigest);
  if (expectedDigest !== event.eventDigest) {
    throw new AgentFabricError("AF_INVALID_EVENT", `Event ${event.eventId} digest does not match`);
  }
}

function reservationMatchesGrant(reservation: ResourceReservation, grant: ExecutionGrant): boolean {
  if (!grant.parentGrantId || !grant.reservationId) return false;
  if (
    reservation.reservationId !== grant.reservationId ||
    reservation.ownerId !== grant.parentGrantId ||
    reservation.status === "released"
  ) {
    return false;
  }
  const requestCeilings = Object.fromEntries(
    reservation.requests.map((request) => [request.resource, request.amount]),
  );
  return stableStringify(requestCeilings) === stableStringify(grant.resourceCeilings);
}

function issuedAttemptsForGrant(state: ControlState, grantId: string): number {
  return Object.values(state.permits).filter((permit) => permit.grantId === grantId).length;
}

function delegatedAttemptBudget(state: ControlState, grantId: string): number {
  return Object.values(state.grants)
    .filter((candidate) => candidate.parentGrantId === grantId)
    .reduce((total, candidate) => total + candidate.maximumAttempts, 0);
}

export function reduceControlEvent(
  state: ControlState,
  event: ControlEventEnvelope,
): ControlState {
  assertEnvelopeContinuity(state, event);
  const next: ControlState = {
    ...state,
    lastSequence: event.sequence,
    lastEventId: event.eventId,
    lastEventDigest: event.eventDigest,
    lastOccurredAt: event.occurredAt,
  };

  const payload = event.payload;

  if (payload.type === "owner_authorization_registered") {
    const authorization = payload.authorization;
    if (state.authorizations[authorization.authorizationId]) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Owner authorization already exists: ${authorization.authorizationId}`,
      );
    }
    if (authorization.rootExecutionId !== event.rootExecutionId) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Owner authorization is in the wrong root execution");
    }
    if (authorization.expiresAt <= authorization.notBefore) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Owner authorization has an invalid time window");
    }
    const expectedAuthorizationDigest = digestCanonical(authorization, sha256Digest);
    if (payload.verification.authorizationDigest !== expectedAuthorizationDigest) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Owner authorization verification is not content-bound");
    }
    return {
      ...next,
      authorizations: {
        ...state.authorizations,
        [authorization.authorizationId]: authorization,
      },
      authorizationVerifications: {
        ...state.authorizationVerifications,
        [authorization.authorizationId]: payload.verification,
      },
    };
  }

  if (payload.type === "owner_authorization_revoked") {
    if (!state.authorizations[payload.authorizationId]) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Unknown owner authorization: ${payload.authorizationId}`,
      );
    }
    return {
      ...next,
      revokedAuthorizations: {
        ...state.revokedAuthorizations,
        [payload.authorizationId]: payload.reason,
      },
    };
  }

  if (payload.type === "goal_registered") {
    const authorization = state.authorizations[payload.goal.authorityInvocationId];
    if (!authorization) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Goal ${payload.goal.goalId} has no registered owner authorization`,
      );
    }
    assertAuthorizationCurrent(
      authorization,
      event.occurredAt,
      state.revokedAuthorizations[authorization.authorizationId],
    );
    if (!authorization.goalIds.includes(payload.goal.goalId)) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Owner authorization does not cover this goal");
    }
    if (state.goals[payload.goal.goalId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Goal already exists: ${payload.goal.goalId}`);
    }
    return { ...next, goals: { ...state.goals, [payload.goal.goalId]: payload.goal } };
  }

  if (payload.type === "grant_registered") {
    const grant = payload.grant;
    if (state.grants[grant.grantId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Grant already exists: ${grant.grantId}`);
    }

    if (grant.parentGrantId) {
      const parent = state.grants[grant.parentGrantId];
      if (!parent) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Derived grant references unknown parent ${grant.parentGrantId}`,
        );
      }
      assertGrantLineageCurrent(state, parent.grantId, event.occurredAt);
      assertGrantAttenuated(parent, grant);
      if (!payload.reservation || !reservationMatchesGrant(payload.reservation, grant)) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Derived grant ${grant.grantId} is missing its matching reservation`,
        );
      }
      if (state.resourceReservations[payload.reservation.reservationId]) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Reservation already exists: ${payload.reservation.reservationId}`,
        );
      }
      if (
        issuedAttemptsForGrant(state, parent.grantId) +
          delegatedAttemptBudget(state, parent.grantId) +
          grant.maximumAttempts >
        parent.maximumAttempts
      ) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Derived grants exceed parent attempt budget ${parent.grantId}`,
        );
      }
      for (const [resource, amount] of Object.entries(grant.resourceCeilings)) {
        const allocated = Object.values(state.grants)
          .filter((candidate) => candidate.parentGrantId === parent.grantId)
          .reduce((total, candidate) => total + (candidate.resourceCeilings[resource] ?? 0), 0);
        if (allocated + amount > (parent.resourceCeilings[resource] ?? -1)) {
          throw new AgentFabricError(
            "AF_INVALID_EVENT",
            `Derived grants exceed parent resource ${resource}`,
          );
        }
      }
      return {
        ...next,
        grants: { ...state.grants, [grant.grantId]: grant },
        resourceReservations: {
          ...state.resourceReservations,
          [payload.reservation.reservationId]: payload.reservation,
        },
      };
    }

    if (payload.reservation !== null) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Root grant cannot carry a child reservation");
    }
    const authorization = state.authorizations[grant.rootAuthorizationId];
    if (!authorization) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Root grant ${grant.grantId} has no registered owner authorization`,
      );
    }
    if (authorization.rootExecutionId !== event.rootExecutionId) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Root grant authorization is in the wrong execution");
    }
    assertAuthorizationCurrent(
      authorization,
      event.occurredAt,
      state.revokedAuthorizations[authorization.authorizationId],
    );
    assertRootGrantAuthorized(authorization, grant);

    const siblingRoots = Object.values(state.grants).filter(
      (candidate) => candidate.parentGrantId === null &&
        candidate.rootAuthorizationId === authorization.authorizationId,
    );
    const allocatedRootAttempts = siblingRoots.reduce(
      (total, candidate) => total + candidate.maximumAttempts,
      0,
    );
    if (allocatedRootAttempts + grant.maximumAttempts > authorization.maximumAttempts) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        "Root grants exceed the owner authorization attempt budget",
      );
    }
    for (const [resource, amount] of Object.entries(grant.resourceCeilings)) {
      const allocated = siblingRoots.reduce(
        (total, candidate) => total + (candidate.resourceCeilings[resource] ?? 0),
        0,
      );
      if (allocated + amount > (authorization.resourceCeilings[resource] ?? -1)) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Root grants exceed owner authorization resource ${resource}`,
        );
      }
    }
    return { ...next, grants: { ...state.grants, [grant.grantId]: grant } };
  }

  if (payload.type === "grant_revoked") {
    if (!state.grants[payload.grantId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Unknown grant: ${payload.grantId}`);
    }
    return {
      ...next,
      revokedGrants: { ...state.revokedGrants, [payload.grantId]: payload.reason },
    };
  }

  if (payload.type === "plan_delta_registered") {
    const delta = payload.delta;
    if (delta.rootExecutionId !== event.rootExecutionId) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Plan delta is in the wrong root execution");
    }
    if (state.planDeltas[delta.deltaId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Plan delta already exists: ${delta.deltaId}`);
    }
    const base = state.planRevisions[delta.baseRevisionId];
    if (!base || state.activePlanRevisionByExecution[event.rootExecutionId] !== base.revisionId) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Plan delta does not target the active revision");
    }
    return { ...next, planDeltas: { ...state.planDeltas, [delta.deltaId]: delta } };
  }

  if (payload.type === "plan_revision_activated") {
    const revision = payload.revision;
    if (revision.rootExecutionId !== event.rootExecutionId) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Plan revision is in the wrong root execution");
    }
    if (!state.goals[revision.goalId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Unknown goal: ${revision.goalId}`);
    }
    if (state.planRevisions[revision.revisionId]) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Plan revision already exists: ${revision.revisionId}`,
      );
    }
    const expectedDigest = computeRunPlanContentDigest(
      revision.programVersionId,
      revision.nodes,
      sha256Digest,
    );
    if (revision.contentDigest !== expectedDigest) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Plan revision content digest does not match");
    }

    const currentId = state.activePlanRevisionByExecution[revision.rootExecutionId] ?? null;
    if (revision.parentRevisionId !== currentId) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Plan revision ${revision.revisionId} does not extend the active revision`,
      );
    }
    if (currentId === null) {
      if (revision.revisionNumber !== 1 || revision.sourcePlanDeltaId !== null) {
        throw new AgentFabricError("AF_INVALID_EVENT", "Initial plan revision has invalid lineage");
      }
    } else {
      const parent = state.planRevisions[currentId]!;
      if (
        revision.goalId !== parent.goalId ||
        revision.programVersionId !== parent.programVersionId
      ) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          "Plan revision cannot silently change goal or workflow program",
        );
      }
      if (revision.revisionNumber !== parent.revisionNumber + 1 || !revision.sourcePlanDeltaId) {
        throw new AgentFabricError("AF_INVALID_EVENT", "Plan revision has invalid revision lineage");
      }
      const delta = state.planDeltas[revision.sourcePlanDeltaId];
      if (
        !delta ||
        delta.rootExecutionId !== revision.rootExecutionId ||
        delta.baseRevisionId !== parent.revisionId ||
        delta.nextRevisionId !== revision.revisionId
      ) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          "Plan revision is not backed by its registered PlanDelta",
        );
      }
      const derived = applyPlanDelta(parent, delta, sha256Digest);
      if (stableStringify(derived) !== stableStringify(revision)) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          "Plan revision content does not match its registered PlanDelta",
        );
      }
    }
    return {
      ...next,
      planRevisions: { ...state.planRevisions, [revision.revisionId]: revision },
      activePlanRevisionByExecution: {
        ...state.activePlanRevisionByExecution,
        [revision.rootExecutionId]: revision.revisionId,
      },
    };
  }

  if (payload.type === "dispatch_intent_committed") {
    const intent = payload.intent;
    if (intent.rootExecutionId !== event.rootExecutionId) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Dispatch intent is in the wrong root execution");
    }
    if (intent.createdAt > event.occurredAt) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Dispatch intent cannot be created in the future");
    }
    if (state.activePlanRevisionByExecution[intent.rootExecutionId] !== intent.planRevisionId) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Dispatch intent references a non-current plan revision ${intent.planRevisionId}`,
      );
    }
    const revision = state.planRevisions[intent.planRevisionId];
    const goal = revision ? state.goals[revision.goalId] : undefined;
    if (!goal) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Dispatch intent has no active GoalContract");
    }
    if (
      !goal.allowedEffectClasses.includes(intent.effectClass) ||
      goal.prohibitedEffectClasses.includes(intent.effectClass) ||
      (!goal.sourceBoundary.allowExpansion &&
        !intent.sourceIds.every((sourceId) => goal.sourceBoundary.sourceIds.includes(sourceId)))
    ) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Dispatch intent violates its GoalContract");
    }
    if (!revision.nodes.some((node) => node.nodeId === intent.taskNodeId)) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Dispatch intent references missing plan node ${intent.taskNodeId}`,
      );
    }
    if (state.dispatchIntents[intent.intentId]) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Dispatch intent already exists: ${intent.intentId}`,
      );
    }
    return {
      ...next,
      dispatchIntents: { ...state.dispatchIntents, [intent.intentId]: intent },
    };
  }

  if (payload.type === "scheduling_claim_committed") {
    const claim = payload.claim;
    const intent = state.dispatchIntents[claim.intentId];
    if (!intent) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Claim references unknown intent ${claim.intentId}`,
      );
    }
    if (state.activePlanRevisionByExecution[event.rootExecutionId] !== intent.planRevisionId) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Claim targets a superseded plan revision");
    }
    if (claim.committedAt !== event.occurredAt || claim.leaseExpiresAt <= claim.committedAt) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Claim timestamps are inconsistent");
    }
    const hasOutcome = Object.values(state.outcomes).some((outcome) => {
      const attempt = state.attempts[outcome.attemptId];
      const permit = attempt ? state.permits[attempt.permitId] : undefined;
      return permit?.intentId === claim.intentId;
    });
    if (hasOutcome) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Claim ${claim.claimId} targets an intent with an existing outcome`,
      );
    }
    if (state.claims[claim.claimId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Claim already exists: ${claim.claimId}`);
    }
    const currentClaimId = state.activeClaimByIntent[claim.intentId];
    const currentClaim = currentClaimId ? state.claims[currentClaimId] : undefined;
    if (currentClaim && currentClaim.leaseExpiresAt > event.occurredAt) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Claim ${claim.claimId} overlaps a current lease`,
      );
    }
    if (claim.fencingToken !== (currentClaim?.fencingToken ?? 0) + 1) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Claim ${claim.claimId} has an invalid fencing token`,
      );
    }
    return {
      ...next,
      claims: { ...state.claims, [claim.claimId]: claim },
      activeClaimByIntent: { ...state.activeClaimByIntent, [claim.intentId]: claim.claimId },
    };
  }

  if (payload.type === "attempt_execution_permit_issued") {
    const permit = payload.permit;
    const claim = state.claims[permit.claimId];
    const grant = state.grants[permit.grantId];
    const intent = state.dispatchIntents[permit.intentId];
    if (!claim || !grant || !intent) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Permit references missing authority state");
    }
    if (state.permits[permit.permitId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Permit already exists: ${permit.permitId}`);
    }
    if (
      state.activeClaimByIntent[permit.intentId] !== claim.claimId ||
      permit.attemptId !== claim.attemptId ||
      permit.workerId !== claim.workerId ||
      permit.fencingToken !== claim.fencingToken ||
      permit.planRevisionId !== intent.planRevisionId ||
      permit.effectiveRunSpecDigest !== intent.effectiveRunSpecDigest
    ) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Permit does not match its claim or intent");
    }
    if (
      grant.subjectId !== permit.workerId ||
      !grant.capabilities.includes(intent.requiredCapability) ||
      !grant.effectClasses.includes(intent.effectClass) ||
      !intent.sourceIds.every((sourceId) => grant.sourceIds.includes(sourceId)) ||
      !grant.targetIds.includes(intent.targetId) ||
      permit.notBefore > event.occurredAt ||
      event.occurredAt >= permit.expiresAt ||
      permit.expiresAt > claim.leaseExpiresAt ||
      permit.expiresAt > grant.expiresAt
    ) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Permit exceeds its grant, claim, or intent");
    }
    assertGrantLineageCurrent(state, grant.grantId, event.occurredAt);
    const priorPermitsForGrant = issuedAttemptsForGrant(state, grant.grantId);
    if (priorPermitsForGrant + delegatedAttemptBudget(state, grant.grantId) >= grant.maximumAttempts) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Grant attempt budget is exhausted");
    }
    return { ...next, permits: { ...state.permits, [permit.permitId]: permit } };
  }

  if (payload.type === "attempt_started" || payload.type === "attempt_start_unknown") {
    const permit = state.permits[payload.permitId];
    if (!permit) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Attempt references unknown permit ${payload.permitId}`,
      );
    }
    if (payload.attemptId !== permit.attemptId) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Attempt does not match its permit");
    }
    if (state.attempts[payload.attemptId]) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Attempt already exists: ${payload.attemptId}`,
      );
    }

    if (payload.type === "attempt_start_unknown") {
      if (payload.observedAt !== event.occurredAt) {
        throw new AgentFabricError("AF_INVALID_EVENT", "Unknown-start observation time is inconsistent");
      }
      return {
        ...next,
        attempts: {
          ...state.attempts,
          [payload.attemptId]: {
            permitId: payload.permitId,
            startupStatus: "unknown",
            startedAt: null,
            startupReportId: null,
            startupUnknownReason: payload.reason,
          },
        },
      };
    }

    const claim = state.claims[permit.claimId];
    const grant = state.grants[permit.grantId];
    if (
      !claim ||
      !grant ||
      payload.startedAt < permit.notBefore ||
      payload.startedAt > event.occurredAt ||
      payload.startedAt >= permit.expiresAt ||
      state.activeClaimByIntent[permit.intentId] !== claim.claimId ||
      claim.leaseExpiresAt <= event.occurredAt ||
      event.occurredAt < permit.notBefore ||
      event.occurredAt >= permit.expiresAt ||
      state.activePlanRevisionByExecution[event.rootExecutionId] !== permit.planRevisionId
    ) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Attempt started without current authority");
    }
    assertGrantLineageCurrent(state, grant.grantId, event.occurredAt);
    return {
      ...next,
      attempts: {
        ...state.attempts,
        [payload.attemptId]: {
          permitId: payload.permitId,
          startupStatus: "started",
          startedAt: payload.startedAt,
          startupReportId: payload.startupReportId,
          startupUnknownReason: null,
        },
      },
    };
  }

  const outcome = payload.outcome;
  const attempt = state.attempts[outcome.attemptId];
  if (!attempt) {
    throw new AgentFabricError(
      "AF_INVALID_EVENT",
      `Outcome references unknown attempt ${outcome.attemptId}`,
    );
  }
  if (state.outcomes[outcome.attemptId]) {
    throw new AgentFabricError(
      "AF_INVALID_EVENT",
      `Outcome already exists for attempt ${outcome.attemptId}`,
    );
  }
  if (outcome.committedAt !== event.occurredAt) {
    throw new AgentFabricError("AF_INVALID_EVENT", "Outcome commit time must match its event time");
  }
  if (outcome.status === "unknown") {
    if (
      outcome.resultDigest !== null ||
      outcome.reportId !== null ||
      outcome.reportDigest !== null ||
      outcome.reportedAt !== null ||
      outcome.evidenceDigests.length !== 0
    ) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Unknown outcome cannot claim a result report");
    }
    return {
      ...next,
      outcomes: { ...state.outcomes, [outcome.attemptId]: outcome },
    };
  }
  if (attempt.startupStatus !== "started" || attempt.startedAt === null) {
    throw new AgentFabricError(
      "AF_INVALID_EVENT",
      "A non-unknown outcome requires a confirmed startup",
    );
  }
  if (
    outcome.reportId === null ||
    outcome.reportDigest === null ||
    outcome.reportedAt === null ||
    outcome.reportedAt < attempt.startedAt ||
    outcome.reportedAt > event.occurredAt
  ) {
    throw new AgentFabricError("AF_INVALID_EVENT", "Outcome result provenance is incomplete or inconsistent");
  }
  const permit = state.permits[attempt.permitId];
  const claim = permit ? state.claims[permit.claimId] : undefined;
  const grant = permit ? state.grants[permit.grantId] : undefined;
  if (
    !permit ||
    !claim ||
    !grant ||
    event.occurredAt < permit.notBefore ||
    event.occurredAt >= permit.expiresAt ||
    state.activeClaimByIntent[permit.intentId] !== claim.claimId ||
    claim.fencingToken !== permit.fencingToken ||
    claim.leaseExpiresAt <= event.occurredAt ||
    state.activePlanRevisionByExecution[event.rootExecutionId] !== permit.planRevisionId
  ) {
    throw new AgentFabricError("AF_INVALID_EVENT", "Outcome committed without current authority");
  }
  assertGrantLineageCurrent(state, grant.grantId, event.occurredAt);
  return {
    ...next,
    outcomes: { ...state.outcomes, [outcome.attemptId]: outcome },
  };
}

export function replayControlState(events: readonly ControlEventEnvelope[]): ControlState {
  return events.reduce(reduceControlEvent, createEmptyControlState());
}
