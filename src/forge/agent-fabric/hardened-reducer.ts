import { digestCanonical, sha256Digest } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import { replayControlState as replayLegacyControlState } from "./reducer.ts";
import type {
  AttemptExecutionPermit,
  ControlEventEnvelope,
  ControlState,
  ReplayTrustContext,
  WorkerResultReport,
} from "./types.ts";

function assertSingleRootExecution(events: readonly ControlEventEnvelope[]): void {
  const rootExecutionId = events[0]?.rootExecutionId;
  if (!rootExecutionId) return;
  for (const event of events) {
    if (event.rootExecutionId !== rootExecutionId) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Control stream mixes root executions ${rootExecutionId} and ${event.rootExecutionId}`,
      );
    }
  }
}

function assertStreamIdentityAndTemporalInvariants(
  events: readonly ControlEventEnvelope[],
): void {
  const eventIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  const startupReportIds = new Set<string>();
  const reportIds = new Set<string>();
  const outcomeIds = new Set<string>();

  for (const event of events) {
    if (eventIds.has(event.eventId)) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Duplicate event ID ${event.eventId}`);
    }
    eventIds.add(event.eventId);

    if (event.idempotencyKey !== undefined) {
      if (idempotencyKeys.has(event.idempotencyKey)) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Duplicate idempotency key ${event.idempotencyKey}`,
        );
      }
      idempotencyKeys.add(event.idempotencyKey);
    }

    if (event.payload.type === "owner_authorization_registered") {
      const authorization = event.payload.authorization;
      if (event.occurredAt < authorization.notBefore || event.occurredAt >= authorization.expiresAt) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Owner authorization ${authorization.authorizationId} was admitted outside its validity window`,
        );
      }
    }

    if (event.payload.type === "attempt_execution_permit_issued") {
      if (event.payload.permit.notBefore !== event.occurredAt) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Permit ${event.payload.permit.permitId} admission time differs from event time`,
        );
      }
    }

    if (event.payload.type === "attempt_started") {
      if (startupReportIds.has(event.payload.startupReportId)) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Startup report ID was reused: ${event.payload.startupReportId}`,
        );
      }
      startupReportIds.add(event.payload.startupReportId);
    }

    if (event.payload.type === "attempt_outcome_committed") {
      const outcome = event.payload.outcome;
      if (outcomeIds.has(outcome.outcomeId)) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Outcome ID was reused: ${outcome.outcomeId}`,
        );
      }
      outcomeIds.add(outcome.outcomeId);
      if (reportIds.has(outcome.reportId)) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Worker report ID was reused: ${outcome.reportId}`,
        );
      }
      reportIds.add(outcome.reportId);
    }
  }
}

function assertPermitGoalAuthorityBinding(
  state: ControlState,
  permit: AttemptExecutionPermit,
): void {
  const intent = state.dispatchIntents[permit.intentId];
  const revision = state.planRevisions[permit.planRevisionId];
  const grant = state.grants[permit.grantId];
  const goal = revision ? state.goals[revision.goalId] : undefined;
  const authorization = grant ? state.authorizations[grant.rootAuthorizationId] : undefined;

  if (!intent || !revision || !grant || !goal || !authorization) {
    throw new AgentFabricError(
      "AF_INVALID_EVENT",
      `Permit ${permit.permitId} has incomplete goal/authority lineage`,
    );
  }

  if (
    intent.planRevisionId !== revision.revisionId ||
    intent.rootExecutionId !== revision.rootExecutionId ||
    authorization.rootExecutionId !== revision.rootExecutionId ||
    goal.authorityInvocationId !== grant.rootAuthorizationId ||
    !authorization.goalIds.includes(goal.goalId)
  ) {
    throw new AgentFabricError(
      "AF_INVALID_EVENT",
      `Permit ${permit.permitId} uses authority that is not bound to its GoalContract`,
    );
  }
}

function workerReportFromOutcome(
  outcome: ControlState["outcomes"][string],
): WorkerResultReport {
  return {
    reportId: outcome.reportId,
    attemptId: outcome.attemptId,
    permitId: outcome.permitId,
    intentId: outcome.intentId,
    planRevisionId: outcome.planRevisionId,
    effectiveRunSpecDigest: outcome.effectiveRunSpecDigest,
    fencingToken: outcome.fencingToken,
    status: outcome.status,
    resultDigest: outcome.resultDigest,
    evidenceDigests: [...outcome.evidenceDigests],
    reportedAt: outcome.reportedAt,
  };
}

function assertReplayOnlyInvariants(
  events: readonly ControlEventEnvelope[],
  state: ControlState,
): void {
  const permitByAttemptId = new Map<string, string>();

  for (const event of events) {
    if (event.payload.type === "attempt_execution_permit_issued") {
      const permit = event.payload.permit;
      const existingPermitId = permitByAttemptId.get(permit.attemptId);
      if (existingPermitId) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Attempt ${permit.attemptId} has multiple permits: ${existingPermitId}, ${permit.permitId}`,
        );
      }
      permitByAttemptId.set(permit.attemptId, permit.permitId);
      assertPermitGoalAuthorityBinding(state, permit);
    }

    if (event.payload.type === "attempt_outcome_committed") {
      const outcome = event.payload.outcome;
      const expectedReportDigest = digestCanonical(workerReportFromOutcome(outcome), sha256Digest);
      if (outcome.reportDigest !== expectedReportDigest) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Outcome ${outcome.outcomeId} report digest does not match its persisted report fields`,
        );
      }
      const permit = state.permits[outcome.permitId];
      if (!permit) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Outcome ${outcome.outcomeId} references an unknown permit`,
        );
      }
      assertPermitGoalAuthorityBinding(state, permit);
    }
  }
}

export function replayControlState(
  events: readonly ControlEventEnvelope[],
  trust: ReplayTrustContext,
): ControlState {
  assertSingleRootExecution(events);
  assertStreamIdentityAndTemporalInvariants(events);
  const state = replayLegacyControlState(events, trust);
  assertReplayOnlyInvariants(events, state);
  return state;
}
