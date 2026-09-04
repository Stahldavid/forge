import {
  assertAuthorizationCurrent,
  assertGrantLineageCurrent,
  assertRootGrantAuthorized,
  deriveExecutionGrant,
} from "./authority.ts";
import { digestCanonical, stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import type { ControlJournal } from "./journal.ts";
import { applyPlanDelta, computeRunPlanContentDigest, validateWorkflowNodes } from "./planning.ts";
import { replayControlState } from "./reducer.ts";
import type { ResourceLedger } from "./resource-ledger.ts";
import type {
  AttemptExecutionPermit,
  AuthoritativeOutcomeCommit,
  AuthorityResolution,
  Clock,
  DerivedGrantRequest,
  DigestFunction,
  DispatchIntent,
  DispatchOffer,
  ExecutionGrant,
  GoalContract,
  ExecutorStartupReport,
  OwnerAuthorization,
  OwnerAuthorizationVerifier,
  PlanDelta,
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

export class ForgeAgentConductor {
  constructor(
    private readonly rootExecutionId: string,
    private readonly journal: ControlJournal,
    private readonly clock: Clock,
    private readonly digest: DigestFunction,
    private readonly ownerAuthorizationVerifier: OwnerAuthorizationVerifier,
    private readonly resourceLedger?: ResourceLedger,
  ) {}

  state() {
    return replayControlState(this.journal.readAll());
  }

  events() {
    return this.journal.readAll();
  }

  registerOwnerAuthorization(authorization: OwnerAuthorization): void {
    if (authorization.rootExecutionId !== this.rootExecutionId) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "Owner authorization belongs to another execution");
    }
    assertAuthorizationCurrent(authorization, this.clock.now());
    const authorizationDigest = digestCanonical(authorization, this.digest);
    const verification = this.ownerAuthorizationVerifier.verify(authorization, authorizationDigest);
    if (verification.authorizationDigest !== authorizationDigest) {
      throw new AgentFabricError(
        "AF_GRANT_REJECTED",
        "Owner authorization verifier returned evidence for different authorization bytes",
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
    this.append(`goal:${goal.goalId}`, {
      type: "goal_registered",
      goal,
    });
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
    const state = this.state();
    const parent = state.grants[parentGrantId];
    if (!parent) {
      throw new AgentFabricError("AF_NOT_FOUND", `Unknown parent grant: ${parentGrantId}`);
    }
    const now = this.clock.now();
    assertGrantLineageCurrent(state, parent.grantId, now);

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

  revokeGrant(grantId: string, reason: string): void {
    const state = this.state();
    if (!state.grants[grantId]) {
      throw new AgentFabricError("AF_NOT_FOUND", `Unknown grant: ${grantId}`);
    }
    this.append(`grant-revocation:${grantId}`, {
      type: "grant_revoked",
      grantId,
      reason,
    });
  }

  registerPlanDelta(delta: PlanDelta): void {
    const state = this.state();
    if (delta.rootExecutionId !== this.rootExecutionId) {
      throw new AgentFabricError("AF_INVALID_PLAN", "PlanDelta belongs to another execution");
    }
    if (state.activePlanRevisionByExecution[this.rootExecutionId] !== delta.baseRevisionId) {
      throw new AgentFabricError("AF_INVALID_PLAN", "PlanDelta is stale");
    }
    this.append(`plan-delta:${delta.deltaId}`, {
      type: "plan_delta_registered",
      delta,
    });
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
      this.digest,
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
      if (
        revision.goalId !== parent.goalId ||
        revision.programVersionId !== parent.programVersionId
      ) {
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
      const derived = applyPlanDelta(parent, delta, this.digest);
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
    const hasOutcome = Object.values(state.outcomes).some((outcome) => {
      const attempt = state.attempts[outcome.attemptId];
      const permit = attempt ? state.permits[attempt.permitId] : undefined;
      return permit?.intentId === input.intentId;
    });
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
    const intent = state.dispatchIntents[claim.intentId]!;
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
    if (issuedAttempts >= grant.maximumAttempts) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "Grant attempt limit is exhausted");
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

  acceptStartupReport(
    permit: AttemptExecutionPermit,
    report: ExecutorStartupReport,
  ): void {
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

  recordStartupUnknown(permit: AttemptExecutionPermit, reason: string): void {
    const state = this.state();
    const recorded = state.permits[permit.permitId];
    if (!recorded || this.digest(stableStringify(recorded)) !== this.digest(stableStringify(permit))) {
      throw new AgentFabricError("AF_PERMIT_REJECTED", "Permit is not the recorded permit");
    }
    this.append(`attempt-start-unknown:${permit.attemptId}`, {
      type: "attempt_start_unknown",
      attemptId: permit.attemptId,
      permitId: permit.permitId,
      reason,
      observedAt: this.clock.now(),
    });
  }

  private assertPermitCurrent(permit: AttemptExecutionPermit): void {
    const state = this.state();
    const recorded = state.permits[permit.permitId];
    if (!recorded || this.digest(stableStringify(recorded)) !== this.digest(stableStringify(permit))) {
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

  commitOutcome(report: WorkerResultReport): AuthoritativeOutcomeCommit {
    const state = this.state();
    const attempt = state.attempts[report.attemptId];
    if (!attempt) {
      throw new AgentFabricError("AF_NOT_FOUND", `Unknown attempt: ${report.attemptId}`);
    }
    const reportDigest = digestCanonical(report, this.digest);
    const existing = state.outcomes[report.attemptId];
    if (existing) {
      if (existing.status === report.status && existing.reportDigest === reportDigest) return existing;
      throw new AgentFabricError(
        "AF_CONFLICT",
        `Attempt ${report.attemptId} already has a different authoritative outcome`,
      );
    }
    if (attempt.startupStatus !== "started" || attempt.startedAt === null) {
      throw new AgentFabricError("AF_INVALID_STATE", "Unknown startup cannot commit a successful outcome");
    }
    const permit = state.permits[attempt.permitId]!;
    const claim = state.claims[permit.claimId]!;
    const now = this.clock.now();
    if (report.reportedAt < attempt.startedAt || report.reportedAt > now) {
      throw new AgentFabricError("AF_INVALID_STATE", "Worker result report has an invalid timestamp");
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

  commitUnknownOutcome(attemptId: string): AuthoritativeOutcomeCommit {
    const state = this.state();
    if (!state.attempts[attemptId]) {
      throw new AgentFabricError("AF_NOT_FOUND", `Unknown attempt: ${attemptId}`);
    }
    const existing = state.outcomes[attemptId];
    if (existing) return existing;
    const outcome: AuthoritativeOutcomeCommit = {
      outcomeId: `outcome:${attemptId}`,
      attemptId,
      status: "unknown",
      resultDigest: null,
      reportId: null,
      reportDigest: null,
      evidenceDigests: [],
      reportedAt: null,
      committedAt: this.clock.now(),
    };
    this.append(`attempt-outcome:${attemptId}`, {
      type: "attempt_outcome_committed",
      outcome,
    });
    return outcome;
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
