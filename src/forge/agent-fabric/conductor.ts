import { assertGrantCurrent } from "./authority.ts";
import { stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import type { ControlJournal } from "./journal.ts";
import { computeRunPlanContentDigest, validateWorkflowNodes } from "./planning.ts";
import { replayControlState } from "./reducer.ts";
import type {
  AttemptExecutionPermit,
  AuthoritativeOutcomeCommit,
  Clock,
  DigestFunction,
  DispatchIntent,
  DispatchOffer,
  ExecutionGrant,
  ExecutorStartupReport,
  GoalContract,
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
  ) {}

  state() {
    return replayControlState(this.journal.readAll());
  }

  events() {
    return this.journal.readAll();
  }

  registerGoal(goal: GoalContract): void {
    this.append(`goal:${goal.goalId}`, {
      type: "goal_registered",
      goal,
    });
  }

  registerGrant(grant: ExecutionGrant): void {
    this.append(`grant:${grant.grantId}`, {
      type: "grant_registered",
      grant,
    });
  }

  revokeGrant(grantId: string, reason: string): void {
    this.append(`grant-revocation:${grantId}`, {
      type: "grant_revoked",
      grantId,
      reason,
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
    if (
      expectedCurrentRevisionId !== null &&
      revision.parentRevisionId !== expectedCurrentRevisionId
    ) {
      throw new AgentFabricError(
        "AF_INVALID_PLAN",
        "Plan revision parent does not match the active revision",
      );
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
    const revision = state.planRevisions[intent.planRevisionId];
    if (!revision?.nodes.some((node) => node.nodeId === intent.taskNodeId)) {
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
    assertGrantCurrent(grant, now, state.revokedGrants[grant.grantId]);
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

  acceptStartupReport(
    permit: AttemptExecutionPermit,
    report: ExecutorStartupReport,
  ): void {
    this.assertPermitCurrent(permit);
    if (report.attemptId !== permit.attemptId) {
      throw new AgentFabricError("AF_PERMIT_REJECTED", "Startup report is bound to another attempt");
    }
    if (report.observedSpecDigest !== permit.effectiveRunSpecDigest) {
      throw new AgentFabricError("AF_PERMIT_REJECTED", "Adapter started a different EffectiveRunSpec");
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
    const grant = state.grants[permit.grantId];
    if (!grant) throw new AgentFabricError("AF_NOT_FOUND", `Unknown grant: ${permit.grantId}`);
    assertGrantCurrent(grant, now, state.revokedGrants[grant.grantId]);
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
    const existing = state.outcomes[report.attemptId];
    if (existing) {
      if (existing.status === report.status && existing.resultDigest === report.resultDigest) {
        return existing;
      }
      throw new AgentFabricError(
        "AF_CONFLICT",
        `Attempt ${report.attemptId} already has a different authoritative outcome`,
      );
    }
    if (attempt.startupStatus !== "started") {
      throw new AgentFabricError("AF_INVALID_STATE", "Unknown startup cannot commit a successful outcome");
    }
    const permit = state.permits[attempt.permitId]!;
    const claim = state.claims[permit.claimId]!;
    const now = this.clock.now();
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
    const grant = state.grants[permit.grantId]!;
    assertGrantCurrent(grant, now, state.revokedGrants[grant.grantId]);

    const outcome: AuthoritativeOutcomeCommit = {
      outcomeId: `outcome:${report.attemptId}`,
      attemptId: report.attemptId,
      status: report.status,
      resultDigest: report.resultDigest,
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
      committedAt: this.clock.now(),
    };
    this.append(`attempt-outcome:${attemptId}`, {
      type: "attempt_outcome_committed",
      outcome,
    });
    return outcome;
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
