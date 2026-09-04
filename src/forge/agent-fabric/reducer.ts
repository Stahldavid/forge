import { AgentFabricError } from "./errors.ts";
import type { ControlEventEnvelope, ControlState } from "./types.ts";

export function createEmptyControlState(): ControlState {
  return {
    lastSequence: 0,
    lastEventId: null,
    goals: {},
    grants: {},
    revokedGrants: {},
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
  };

  const payload = event.payload;
  if (payload.type === "goal_registered") {
    if (state.goals[payload.goal.goalId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Goal already exists: ${payload.goal.goalId}`);
    }
    return { ...next, goals: { ...state.goals, [payload.goal.goalId]: payload.goal } };
  }

  if (payload.type === "grant_registered") {
    if (state.grants[payload.grant.grantId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Grant already exists: ${payload.grant.grantId}`);
    }
    if (payload.grant.parentGrantId && !state.grants[payload.grant.parentGrantId]) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Derived grant references unknown parent ${payload.grant.parentGrantId}`,
      );
    }
    return { ...next, grants: { ...state.grants, [payload.grant.grantId]: payload.grant } };
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
    const current = state.activePlanRevisionByExecution[revision.rootExecutionId] ?? null;
    if (revision.parentRevisionId !== current) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Plan revision ${revision.revisionId} does not extend the active revision`,
      );
    }
    const expectedRevisionNumber = current
      ? (state.planRevisions[current]?.revisionNumber ?? 0) + 1
      : 1;
    if (revision.revisionNumber !== expectedRevisionNumber) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Plan revision ${revision.revisionId} has an invalid revision number`,
      );
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
    if (state.activePlanRevisionByExecution[intent.rootExecutionId] !== intent.planRevisionId) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Dispatch intent references a non-current plan revision ${intent.planRevisionId}`,
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
    if (!state.dispatchIntents[claim.intentId]) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Claim references unknown intent ${claim.intentId}`,
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
      event.occurredAt < grant.notBefore ||
      event.occurredAt >= grant.expiresAt ||
      state.revokedGrants[grant.grantId]
    ) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Permit was issued under a non-current grant");
    }
    return { ...next, permits: { ...state.permits, [permit.permitId]: permit } };
  }

  if (payload.type === "attempt_started") {
    const permit = state.permits[payload.permitId];
    if (!permit) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Attempt references unknown permit ${payload.permitId}`,
      );
    }
    if (state.attempts[payload.attemptId]) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Attempt already exists: ${payload.attemptId}`,
      );
    }
    const claim = state.claims[permit.claimId];
    const grant = state.grants[permit.grantId];
    if (
      !claim ||
      !grant ||
      payload.attemptId !== permit.attemptId ||
      state.activeClaimByIntent[permit.intentId] !== claim.claimId ||
      claim.leaseExpiresAt <= event.occurredAt ||
      event.occurredAt < permit.notBefore ||
      event.occurredAt >= permit.expiresAt ||
      event.occurredAt < grant.notBefore ||
      event.occurredAt >= grant.expiresAt ||
      state.revokedGrants[grant.grantId] ||
      state.activePlanRevisionByExecution[event.rootExecutionId] !== permit.planRevisionId
    ) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Attempt started without current authority");
    }
    return {
      ...next,
      attempts: {
        ...state.attempts,
        [payload.attemptId]: { permitId: payload.permitId, startedAt: payload.startedAt },
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
  const permit = state.permits[attempt.permitId];
  const claim = permit ? state.claims[permit.claimId] : undefined;
  const grant = permit ? state.grants[permit.grantId] : undefined;
  if (
    !permit ||
    !claim ||
    !grant ||
    state.activeClaimByIntent[permit.intentId] !== claim.claimId ||
    claim.fencingToken !== permit.fencingToken ||
    claim.leaseExpiresAt <= event.occurredAt ||
    event.occurredAt >= grant.expiresAt ||
    state.revokedGrants[grant.grantId] ||
    state.activePlanRevisionByExecution[event.rootExecutionId] !== permit.planRevisionId
  ) {
    throw new AgentFabricError("AF_INVALID_EVENT", "Outcome committed without current authority");
  }
  return {
    ...next,
    outcomes: { ...state.outcomes, [outcome.attemptId]: outcome },
  };
}

export function replayControlState(events: readonly ControlEventEnvelope[]): ControlState {
  return events.reduce(reduceControlEvent, createEmptyControlState());
}
