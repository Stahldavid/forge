import {
  assertAuthorizationCurrent,
  assertGrantLineageCurrent,
  assertRootGrantAuthorized,
  deriveExecutionGrant,
} from "./authority.ts";
import { digestCanonical, sha256Digest, stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import type { ControlJournal } from "./journal.ts";
import { applyPlanDelta, computeRunPlanContentDigest, validateWorkflowNodes } from "./planning.ts";
import { replayControlState } from "./reducer.ts";
import type { ResourceLedger } from "./resource-ledger.ts";
import type {
  AttemptExecutionPermit,
  AttemptUncertaintyObservation,
  AuthoritativeOutcomeCommit,
  AuthorityResolution,
  Clock,
  DerivedGrantRequest,
  DigestFunction,
  DispatchIntent,
  DispatchOffer,
  ExecutionGrant,
  ExecutorStartupReport,
  GoalContract,
  OwnerAuthorization,
  OwnerAuthorizationVerifier,
  PlanDelta,
  ResourceDefinition,
  ResourceReservation,
  RunPlanRevision,
  SchedulingClaim,
  WorkerResultReport,
} from "./types.ts";

export interface ClaimDispatchInput {
  claimId: string;
  intentId: string;
  workerId: string;
  attemptId: string;
  leaseDurationMs: number;
}

export interface IssuePermitInput {
  permitId: string;
  claimId: string;
  grantId: string;
  maximumValidityMs: number;
}

function sortedDefinitions(definitions: Readonly<Record<string, ResourceDefinition>>): ResourceDefinition[] {
  return Object.values(definitions)
    .map((definition) => ({ ...definition }))
    .sort((left, right) => left.resource.localeCompare(right.resource));
}

export class ForgeAgentConductor {
  constructor(
    private readonly rootExecutionId: string,
    private readonly journal: ControlJournal,
    private readonly clock: Clock,
    // Retained for the draft P0a constructor shape. Normative P0a digests are fixed to SHA-256.
    _digest: DigestFunction,
    private readonly ownerAuthorizationVerifier: OwnerAuthorizationVerifier,
    private readonly resourceLedger?: ResourceLedger,
  ) {}

  state() {
    return replayControlState(this.journal.readAll(), {
      ownerAuthorizationVerifier: this.ownerAuthorizationVerifier,
      resourceDefinitions: this.resourceLedger
        ? sortedDefinitions(this.resourceLedger.snapshot().definitions)
        : undefined,
    });
  }

  events() {
    return this.journal.readAll();
  }

  registerOwnerAuthorization(authorization: OwnerAuthorization): void {
    if (authorization.rootExecutionId !== this.rootExecutionId) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "Owner authorization belongs to another execution");
    }
    assertAuthorizationCurrent(authorization, this.clock.now());
    const authorizationDigest = digestCanonical(authorization, sha256Digest);
    const verification = this.ownerAuthorizationVerifier.verify(authorization, authorizationDigest);
    if (
      verification.authorizationDigest !== authorizationDigest ||
      !this.ownerAuthorizationVerifier.verifyRecorded(authorization, verification)
    ) {
      throw new AgentFabricError(
        "AF_GRANT_REJECTED",
        "Owner authorization verification is not trusted for these authorization bytes",
      );
    }
    this.append(`owner-authorization:${authorization.authorizationId}`, {
      type: "owner_authorization_registered",
      authorization,
      verification,
    });
  }

  revokeOwnerAuthorization(authorizationId: string, reason: string): void {
    const state = this.state();
    if (!state.authorizations[authorizationId]) {
      throw new AgentFabricError("AF_NOT_FOUND", `Unknown owner authorization: ${authorizationId}`);
    }
    this.append(`owner-authorization-revocation:${authorizationId}`, {
      type: "owner_authorization_revoked",
      authorizationId,
      reason,
    });
  }

  registerGoal(goal: GoalContract): void {
    const state = this.state();
    const authorization = state.authorizations[goal.authorityInvocationId];
    if (!authorization) {
      throw new AgentFabricError(
        "AF_GRANT_REJECTED",
        `Goal ${goal.goalId} has no registered owner authorization`,
      );
    }
    assertAuthorizationCurrent(
      authorization,
      this.clock.now(),
      state.revokedAuthorizations[authorization.authorizationId],
    );
    if (!authorization.goalIds.includes(goal.goalId)) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "Owner authorization does not cover this goal");
    }
    this.append(`goal:${goal.goalId}`, { type: "goal_registered", goal });
  }

  /** Registers only a root grant. Derived grants must use deriveAndRegisterGrant(). */
  registerGrant(grant: ExecutionGrant): void {
    if (grant.parentGrantId !== null) {
      throw new AgentFabricError(
        "AF_GRANT_REJECTED",
        "Derived grants must be atomically reserved and registered",
      );
    }
    const state = this.state();
    const authorization = state.authorizations[grant.rootAuthorizationId];
    if (!authorization) {
      throw new AgentFabricError(
        "AF_GRANT_REJECTED",
        `Root grant ${grant.grantId} has no registered owner authorization`,
      );
    }
    assertAuthorizationCurrent(
      authorization,
      this.clock.now(),
      state.revokedAuthorizations[authorization.authorizationId],
    );
    assertRootGrantAuthorized(authorization, grant);

    const siblingRoots = Object.values(state.grants).filter(
      (candidate) => candidate.parentGrantId === null &&
        candidate.rootAuthorizationId === authorization.authorizationId,
    );
    const allocatedAttempts = siblingRoots.reduce(
      (total, candidate) => total + candidate.maximumAttempts,
      0,
    );
    if (allocatedAttempts + grant.maximumAttempts > authorization.maximumAttempts) {
      throw new AgentFabricError(
        "AF_RESOURCE_EXHAUSTED",
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
          "AF_RESOURCE_EXHAUSTED",
          `Root grants exceed owner authorization resource ${resource}`,
        );
      }
    }

    this.append(`grant:${grant.grantId}`, {
      type: "grant_registered",
      grant,
      reservation: null,
    });
  }

  deriveAndRegisterGrant(
    parentGrantId: string,
    request: DerivedGrantRequest,
    ledger: ResourceLedger = this.requireResourceLedger(),
  ): AuthorityResolution {
    this.ensureResourceLedgerInitialized(ledger);
    const state = this.state();
    const parent = state.grants[parentGrantId];
    if (!parent) {
      throw new AgentFabricError("AF_NOT_FOUND", `Unknown parent grant: ${parentGrantId}`);
    }
    const now = this.clock.now();
    assertGrantLineageCurrent(state, parent.grantId, now);

    const parentIssuedAttempts = Object.values(state.permits).filter(
      (permit) => permit.grantId === parent.grantId,
    ).length;
    const delegatedAttemptBudget = Object.values(state.grants)
      .filter((candidate) => candidate.parentGrantId === parent.grantId)
      .reduce((total, candidate) => total + candidate.maximumAttempts, 0);
    if (
      parentIssuedAttempts + delegatedAttemptBudget + request.maximumAttempts >
      parent.maximumAttempts
    ) {
      return {
        outcome: "rejected",
        reasonCodes: ["attempt_budget_exhausted"],
        limitations: [],
      };
    }

    return ledger.transaction(() => {
      const resolution = deriveExecutionGrant(parent, request, ledger, now);
      if (resolution.outcome !== "allowed" || !resolution.grant) return resolution;
      const reservation = ledger.snapshot().reservations[request.reservationId];
      if (!reservation) {
        throw new AgentFabricError(
          "AF_RESOURCE_EXHAUSTED",
          `Reservation ${request.reservationId} was not materialized`,
        );
      }
      this.append(`grant:${resolution.grant.grantId}`, {
        type: "grant_registered",
        grant: resolution.grant,
        reservation,
      });
      return resolution;
    });
  }

  consumeResourceReservation(
    reservationId: string,
    ledger: ResourceLedger = this.requireResourceLedger(),
  ): ResourceReservation {
    this.ensureResourceLedgerInitialized(ledger);
    return ledger.transaction(() => {
      const reservation = ledger.consume(reservationId);
      this.append(`resource-reservation-consume:${reservationId}`, {
        type: "resource_reservation_consumed",
        reservationId,
      });
      return reservation;
    });
  }

  releaseResourceReservation(
    reservationId: string,
    ledger: ResourceLedger = this.requireResourceLedger(),
  ): ResourceReservation {
    this.ensureResourceLedgerInitialized(ledger);
    return ledger.transaction(() => {
      const reservation = ledger.release(reservationId);
      this.append(`resource-reservation-release:${reservationId}`, {
        type: "resource_reservation_released",
        reservationId,
      });
      return reservation;
    });
  }

  revokeGrant(grantId: string, reason: string): void {
    const state = this.state();
    if (!state.grants[grantId]) {
      throw new AgentFabricError("AF_NOT_FOUND", `Unknown grant: ${grantId}`);
    }
    this.append(`grant-revocation:${grantId}`, { type: "grant_revoked", grantId, reason });
  }

  registerPlanDelta(delta: PlanDelta): void {
    const state = this.state();
    if (delta.rootExecutionId !== this.rootExecutionId) {
      throw new AgentFabricError("AF_INVALID_PLAN", "PlanDelta belongs to another execution");
    }
    if (state.activePlanRevisionByExecution[this.rootExecutionId] !== delta.baseRevisionId) {
      throw new AgentFabricError("AF_INVALID_PLAN", "PlanDelta is stale");
    }
    this.append(`plan-delta:${delta.deltaId}`, { type: "plan_delta_registered", delta });
  }

  activatePlan(revision: RunPlanRevision, expectedCurrentRevisionId: string | null): void {
    const state = this.state();
    const current = state.activePlanRevisionByExecution[this.rootExecutionId] ?? null;
    if (current !== expectedCurrentRevisionId) {
      throw new AgentFabricError(
        "AF_CONFLICT",
        "Plan activation compare-and-swap failed",
        { actualRevisionId: current, expectedCurrentRevisionId },
      );
    }
    if (revision.rootExecutionId !== this.rootExecutionId) {
      throw new AgentFabricError("AF_INVALID_PLAN", "Plan revision belongs to another execution");
    }
    validateWorkflowNodes(revision.nodes);
    const expectedDigest = computeRunPlanContentDigest(
      revision.programVersionId,
      revision.nodes,
      sha256Digest,
    );
    if (revision.contentDigest !== expectedDigest) {
      throw new AgentFabricError("AF_INVALID_PLAN", "Plan revision content digest does not match");
    }

    if (expectedCurrentRevisionId === null) {
      if (
        revision.parentRevisionId !== null ||
        revision.sourcePlanDeltaId !== null ||
        revision.revisionNumber !== 1
      ) {
        throw new AgentFabricError("AF_INVALID_PLAN", "Initial plan revision has invalid lineage");
      }
    } else {
      const parent = state.planRevisions[expectedCurrentRevisionId];
      if (!parent || revision.parentRevisionId !== parent.revisionId) {
        throw new AgentFabricError(
          "AF_INVALID_PLAN",
          "Plan revision parent does not match the active revision",
        );
      }
      if (revision.goalId !== parent.goalId || revision.programVersionId !== parent.programVersionId) {
        throw new AgentFabricError(
          "AF_INVALID_PLAN",
          "Plan revision cannot silently change goal or workflow program",
        );
      }
      if (revision.revisionNumber !== parent.revisionNumber + 1 || !revision.sourcePlanDeltaId) {
        throw new AgentFabricError("AF_INVALID_PLAN", "Plan revision has invalid revision lineage");
      }
      const delta = state.planDeltas[revision.sourcePlanDeltaId];
      if (
        !delta ||
        delta.baseRevisionId !== parent.revisionId ||
        delta.nextRevisionId !== revision.revisionId ||
        delta.rootExecutionId !== this.rootExecutionId
      ) {
        throw new AgentFabricError(
          "AF_INVALID_PLAN",
          "Plan revision is not backed by its registered PlanDelta",
        );
      }
      const derived = applyPlanDelta(parent, delta, sha256Digest);
      if (stableStringify(derived) !== stableStringify(revision)) {
        throw new AgentFabricError(
          "AF_INVALID_PLAN",
          "Plan revision content does not match its registered PlanDelta",
        );
      }
    }

    this.append(`plan-activation:${revision.revisionId}`, {
      type: "plan_revision_activated",
      revision,
    });
  }

  commitDispatchIntent(intent: DispatchIntent): void {
    const state = this.state();
    const activeRevision = state.activePlanRevisionByExecution[this.rootExecutionId];
    if (intent.rootExecutionId !== this.rootExecutionId || intent.planRevisionId !== activeRevision) {
      throw new AgentFabricError(
        "AF_INVALID_STATE",
        "Dispatch intent is not bound to the active plan revision",
      );
    }
    if (intent.createdAt > this.clock.now()) {
      throw new AgentFabricError("AF_INVALID_STATE", "Dispatch intent cannot be created in the future");
    }
    const revision = state.planRevisions[intent.planRevisionId];
    const goal = revision ? state.goals[revision.goalId] : undefined;
    if (!goal) {
      throw new AgentFabricError("AF_INVALID_PLAN", "Dispatch intent has no active GoalContract");
    }
    if (
      !goal.allowedEffectClasses.includes(intent.effectClass) ||
      goal.prohibitedEffectClasses.includes(intent.effectClass)
    ) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "GoalContract prohibits the intent effect class");
    }
    if (
      !goal.sourceBoundary.allowExpansion &&
      !intent.sourceIds.every((sourceId) => goal.sourceBoundary.sourceIds.includes(sourceId))
    ) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "Intent expands the GoalContract source boundary");
    }
    if (!revision.nodes.some((node) => node.nodeId === intent.taskNodeId)) {
      throw new AgentFabricError(
        "AF_INVALID_PLAN",
        `Dispatch intent references missing plan node ${intent.taskNodeId}`,
      );
    }
    this.append(`dispatch-intent:${intent.intentId}`, {
      type: "dispatch_intent_committed",
      intent,
    });
  }

  createDispatchOffer(
    intentId: string,
    audiencePool: string,
    offerId: string,
    expiresAt: number,
  ): DispatchOffer {
    if (!this.state().dispatchIntents[intentId]) {
      throw new AgentFabricError("AF_NOT_FOUND", `Unknown dispatch intent: ${intentId}`);
    }
    if (expiresAt <= this.clock.now()) {
      throw new AgentFabricError("AF_INVALID_STATE", "Dispatch offer must expire in the future");
    }
    return { offerId, intentId, audiencePool, expiresAt, nonAuthoritative: true };
  }

  claimDispatch(input: ClaimDispatchInput): SchedulingClaim {
    if (input.leaseDurationMs <= 0) {
      throw new AgentFabricError("AF_INVALID_STATE", "Lease duration must be positive");
    }
    const state = this.state();
    const intent = state.dispatchIntents[input.intentId];
    if (!intent) {
      throw new AgentFabricError("AF_NOT_FOUND", `Unknown dispatch intent: ${input.intentId}`);
    }
    if (state.claimByAttemptId[input.attemptId]) {
      throw new AgentFabricError("AF_DUPLICATE_ID", `Attempt ID already claimed: ${input.attemptId}`);
    }
    if (state.activePlanRevisionByExecution[this.rootExecutionId] !== intent.planRevisionId) {
      throw new AgentFabricError("AF_STALE_ATTEMPT", "Cannot claim an intent from a superseded plan");
    }
    const hasOutcome = Object.values(state.outcomes).some(
      (outcome) => outcome.intentId === input.intentId,
    );
    if (hasOutcome) {
      throw new AgentFabricError(
        "AF_CONFLICT",
        `Dispatch intent ${input.intentId} already has an outcome`,
      );
    }
    const currentClaimId = state.activeClaimByIntent[input.intentId];
    const currentClaim = currentClaimId ? state.claims[currentClaimId] : undefined;
    const now = this.clock.now();
    if (currentClaim && currentClaim.leaseExpiresAt > now) {
      throw new AgentFabricError(
        "AF_CONFLICT",
        `Dispatch intent ${input.intentId} already has a current claim`,
      );
    }
    const claim: SchedulingClaim = {
      claimId: input.claimId,
      intentId: input.intentId,
      workerId: input.workerId,
      attemptId: input.attemptId,
      leaseExpiresAt: now + input.leaseDurationMs,
      fencingToken: (currentClaim?.fencingToken ?? 0) + 1,
      committedAt: now,
    };
    this.append(`claim:${input.intentId}:${claim.fencingToken}`, {
      type: "scheduling_claim_committed",
      claim,
    });
    return claim;
  }

  issuePermit(input: IssuePermitInput): AttemptExecutionPermit {
    if (input.maximumValidityMs <= 0) {
      throw new AgentFabricError("AF_PERMIT_REJECTED", "Permit validity must be positive");
    }
    const state = this.state();
    const claim = state.claims[input.claimId];
    const grant = state.grants[input.grantId];
    if (!claim) throw new AgentFabricError("AF_NOT_FOUND", `Unknown claim: ${input.claimId}`);
    if (!grant) throw new AgentFabricError("AF_NOT_FOUND", `Unknown grant: ${input.grantId}`);
    const intent = state.dispatchIntents[claim.intentId];
    if (!intent) throw new AgentFabricError("AF_NOT_FOUND", `Unknown intent: ${claim.intentId}`);
    const activeClaimId = state.activeClaimByIntent[claim.intentId];
    const now = this.clock.now();
    if (state.activePlanRevisionByExecution[this.rootExecutionId] !== intent.planRevisionId) {
      throw new AgentFabricError("AF_STALE_ATTEMPT", "Intent references a superseded plan revision");
    }
    if (activeClaimId !== claim.claimId || claim.leaseExpiresAt <= now) {
      throw new AgentFabricError("AF_STALE_ATTEMPT", "Claim is no longer current");
    }
    assertGrantLineageCurrent(state, grant.grantId, now);
    if (!grant.capabilities.includes(intent.requiredCapability)) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "Grant lacks the required capability");
    }
    if (!intent.sourceIds.every((sourceId) => grant.sourceIds.includes(sourceId))) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "Grant does not cover the intent source scope");
    }
    if (!grant.targetIds.includes(intent.targetId)) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "Grant does not cover the intent target");
    }
    if (!grant.effectClasses.includes(intent.effectClass)) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "Grant lacks the required effect class");
    }
    if (grant.subjectId !== claim.workerId) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "Grant is bound to another worker");
    }
    const issuedAttempts = Object.values(state.permits).filter(
      (permit) => permit.grantId === grant.grantId,
    ).length;
    const delegatedAttemptBudget = Object.values(state.grants)
      .filter((candidate) => candidate.parentGrantId === grant.grantId)
      .reduce((total, candidate) => total + candidate.maximumAttempts, 0);
    if (issuedAttempts + delegatedAttemptBudget >= grant.maximumAttempts) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "Grant attempt budget is exhausted");
    }
    const expiresAt = Math.min(claim.leaseExpiresAt, grant.expiresAt, now + input.maximumValidityMs);
    const permit: AttemptExecutionPermit = {
      permitId: input.permitId,
      intentId: intent.intentId,
      claimId: claim.claimId,
      attemptId: claim.attemptId,
      workerId: claim.workerId,
      planRevisionId: intent.planRevisionId,
      effectiveRunSpecDigest: intent.effectiveRunSpecDigest,
      grantId: grant.grantId,
      fencingToken: claim.fencingToken,
      notBefore: now,
      expiresAt,
    };
    this.append(`permit:${permit.permitId}`, {
      type: "attempt_execution_permit_issued",
      permit,
    });
    return permit;
  }

  authorizeAttemptDispatch(permit: AttemptExecutionPermit): void {
    this.assertPermitCurrent(permit);
  }

  acceptStartupReport(permit: AttemptExecutionPermit, report: ExecutorStartupReport): void {
    this.assertPermitCurrent(permit);
    const now = this.clock.now();
    if (report.attemptId !== permit.attemptId) {
      throw new AgentFabricError("AF_PERMIT_REJECTED", "Startup report is bound to another attempt");
    }
    if (report.observedSpecDigest !== permit.effectiveRunSpecDigest) {
      throw new AgentFabricError("AF_PERMIT_REJECTED", "Adapter started a different EffectiveRunSpec");
    }
    if (
      report.startedAt < permit.notBefore ||
      report.startedAt >= permit.expiresAt ||
      report.startedAt > now
    ) {
      throw new AgentFabricError("AF_PERMIT_REJECTED", "Startup report has an invalid timestamp");
    }
    this.append(`attempt-start:${permit.attemptId}`, {
      type: "attempt_started",
      attemptId: permit.attemptId,
      permitId: permit.permitId,
      startupReportId: report.startupReportId,
      startedAt: report.startedAt,
    });
  }

  recordAttemptUncertainty(
    permit: AttemptExecutionPermit,
    phase: "startup" | "outcome",
    reason: string,
  ): AttemptUncertaintyObservation {
    const state = this.state();
    const recorded = state.permits[permit.permitId];
    if (!recorded || stableStringify(recorded) !== stableStringify(permit)) {
      throw new AgentFabricError("AF_PERMIT_REJECTED", "Permit is not the recorded permit");
    }
    const observedAt = this.clock.now();
    const observation: AttemptUncertaintyObservation = {
      observationId: `uncertainty:${permit.attemptId}:${phase}:${observedAt}:${sha256Digest(reason).slice(7, 19)}`,
      attemptId: permit.attemptId,
      permitId: permit.permitId,
      phase,
      reason,
      observedAt,
    };
    this.append(`attempt-uncertainty:${observation.observationId}`, {
      type: "attempt_uncertainty_observed",
      observation,
    });
    return observation;
  }

  commitOutcome(report: WorkerResultReport): AuthoritativeOutcomeCommit {
    const state = this.state();
    const attempt = state.attempts[report.attemptId];
    if (!attempt) {
      throw new AgentFabricError("AF_NOT_FOUND", `Unknown started attempt: ${report.attemptId}`);
    }
    const permit = state.permits[attempt.permitId];
    if (!permit) {
      throw new AgentFabricError("AF_NOT_FOUND", `Unknown permit: ${attempt.permitId}`);
    }
    const claim = state.claims[permit.claimId];
    const intent = state.dispatchIntents[permit.intentId];
    if (!claim || !intent) {
      throw new AgentFabricError("AF_INVALID_STATE", "Outcome has incomplete execution lineage");
    }
    if (
      report.permitId !== permit.permitId ||
      report.intentId !== permit.intentId ||
      report.planRevisionId !== permit.planRevisionId ||
      report.effectiveRunSpecDigest !== permit.effectiveRunSpecDigest ||
      report.fencingToken !== permit.fencingToken ||
      state.claimByAttemptId[report.attemptId] !== claim.claimId
    ) {
      throw new AgentFabricError(
        "AF_CONFLICT",
        "Worker result report does not match its recorded attempt/permit lineage",
      );
    }

    const reportDigest = digestCanonical(report, sha256Digest);
    const existing = state.outcomes[report.attemptId];
    if (existing) {
      if (existing.status === report.status && existing.reportDigest === reportDigest) return existing;
      throw new AgentFabricError(
        "AF_CONFLICT",
        `Attempt ${report.attemptId} already has a different authoritative outcome`,
      );
    }

    const now = this.clock.now();
    if (report.reportedAt < attempt.startedAt || report.reportedAt > now) {
      throw new AgentFabricError("AF_INVALID_STATE", "Worker result report has an invalid timestamp");
    }
    if (now < permit.notBefore || now >= permit.expiresAt) {
      throw new AgentFabricError("AF_STALE_ATTEMPT", "Expired permit cannot commit an outcome");
    }
    if (
      state.activeClaimByIntent[permit.intentId] !== claim.claimId ||
      claim.fencingToken !== permit.fencingToken ||
      claim.leaseExpiresAt <= now
    ) {
      throw new AgentFabricError("AF_STALE_ATTEMPT", "Stale attempt cannot commit an outcome");
    }
    if (state.activePlanRevisionByExecution[this.rootExecutionId] !== permit.planRevisionId) {
      throw new AgentFabricError("AF_STALE_ATTEMPT", "Superseded plan attempt cannot commit an outcome");
    }
    assertGrantLineageCurrent(state, permit.grantId, now);

    const outcome: AuthoritativeOutcomeCommit = {
      outcomeId: `outcome:${report.attemptId}`,
      attemptId: report.attemptId,
      permitId: permit.permitId,
      intentId: permit.intentId,
      planRevisionId: permit.planRevisionId,
      effectiveRunSpecDigest: permit.effectiveRunSpecDigest,
      fencingToken: permit.fencingToken,
      status: report.status,
      resultDigest: report.resultDigest,
      reportId: report.reportId,
      reportDigest,
      evidenceDigests: [...report.evidenceDigests],
      reportedAt: report.reportedAt,
      committedAt: now,
    };
    this.append(`attempt-outcome:${report.attemptId}`, {
      type: "attempt_outcome_committed",
      outcome,
    });
    return outcome;
  }

  private assertPermitCurrent(permit: AttemptExecutionPermit): void {
    const state = this.state();
    const recorded = state.permits[permit.permitId];
    if (!recorded || stableStringify(recorded) !== stableStringify(permit)) {
      throw new AgentFabricError("AF_PERMIT_REJECTED", "Permit is not the recorded permit");
    }
    const now = this.clock.now();
    if (now < permit.notBefore || now >= permit.expiresAt) {
      throw new AgentFabricError("AF_PERMIT_REJECTED", "Permit is outside its validity window");
    }
    const claim = state.claims[permit.claimId];
    const activeClaimId = state.activeClaimByIntent[permit.intentId];
    if (
      !claim ||
      state.claimByAttemptId[permit.attemptId] !== claim.claimId ||
      activeClaimId !== claim.claimId ||
      claim.fencingToken !== permit.fencingToken ||
      claim.workerId !== permit.workerId ||
      claim.leaseExpiresAt <= now
    ) {
      throw new AgentFabricError("AF_STALE_ATTEMPT", "Permit is fenced by a newer claim");
    }
    assertGrantLineageCurrent(state, permit.grantId, now);
    if (state.activePlanRevisionByExecution[this.rootExecutionId] !== permit.planRevisionId) {
      throw new AgentFabricError("AF_STALE_ATTEMPT", "Permit references a superseded plan revision");
    }
  }

  private ensureResourceLedgerInitialized(ledger: ResourceLedger): void {
    const trustedDefinitions = sortedDefinitions(ledger.snapshot().definitions);
    const state = this.state();
    const recordedDefinitions = sortedDefinitions(state.resourceDefinitions);
    if (recordedDefinitions.length === 0) {
      this.append("resource-ledger:initialize", {
        type: "resource_ledger_initialized",
        definitions: trustedDefinitions,
      });
      return;
    }
    if (stableStringify(recordedDefinitions) !== stableStringify(trustedDefinitions)) {
      throw new AgentFabricError(
        "AF_INVALID_STATE",
        "ResourceLedger definitions differ from the journaled configuration",
      );
    }
  }

  private requireResourceLedger(): ResourceLedger {
    if (!this.resourceLedger) {
      throw new AgentFabricError(
        "AF_INVALID_STATE",
        "Derived grant registration requires a ResourceLedger",
      );
    }
    return this.resourceLedger;
  }

  private append(
    idempotencyKey: string,
    payload: Parameters<ControlJournal["append"]>[0]["event"]["payload"],
  ): void {
    const state = this.state();
    this.journal.append({
      expectedSequence: state.lastSequence,
      event: {
        eventId: `event:${idempotencyKey}`,
        rootExecutionId: this.rootExecutionId,
        occurredAt: this.clock.now(),
        idempotencyKey,
        payload,
      },
    });
  }
}
