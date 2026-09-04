import { ForgeAgentConductor as LegacyForgeAgentConductor } from "./conductor.ts";
import { stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import {
  computeControlEventDigest,
  type AppendControlEventInput,
  type ControlJournal,
} from "./journal.ts";
import { replayControlState } from "./hardened-reducer.ts";
import type { ResourceLedger } from "./resource-ledger.ts";
import type {
  AttemptExecutionPermit,
  AttemptUncertaintyObservation,
  AuthoritativeOutcomeCommit,
  AuthorityResolution,
  Clock,
  ControlEventEnvelope,
  ControlState,
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
  ReplayTrustContext,
  ResourceDefinition,
  ResourceLedgerSnapshot,
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

function sortedDefinitions(
  definitions: Readonly<Record<string, ResourceDefinition>>,
): ResourceDefinition[] {
  return Object.values(definitions)
    .map((definition) => ({ ...definition }))
    .sort((left, right) => left.resource.localeCompare(right.resource));
}

class PinnedClock implements Clock {
  private pinned: number | null = null;

  constructor(private readonly source: Clock) {}

  now(): number {
    return this.pinned ?? this.source.now();
  }

  run<T>(operation: () => T): T {
    if (this.pinned !== null) return operation();
    this.pinned = this.source.now();
    try {
      return operation();
    } finally {
      this.pinned = null;
    }
  }
}

class ReplayValidatingJournal implements ControlJournal {
  constructor(
    private readonly inner: ControlJournal,
    private readonly rootExecutionId: string,
    private readonly trust: () => ReplayTrustContext,
  ) {}

  append(input: AppendControlEventInput): ControlEventEnvelope {
    const current = this.inner.readAll();

    if (input.event.rootExecutionId !== this.rootExecutionId) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Event ${input.event.eventId} belongs to another root execution`,
      );
    }

    const duplicate = current.find(
      (event) =>
        event.eventId === input.event.eventId ||
        (input.event.idempotencyKey !== undefined &&
          event.idempotencyKey === input.event.idempotencyKey),
    );
    if (duplicate || input.expectedSequence !== current.length) {
      return this.inner.append(input);
    }

    const predecessor = current.at(-1);
    const withoutDigest: Omit<ControlEventEnvelope, "eventDigest"> = {
      ...structuredClone(input.event),
      sequence: current.length + 1,
      predecessorEventId: predecessor?.eventId ?? null,
      predecessorEventDigest: predecessor?.eventDigest ?? null,
    };
    const candidate: ControlEventEnvelope = {
      ...withoutDigest,
      eventDigest: computeControlEventDigest(withoutDigest),
    };

    // The authoritative append is permitted only if the same replay semantics
    // accept the entire candidate prefix. This prevents live/replay divergence.
    replayControlState([...current, candidate], this.trust());
    return this.inner.append(input);
  }

  readAll(): readonly ControlEventEnvelope[] {
    return this.inner.readAll();
  }
}

function ledgerProjection(snapshot: ResourceLedgerSnapshot) {
  return {
    definitions: snapshot.definitions,
    reserved: snapshot.reserved,
    consumed: snapshot.consumed,
    ownerReserved: snapshot.ownerReserved,
    ownerConsumed: snapshot.ownerConsumed,
    reservations: snapshot.reservations,
  };
}

function stateLedgerProjection(state: ControlState) {
  return {
    definitions: state.resourceDefinitions,
    reserved: state.resourceReserved,
    consumed: state.resourceConsumed,
    ownerReserved: state.resourceOwnerReserved,
    ownerConsumed: state.resourceOwnerConsumed,
    reservations: state.resourceReservations,
  };
}

export class ForgeAgentConductor {
  private readonly pinnedClock: PinnedClock;
  private readonly validatingJournal: ControlJournal;
  private readonly inner: LegacyForgeAgentConductor;

  constructor(
    private readonly rootExecutionId: string,
    private readonly journal: ControlJournal,
    clock: Clock,
    digest: DigestFunction,
    private readonly ownerAuthorizationVerifier: OwnerAuthorizationVerifier,
    private readonly resourceLedger?: ResourceLedger,
  ) {
    this.pinnedClock = new PinnedClock(clock);
    this.validatingJournal = new ReplayValidatingJournal(
      journal,
      rootExecutionId,
      () => this.replayTrust(),
    );
    this.inner = new LegacyForgeAgentConductor(
      rootExecutionId,
      this.validatingJournal,
      this.pinnedClock,
      digest,
      ownerAuthorizationVerifier,
      resourceLedger,
    );

    const existing = journal.readAll();
    if (existing.some((event) => event.rootExecutionId !== rootExecutionId)) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        `Journal contains events outside root execution ${rootExecutionId}`,
      );
    }
    if (existing.length > 0) replayControlState(existing, this.replayTrust());
  }

  state(): ControlState {
    return replayControlState(this.journal.readAll(), this.replayTrust());
  }

  events(): readonly ControlEventEnvelope[] {
    return this.journal.readAll();
  }

  registerOwnerAuthorization(authorization: OwnerAuthorization): void {
    this.pinnedClock.run(() => this.inner.registerOwnerAuthorization(authorization));
  }

  revokeOwnerAuthorization(authorizationId: string, reason: string): void {
    this.pinnedClock.run(() => this.inner.revokeOwnerAuthorization(authorizationId, reason));
  }

  registerGoal(goal: GoalContract): void {
    this.pinnedClock.run(() => this.inner.registerGoal(goal));
  }

  registerGrant(grant: ExecutionGrant): void {
    this.pinnedClock.run(() => this.inner.registerGrant(grant));
  }

  deriveAndRegisterGrant(
    parentGrantId: string,
    request: DerivedGrantRequest,
    ledger?: ResourceLedger,
  ): AuthorityResolution {
    const canonicalLedger = this.requireCanonicalLedger(ledger);
    this.assertLedgerSynchronized(canonicalLedger);
    return this.pinnedClock.run(() =>
      this.inner.deriveAndRegisterGrant(parentGrantId, request, canonicalLedger)
    );
  }

  consumeResourceReservation(
    reservationId: string,
    ledger?: ResourceLedger,
  ): ResourceReservation {
    const canonicalLedger = this.requireCanonicalLedger(ledger);
    this.assertLedgerSynchronized(canonicalLedger);
    return this.pinnedClock.run(() =>
      this.inner.consumeResourceReservation(reservationId, canonicalLedger)
    );
  }

  releaseResourceReservation(
    reservationId: string,
    ledger?: ResourceLedger,
  ): ResourceReservation {
    const canonicalLedger = this.requireCanonicalLedger(ledger);
    this.assertLedgerSynchronized(canonicalLedger);
    return this.pinnedClock.run(() =>
      this.inner.releaseResourceReservation(reservationId, canonicalLedger)
    );
  }

  revokeGrant(grantId: string, reason: string): void {
    this.pinnedClock.run(() => this.inner.revokeGrant(grantId, reason));
  }

  registerPlanDelta(delta: PlanDelta): void {
    this.pinnedClock.run(() => this.inner.registerPlanDelta(delta));
  }

  activatePlan(revision: RunPlanRevision, expectedCurrentRevisionId: string | null): void {
    this.pinnedClock.run(() => this.inner.activatePlan(revision, expectedCurrentRevisionId));
  }

  commitDispatchIntent(intent: DispatchIntent): void {
    this.pinnedClock.run(() => this.inner.commitDispatchIntent(intent));
  }

  createDispatchOffer(
    intentId: string,
    audiencePool: string,
    offerId: string,
    expiresAt: number,
  ): DispatchOffer {
    return this.pinnedClock.run(() =>
      this.inner.createDispatchOffer(intentId, audiencePool, offerId, expiresAt)
    );
  }

  claimDispatch(input: ClaimDispatchInput): SchedulingClaim {
    return this.pinnedClock.run(() => this.inner.claimDispatch(input));
  }

  issuePermit(input: IssuePermitInput): AttemptExecutionPermit {
    return this.pinnedClock.run(() => {
      const state = this.state();
      const claim = state.claims[input.claimId];
      if (!claim) {
        throw new AgentFabricError("AF_NOT_FOUND", `Unknown claim: ${input.claimId}`);
      }
      this.assertGoalAuthorityBinding(state, claim.intentId, input.grantId);
      return this.inner.issuePermit(input);
    });
  }

  authorizeAttemptDispatch(permit: AttemptExecutionPermit): void {
    this.pinnedClock.run(() => {
      this.assertGoalAuthorityBinding(this.state(), permit.intentId, permit.grantId);
      this.inner.authorizeAttemptDispatch(permit);
    });
  }

  acceptStartupReport(permit: AttemptExecutionPermit, report: ExecutorStartupReport): void {
    this.pinnedClock.run(() => {
      this.assertGoalAuthorityBinding(this.state(), permit.intentId, permit.grantId);
      this.inner.acceptStartupReport(permit, report);
    });
  }

  recordAttemptUncertainty(
    permit: AttemptExecutionPermit,
    phase: "startup" | "outcome",
    reason: string,
  ): AttemptUncertaintyObservation {
    return this.pinnedClock.run(() => {
      const state = this.state();
      if (phase === "outcome" && !state.attempts[permit.attemptId]) {
        throw new AgentFabricError(
          "AF_INVALID_STATE",
          "Outcome uncertainty requires a confirmed startup",
        );
      }
      return this.inner.recordAttemptUncertainty(permit, phase, reason);
    });
  }

  commitOutcome(report: WorkerResultReport): AuthoritativeOutcomeCommit {
    return this.pinnedClock.run(() => {
      const state = this.state();
      this.assertGoalAuthorityBinding(state, report.intentId, state.permits[report.permitId]?.grantId);
      return this.inner.commitOutcome(report);
    });
  }

  private replayTrust(): ReplayTrustContext {
    return {
      ownerAuthorizationVerifier: this.ownerAuthorizationVerifier,
      resourceDefinitions: this.resourceLedger
        ? sortedDefinitions(this.resourceLedger.snapshot().definitions)
        : undefined,
    };
  }

  private assertGoalAuthorityBinding(
    state: ControlState,
    intentId: string,
    grantId: string | undefined,
  ): void {
    const intent = state.dispatchIntents[intentId];
    const grant = grantId ? state.grants[grantId] : undefined;
    const revision = intent ? state.planRevisions[intent.planRevisionId] : undefined;
    const goal = revision ? state.goals[revision.goalId] : undefined;
    const authorization = grant ? state.authorizations[grant.rootAuthorizationId] : undefined;

    if (!intent || !grant || !revision || !goal || !authorization) {
      throw new AgentFabricError(
        "AF_GRANT_REJECTED",
        "Execution authority has incomplete GoalContract lineage",
      );
    }
    if (
      intent.rootExecutionId !== this.rootExecutionId ||
      revision.rootExecutionId !== this.rootExecutionId ||
      authorization.rootExecutionId !== this.rootExecutionId ||
      goal.authorityInvocationId !== grant.rootAuthorizationId ||
      !authorization.goalIds.includes(goal.goalId)
    ) {
      throw new AgentFabricError(
        "AF_GRANT_REJECTED",
        `Grant ${grant.grantId} is not authorized for goal ${goal.goalId}`,
      );
    }
  }

  private requireCanonicalLedger(candidate?: ResourceLedger): ResourceLedger {
    if (!this.resourceLedger) {
      throw new AgentFabricError(
        "AF_INVALID_STATE",
        "Resource operations require the ResourceLedger supplied to the Conductor constructor",
      );
    }
    if (candidate && candidate !== this.resourceLedger) {
      throw new AgentFabricError(
        "AF_INVALID_STATE",
        "ResourceLedger substitution is prohibited after Conductor construction",
      );
    }
    return this.resourceLedger;
  }

  private assertLedgerSynchronized(ledger: ResourceLedger): void {
    const snapshot = ledger.snapshot();
    const state = this.state();

    if (Object.keys(state.resourceDefinitions).length === 0) {
      const hasUsage =
        Object.values(snapshot.reserved).some((value) => value !== 0) ||
        Object.values(snapshot.consumed).some((value) => value !== 0) ||
        Object.keys(snapshot.reservations).length > 0;
      if (hasUsage) {
        throw new AgentFabricError(
          "AF_INVALID_STATE",
          "ResourceLedger contains usage that is not represented in the journal",
        );
      }
      return;
    }

    if (stableStringify(ledgerProjection(snapshot)) !== stableStringify(stateLedgerProjection(state))) {
      throw new AgentFabricError(
        "AF_INVALID_STATE",
        "ResourceLedger state diverges from the authoritative replay projection",
      );
    }
  }
}
