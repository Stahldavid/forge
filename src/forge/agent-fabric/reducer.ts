import {
  assertAuthorizationCurrent,
  assertGrantAttenuated,
  assertGrantLineageCurrent,
  assertRootGrantAuthorized,
} from "./authority.ts";
import { digestCanonical, sha256Digest, stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import { computeControlEventDigest } from "./journal.ts";
import { applyPlanDelta, computeRunPlanContentDigest } from "./planning.ts";
import type {
  ControlEventEnvelope,
  ControlState,
  ExecutionGrant,
  ReplayTrustContext,
  ResourceDefinition,
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
    resourceDefinitions: {},
    resourceReserved: {},
    resourceConsumed: {},
    resourceOwnerReserved: {},
    resourceOwnerConsumed: {},
    resourceReservations: {},
    goals: {},
    grants: {},
    revokedGrants: {},
    planDeltas: {},
    planRevisions: {},
    activePlanRevisionByExecution: {},
    dispatchIntents: {},
    claims: {},
    activeClaimByIntent: {},
    claimByAttemptId: {},
    permits: {},
    attempts: {},
    uncertaintyObservations: {},
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
    throw new AgentFabricError("AF_INVALID_EVENT", `Event ${event.eventId} has an invalid predecessor`);
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
  if (computeControlEventDigest(withoutDigest) !== event.eventDigest) {
    throw new AgentFabricError("AF_INVALID_EVENT", `Event ${event.eventId} digest does not match`);
  }
}

function sortedDefinitions(definitions: readonly ResourceDefinition[]): ResourceDefinition[] {
  const byName = new Map<string, ResourceDefinition>();
  for (const definition of definitions) {
    if (byName.has(definition.resource)) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Duplicate resource definition ${definition.resource}`);
    }
    if (!Number.isFinite(definition.limit) || definition.limit < 0) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Invalid resource limit ${definition.resource}`);
    }
    byName.set(definition.resource, { ...definition });
  }
  return [...byName.values()].sort((a, b) => a.resource.localeCompare(b.resource));
}

function resourceDefinitionMap(definitions: readonly ResourceDefinition[]) {
  return Object.fromEntries(definitions.map((definition) => [definition.resource, definition]));
}

function cloneNested(
  record: Readonly<Record<string, Readonly<Record<string, number>>>>,
): Record<string, Record<string, number>> {
  return Object.fromEntries(
    Object.entries(record).map(([owner, values]) => [owner, { ...values }]),
  );
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
  const seen = new Set<string>();
  const requestCeilings: Record<string, number> = {};
  for (const request of reservation.requests) {
    if (seen.has(request.resource)) return false;
    seen.add(request.resource);
    requestCeilings[request.resource] = request.amount;
  }
  return stableStringify(requestCeilings) === stableStringify(grant.resourceCeilings);
}

function applyReservationToState(
  state: ControlState,
  reservation: ResourceReservation,
): Pick<
  ControlState,
  | "resourceReserved"
  | "resourceConsumed"
  | "resourceOwnerReserved"
  | "resourceOwnerConsumed"
  | "resourceReservations"
> {
  if (state.resourceReservations[reservation.reservationId]) {
    throw new AgentFabricError(
      "AF_INVALID_EVENT",
      `Reservation already exists: ${reservation.reservationId}`,
    );
  }
  const reserved = { ...state.resourceReserved };
  const consumed = { ...state.resourceConsumed };
  const ownerReserved = cloneNested(state.resourceOwnerReserved);
  const ownerConsumed = cloneNested(state.resourceOwnerConsumed);
  const ownerReservedBucket = ownerReserved[reservation.ownerId] ?? {};
  const ownerConsumedBucket = ownerConsumed[reservation.ownerId] ?? {};
  ownerReserved[reservation.ownerId] = ownerReservedBucket;
  ownerConsumed[reservation.ownerId] = ownerConsumedBucket;

  const seen = new Set<string>();
  let hasNonCounter = false;
  for (const request of reservation.requests) {
    if (seen.has(request.resource)) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Reservation ${reservation.reservationId} repeats resource ${request.resource}`,
      );
    }
    seen.add(request.resource);
    const definition = state.resourceDefinitions[request.resource];
    if (!definition) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Unknown resource ${request.resource}`);
    }
    if (!Number.isFinite(request.amount) || request.amount <= 0) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Invalid resource amount ${request.resource}`);
    }
    if (definition.semantics === "counter") {
      const projected = (consumed[request.resource] ?? 0) + request.amount;
      if (projected > definition.limit) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Reservation exceeds global counter ${request.resource}`,
        );
      }
    } else {
      hasNonCounter = true;
      const projected =
        (reserved[request.resource] ?? 0) +
        (consumed[request.resource] ?? 0) +
        request.amount;
      if (projected > definition.limit) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Reservation exceeds global resource ${request.resource}`,
        );
      }
    }
  }

  const expectedStatus = hasNonCounter ? "active" : "consumed";
  if (reservation.status !== expectedStatus) {
    throw new AgentFabricError(
      "AF_INVALID_EVENT",
      `Reservation ${reservation.reservationId} has invalid initial status`,
    );
  }

  for (const request of reservation.requests) {
    const definition = state.resourceDefinitions[request.resource]!;
    if (definition.semantics === "counter") {
      consumed[request.resource] = (consumed[request.resource] ?? 0) + request.amount;
      ownerConsumedBucket[request.resource] =
        (ownerConsumedBucket[request.resource] ?? 0) + request.amount;
    } else {
      reserved[request.resource] = (reserved[request.resource] ?? 0) + request.amount;
      ownerReservedBucket[request.resource] =
        (ownerReservedBucket[request.resource] ?? 0) + request.amount;
    }
  }

  return {
    resourceReserved: reserved,
    resourceConsumed: consumed,
    resourceOwnerReserved: ownerReserved,
    resourceOwnerConsumed: ownerConsumed,
    resourceReservations: {
      ...state.resourceReservations,
      [reservation.reservationId]: reservation,
    },
  };
}

function transitionReservation(
  state: ControlState,
  reservationId: string,
  transition: "consume" | "release",
): Pick<
  ControlState,
  | "resourceReserved"
  | "resourceConsumed"
  | "resourceOwnerReserved"
  | "resourceOwnerConsumed"
  | "resourceReservations"
> {
  const current = state.resourceReservations[reservationId];
  if (!current) {
    throw new AgentFabricError("AF_INVALID_EVENT", `Unknown reservation ${reservationId}`);
  }
  const reserved = { ...state.resourceReserved };
  const consumed = { ...state.resourceConsumed };
  const ownerReserved = cloneNested(state.resourceOwnerReserved);
  const ownerConsumed = cloneNested(state.resourceOwnerConsumed);
  const ownerReservedBucket = ownerReserved[current.ownerId] ?? {};
  const ownerConsumedBucket = ownerConsumed[current.ownerId] ?? {};
  ownerReserved[current.ownerId] = ownerReservedBucket;
  ownerConsumed[current.ownerId] = ownerConsumedBucket;

  if (transition === "consume") {
    if (current.status === "released") {
      throw new AgentFabricError("AF_INVALID_EVENT", "Released reservation cannot be consumed");
    }
    if (current.status === "active") {
      for (const request of current.requests) {
        const definition = state.resourceDefinitions[request.resource]!;
        if (definition.semantics === "consumable") {
          reserved[request.resource] = (reserved[request.resource] ?? 0) - request.amount;
          consumed[request.resource] = (consumed[request.resource] ?? 0) + request.amount;
          ownerReservedBucket[request.resource] =
            (ownerReservedBucket[request.resource] ?? 0) - request.amount;
          ownerConsumedBucket[request.resource] =
            (ownerConsumedBucket[request.resource] ?? 0) + request.amount;
        }
      }
    }
    return {
      resourceReserved: reserved,
      resourceConsumed: consumed,
      resourceOwnerReserved: ownerReserved,
      resourceOwnerConsumed: ownerConsumed,
      resourceReservations: {
        ...state.resourceReservations,
        [reservationId]: { ...current, status: "consumed" },
      },
    };
  }

  if (current.status !== "released") {
    if (current.status === "active") {
      for (const request of current.requests) {
        const definition = state.resourceDefinitions[request.resource]!;
        if (definition.semantics !== "counter") {
          reserved[request.resource] = (reserved[request.resource] ?? 0) - request.amount;
          ownerReservedBucket[request.resource] =
            (ownerReservedBucket[request.resource] ?? 0) - request.amount;
        }
      }
    } else {
      for (const request of current.requests) {
        const definition = state.resourceDefinitions[request.resource]!;
        if (definition.semantics === "capacity") {
          reserved[request.resource] = (reserved[request.resource] ?? 0) - request.amount;
          ownerReservedBucket[request.resource] =
            (ownerReservedBucket[request.resource] ?? 0) - request.amount;
        }
      }
    }
  }
  return {
    resourceReserved: reserved,
    resourceConsumed: consumed,
    resourceOwnerReserved: ownerReserved,
    resourceOwnerConsumed: ownerConsumed,
    resourceReservations: {
      ...state.resourceReservations,
      [reservationId]: { ...current, status: "released" },
    },
  };
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
  trust: ReplayTrustContext,
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
    if (
      payload.verification.authorizationDigest !== expectedAuthorizationDigest ||
      !trust.ownerAuthorizationVerifier.verifyRecorded(authorization, payload.verification)
    ) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Owner authorization admission is not trusted");
    }
    return {
      ...next,
      authorizations: { ...state.authorizations, [authorization.authorizationId]: authorization },
      authorizationVerifications: {
        ...state.authorizationVerifications,
        [authorization.authorizationId]: payload.verification,
      },
    };
  }

  if (payload.type === "owner_authorization_revoked") {
    if (!state.authorizations[payload.authorizationId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Unknown owner authorization: ${payload.authorizationId}`);
    }
    return {
      ...next,
      revokedAuthorizations: {
        ...state.revokedAuthorizations,
        [payload.authorizationId]: payload.reason,
      },
    };
  }

  if (payload.type === "resource_ledger_initialized") {
    if (Object.keys(state.resourceDefinitions).length > 0) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Resource ledger is already initialized");
    }
    if (!trust.resourceDefinitions) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Replay lacks trusted resource definitions");
    }
    const recorded = sortedDefinitions(payload.definitions);
    const trusted = sortedDefinitions(trust.resourceDefinitions);
    if (stableStringify(recorded) !== stableStringify(trusted)) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Resource definitions do not match replay trust");
    }
    const definitions = resourceDefinitionMap(recorded);
    return {
      ...next,
      resourceDefinitions: definitions,
      resourceReserved: Object.fromEntries(recorded.map(({ resource }) => [resource, 0])),
      resourceConsumed: Object.fromEntries(recorded.map(({ resource }) => [resource, 0])),
    };
  }

  if (payload.type === "resource_reservation_consumed") {
    return { ...next, ...transitionReservation(state, payload.reservationId, "consume") };
  }

  if (payload.type === "resource_reservation_released") {
    return { ...next, ...transitionReservation(state, payload.reservationId, "release") };
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
      if (Object.keys(state.resourceDefinitions).length === 0) {
        throw new AgentFabricError("AF_INVALID_EVENT", "Derived grant precedes resource ledger initialization");
      }
      assertGrantLineageCurrent(state, parent.grantId, event.occurredAt);
      assertGrantAttenuated(parent, grant);
      if (!payload.reservation || !reservationMatchesGrant(payload.reservation, grant)) {
        throw new AgentFabricError(
          "AF_INVALID_EVENT",
          `Derived grant ${grant.grantId} is missing its matching reservation`,
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
      const accounting = applyReservationToState(state, payload.reservation);
      return {
        ...next,
        ...accounting,
        grants: { ...state.grants, [grant.grantId]: grant },
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
    if (
      siblingRoots.reduce((total, candidate) => total + candidate.maximumAttempts, 0) +
        grant.maximumAttempts >
      authorization.maximumAttempts
    ) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Root grants exceed owner attempt budget");
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
      throw new AgentFabricError("AF_INVALID_EVENT", `Plan revision already exists: ${revision.revisionId}`);
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
      if (revision.goalId !== parent.goalId || revision.programVersionId !== parent.programVersionId) {
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
      throw new AgentFabricError("AF_INVALID_EVENT", `Dispatch intent already exists: ${intent.intentId}`);
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
      throw new AgentFabricError("AF_INVALID_EVENT", `Claim references unknown intent ${claim.intentId}`);
    }
    if (state.claimByAttemptId[claim.attemptId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Attempt ID already claimed: ${claim.attemptId}`);
    }
    if (state.activePlanRevisionByExecution[event.rootExecutionId] !== intent.planRevisionId) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Claim targets a superseded plan revision");
    }
    if (claim.committedAt !== event.occurredAt || claim.leaseExpiresAt <= claim.committedAt) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Claim timestamps are inconsistent");
    }
    if (Object.values(state.outcomes).some((outcome) => outcome.intentId === claim.intentId)) {
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
      throw new AgentFabricError("AF_INVALID_EVENT", `Claim ${claim.claimId} overlaps a current lease`);
    }
    if (claim.fencingToken !== (currentClaim?.fencingToken ?? 0) + 1) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Claim ${claim.claimId} has an invalid fencing token`);
    }
    return {
      ...next,
      claims: { ...state.claims, [claim.claimId]: claim },
      activeClaimByIntent: { ...state.activeClaimByIntent, [claim.intentId]: claim.claimId },
      claimByAttemptId: { ...state.claimByAttemptId, [claim.attemptId]: claim.claimId },
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
      state.claimByAttemptId[permit.attemptId] !== claim.claimId ||
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
    if (
      issuedAttemptsForGrant(state, grant.grantId) + delegatedAttemptBudget(state, grant.grantId) >=
      grant.maximumAttempts
    ) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Grant attempt budget is exhausted");
    }
    return { ...next, permits: { ...state.permits, [permit.permitId]: permit } };
  }

  if (payload.type === "attempt_started") {
    const permit = state.permits[payload.permitId];
    if (!permit || payload.attemptId !== permit.attemptId) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Attempt does not match a known permit");
    }
    if (state.attempts[payload.attemptId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", `Attempt already exists: ${payload.attemptId}`);
    }
    const claim = state.claims[permit.claimId];
    const grant = state.grants[permit.grantId];
    if (
      !claim ||
      !grant ||
      state.claimByAttemptId[payload.attemptId] !== claim.claimId ||
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
        },
      },
    };
  }

  if (payload.type === "attempt_uncertainty_observed") {
    const observation = payload.observation;
    const permit = state.permits[observation.permitId];
    if (!permit || observation.attemptId !== permit.attemptId) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Uncertainty observation does not match its permit");
    }
    if (observation.observedAt !== event.occurredAt) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Uncertainty observation timestamp is inconsistent");
    }
    if (observation.phase === "outcome" && !state.attempts[observation.attemptId]) {
      throw new AgentFabricError("AF_INVALID_EVENT", "Outcome uncertainty requires a confirmed startup");
    }
    if (state.uncertaintyObservations[observation.observationId]) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Uncertainty observation already exists: ${observation.observationId}`,
      );
    }
    return {
      ...next,
      uncertaintyObservations: {
        ...state.uncertaintyObservations,
        [observation.observationId]: observation,
      },
    };
  }

  const outcome = payload.outcome;
  const attempt = state.attempts[outcome.attemptId];
  if (!attempt) {
    throw new AgentFabricError("AF_INVALID_EVENT", `Outcome references unknown attempt ${outcome.attemptId}`);
  }
  if (state.outcomes[outcome.attemptId]) {
    throw new AgentFabricError("AF_INVALID_EVENT", `Outcome already exists for attempt ${outcome.attemptId}`);
  }
  if (outcome.committedAt !== event.occurredAt) {
    throw new AgentFabricError("AF_INVALID_EVENT", "Outcome commit time must match its event time");
  }
  const permit = state.permits[attempt.permitId];
  const claim = permit ? state.claims[permit.claimId] : undefined;
  const grant = permit ? state.grants[permit.grantId] : undefined;
  const intent = permit ? state.dispatchIntents[permit.intentId] : undefined;
  if (
    !permit ||
    !claim ||
    !grant ||
    !intent ||
    outcome.permitId !== permit.permitId ||
    outcome.intentId !== permit.intentId ||
    outcome.planRevisionId !== permit.planRevisionId ||
    outcome.effectiveRunSpecDigest !== permit.effectiveRunSpecDigest ||
    outcome.fencingToken !== permit.fencingToken ||
    state.claimByAttemptId[outcome.attemptId] !== claim.claimId ||
    outcome.reportedAt < attempt.startedAt ||
    outcome.reportedAt > event.occurredAt ||
    event.occurredAt < permit.notBefore ||
    event.occurredAt >= permit.expiresAt ||
    state.activeClaimByIntent[permit.intentId] !== claim.claimId ||
    claim.fencingToken !== permit.fencingToken ||
    claim.leaseExpiresAt <= event.occurredAt ||
    state.activePlanRevisionByExecution[event.rootExecutionId] !== permit.planRevisionId
  ) {
    throw new AgentFabricError("AF_INVALID_EVENT", "Outcome committed without matching current authority");
  }
  assertGrantLineageCurrent(state, grant.grantId, event.occurredAt);
  return {
    ...next,
    outcomes: { ...state.outcomes, [outcome.attemptId]: outcome },
  };
}

export function replayControlState(
  events: readonly ControlEventEnvelope[],
  trust: ReplayTrustContext,
): ControlState {
  return events.reduce((state, event) => reduceControlEvent(state, event, trust), createEmptyControlState());
}
