export type Digest = `sha256:${string}`;
export type Identifier = string;
export type EpochMilliseconds = number;

export type EffectClass =
  | "read"
  | "internal_write"
  | "bounded_external_inference"
  | "consequential";

export interface GoalContract {
  goalId: Identifier;
  revision: number;
  authorityInvocationId: Identifier;
  objectives: readonly string[];
  nonObjectives: readonly string[];
  acceptanceCriteria: readonly string[];
  allowedEffectClasses: readonly EffectClass[];
  prohibitedEffectClasses: readonly EffectClass[];
  sourceBoundary: {
    sourceIds: readonly Identifier[];
    allowExpansion: boolean;
  };
}

export interface OwnerAuthorization {
  authorizationId: Identifier;
  principalId: Identifier;
  rootExecutionId: Identifier;
  goalIds: readonly Identifier[];
  subjectIds: readonly Identifier[];
  capabilities: readonly string[];
  sourceIds: readonly Identifier[];
  targetIds: readonly Identifier[];
  effectClasses: readonly EffectClass[];
  notBefore: EpochMilliseconds;
  expiresAt: EpochMilliseconds;
  maximumAttempts: number;
  maximumDelegationDepth: number;
  resourceCeilings: Readonly<Record<string, number>>;
}

export interface OwnerAuthorizationVerification {
  verifierId: Identifier;
  authorizationDigest: Digest;
  evidenceDigest: Digest;
}

export interface OwnerAuthorizationVerifier {
  verify(
    authorization: OwnerAuthorization,
    authorizationDigest: Digest,
  ): OwnerAuthorizationVerification;
  /** Deterministic/offline verification used when reconstructing authority from a journal. */
  verifyRecorded(
    authorization: OwnerAuthorization,
    verification: OwnerAuthorizationVerification,
  ): boolean;
}

export interface WorkflowNode {
  nodeId: Identifier;
  kind: "activity" | "verification" | "join";
  dependsOn: readonly Identifier[];
  agentSpecId?: Identifier;
  harnessSpecId?: Identifier;
  executionProfileId?: Identifier;
  outputContractId?: Identifier;
}

export interface WorkflowProgramVersion {
  programId: Identifier;
  version: number;
  nodes: readonly WorkflowNode[];
}

export interface RunPlanRevision {
  revisionId: Identifier;
  rootExecutionId: Identifier;
  goalId: Identifier;
  programVersionId: Identifier;
  revisionNumber: number;
  parentRevisionId: Identifier | null;
  sourcePlanDeltaId: Identifier | null;
  nodes: readonly WorkflowNode[];
  contentDigest: Digest;
}

export type PlanDeltaOperation =
  | { kind: "add_node"; node: WorkflowNode }
  | { kind: "replace_node"; node: WorkflowNode }
  | { kind: "remove_node"; nodeId: Identifier };

export interface PlanDelta {
  deltaId: Identifier;
  rootExecutionId: Identifier;
  baseRevisionId: Identifier;
  nextRevisionId: Identifier;
  operations: readonly PlanDeltaOperation[];
}

export interface AgentSpec {
  agentSpecId: Identifier;
  role: string;
  objective: string;
  instructions: readonly string[];
  outputContractId: Identifier;
  stopConditions: readonly string[];
}

export interface HarnessSpec {
  harnessSpecId: Identifier;
  systemPromptLayers: readonly Digest[];
  toolIds: readonly Identifier[];
  pluginIds: readonly Identifier[];
  memoryMode: "none" | "run_scoped" | "project_scoped";
  delegationPolicy: "none" | "attenuated_children";
}

export interface ExecutionProfile {
  executionProfileId: Identifier;
  isolation: "process" | "container" | "microvm" | "remote";
  network: "denied" | "provider_only" | "restricted";
  filesystem: "read_only" | "isolated_write";
  durability: "ephemeral" | "durable";
  maximumWallClockMs: number;
}

export interface EffectiveRunSpec {
  effectiveRunSpecId: Identifier;
  rootExecutionId: Identifier;
  goalId: Identifier;
  planRevisionId: Identifier;
  nodeId: Identifier;
  agentSpecId: Identifier;
  harnessSpecId: Identifier;
  executionProfileId: Identifier;
  contextPackDigest: Digest;
  materializationDigest: Digest;
}

export type ResourceSemantics = "consumable" | "capacity" | "counter";

export interface ResourceDefinition {
  resource: string;
  semantics: ResourceSemantics;
  limit: number;
}

export interface ResourceReservationRequest {
  resource: string;
  amount: number;
}

export interface ResourceReservation {
  reservationId: Identifier;
  ownerId: Identifier;
  requests: readonly ResourceReservationRequest[];
  status: "active" | "consumed" | "released";
}

export interface ResourceLedgerSnapshot {
  definitions: Readonly<Record<string, ResourceDefinition>>;
  reserved: Readonly<Record<string, number>>;
  consumed: Readonly<Record<string, number>>;
  ownerReserved: Readonly<Record<Identifier, Readonly<Record<string, number>>>>;
  ownerConsumed: Readonly<Record<Identifier, Readonly<Record<string, number>>>>;
  reservations: Readonly<Record<Identifier, ResourceReservation>>;
}

export interface ExecutionGrant {
  grantId: Identifier;
  rootAuthorizationId: Identifier;
  subjectId: Identifier;
  parentGrantId: Identifier | null;
  capabilities: readonly string[];
  sourceIds: readonly Identifier[];
  targetIds: readonly Identifier[];
  effectClasses: readonly EffectClass[];
  notBefore: EpochMilliseconds;
  expiresAt: EpochMilliseconds;
  maximumAttempts: number;
  delegationDepthRemaining: number;
  resourceCeilings: Readonly<Record<string, number>>;
  reservationId?: Identifier;
}

export interface DerivedGrantRequest {
  grantId: Identifier;
  subjectId: Identifier;
  capabilities: readonly string[];
  sourceIds: readonly Identifier[];
  targetIds: readonly Identifier[];
  effectClasses: readonly EffectClass[];
  notBefore: EpochMilliseconds;
  expiresAt: EpochMilliseconds;
  maximumAttempts: number;
  delegationDepthRemaining: number;
  reservationId: Identifier;
  resourceRequests: readonly ResourceReservationRequest[];
}

export interface AuthorityResolution {
  outcome: "allowed" | "rejected" | "unknown";
  grant?: ExecutionGrant;
  reasonCodes: readonly string[];
  limitations: readonly string[];
}

export interface DispatchIntent {
  intentId: Identifier;
  rootExecutionId: Identifier;
  planRevisionId: Identifier;
  taskNodeId: Identifier;
  effectiveRunSpecDigest: Digest;
  sourceIds: readonly Identifier[];
  targetId: Identifier;
  requiredCapability: string;
  effectClass: EffectClass;
  createdAt: EpochMilliseconds;
}

export interface DispatchOffer {
  offerId: Identifier;
  intentId: Identifier;
  audiencePool: Identifier;
  expiresAt: EpochMilliseconds;
  nonAuthoritative: true;
}

export interface SchedulingClaim {
  claimId: Identifier;
  intentId: Identifier;
  workerId: Identifier;
  attemptId: Identifier;
  leaseExpiresAt: EpochMilliseconds;
  fencingToken: number;
  committedAt: EpochMilliseconds;
}

export interface AttemptExecutionPermit {
  permitId: Identifier;
  intentId: Identifier;
  claimId: Identifier;
  attemptId: Identifier;
  workerId: Identifier;
  planRevisionId: Identifier;
  effectiveRunSpecDigest: Digest;
  grantId: Identifier;
  fencingToken: number;
  notBefore: EpochMilliseconds;
  expiresAt: EpochMilliseconds;
}

export interface WorkerResultReport {
  reportId: Identifier;
  attemptId: Identifier;
  permitId: Identifier;
  intentId: Identifier;
  planRevisionId: Identifier;
  effectiveRunSpecDigest: Digest;
  fencingToken: number;
  status: "succeeded" | "failed";
  resultDigest: Digest;
  evidenceDigests: readonly Digest[];
  reportedAt: EpochMilliseconds;
}

export interface AuthoritativeOutcomeCommit {
  outcomeId: Identifier;
  attemptId: Identifier;
  permitId: Identifier;
  intentId: Identifier;
  planRevisionId: Identifier;
  effectiveRunSpecDigest: Digest;
  fencingToken: number;
  status: "succeeded" | "failed";
  resultDigest: Digest;
  reportId: Identifier;
  reportDigest: Digest;
  evidenceDigests: readonly Digest[];
  reportedAt: EpochMilliseconds;
  committedAt: EpochMilliseconds;
}

export interface AttemptUncertaintyObservation {
  observationId: Identifier;
  attemptId: Identifier;
  permitId: Identifier;
  phase: "startup" | "outcome";
  reason: string;
  observedAt: EpochMilliseconds;
}

export interface AdapterManifest {
  adapterId: Identifier;
  version: string;
  capabilities: readonly string[];
  supportsCancellation: boolean;
  supportsObservation: boolean;
}

export interface ExecutorStartupReport {
  startupReportId: Identifier;
  attemptId: Identifier;
  observedSpecDigest: Digest;
  startedAt: EpochMilliseconds;
}

export interface RuntimeObservation {
  observationId: Identifier;
  attemptId: Identifier;
  sourceClass: "executor_self_report" | "adapter_observation" | "host_observation";
  claim: string;
  observedAt: EpochMilliseconds;
}

export type AdapterStartResult =
  | { status: "started"; report: ExecutorStartupReport }
  | { status: "unknown"; reason: string };

export type AdapterOutcomeResult =
  | { status: "reported"; report: WorkerResultReport }
  | { status: "unknown"; reason: string };

export interface AgentAdapter {
  manifest(): AdapterManifest;
  startAttempt(permit: AttemptExecutionPermit): Promise<AdapterStartResult>;
  observeAttempt(attemptId: Identifier): Promise<readonly RuntimeObservation[]>;
  collectOutcome(attemptId: Identifier): Promise<AdapterOutcomeResult>;
  requestCancellation(attemptId: Identifier): Promise<{ acknowledged: boolean }>;
  observeTermination(attemptId: Identifier): Promise<"terminated" | "running" | "unknown">;
}

export interface AttemptControlState {
  permitId: Identifier;
  startupStatus: "started";
  startedAt: EpochMilliseconds;
  startupReportId: Identifier;
}

export type ControlEvent =
  | {
      type: "owner_authorization_registered";
      authorization: OwnerAuthorization;
      verification: OwnerAuthorizationVerification;
    }
  | { type: "owner_authorization_revoked"; authorizationId: Identifier; reason: string }
  | { type: "resource_ledger_initialized"; definitions: readonly ResourceDefinition[] }
  | { type: "resource_reservation_consumed"; reservationId: Identifier }
  | { type: "resource_reservation_released"; reservationId: Identifier }
  | { type: "goal_registered"; goal: GoalContract }
  | { type: "grant_registered"; grant: ExecutionGrant; reservation: ResourceReservation | null }
  | { type: "grant_revoked"; grantId: Identifier; reason: string }
  | { type: "plan_delta_registered"; delta: PlanDelta }
  | { type: "plan_revision_activated"; revision: RunPlanRevision }
  | { type: "dispatch_intent_committed"; intent: DispatchIntent }
  | { type: "scheduling_claim_committed"; claim: SchedulingClaim }
  | { type: "attempt_execution_permit_issued"; permit: AttemptExecutionPermit }
  | {
      type: "attempt_started";
      attemptId: Identifier;
      permitId: Identifier;
      startupReportId: Identifier;
      startedAt: EpochMilliseconds;
    }
  | { type: "attempt_uncertainty_observed"; observation: AttemptUncertaintyObservation }
  | { type: "attempt_outcome_committed"; outcome: AuthoritativeOutcomeCommit };

export interface UncommittedControlEvent {
  eventId: Identifier;
  rootExecutionId: Identifier;
  occurredAt: EpochMilliseconds;
  idempotencyKey?: Identifier;
  payload: ControlEvent;
}

export interface ControlEventEnvelope extends UncommittedControlEvent {
  sequence: number;
  predecessorEventId: Identifier | null;
  predecessorEventDigest: Digest | null;
  eventDigest: Digest;
}

export interface ControlState {
  lastSequence: number;
  lastEventId: Identifier | null;
  lastEventDigest: Digest | null;
  lastOccurredAt: EpochMilliseconds | null;
  authorizations: Readonly<Record<Identifier, OwnerAuthorization>>;
  authorizationVerifications: Readonly<Record<Identifier, OwnerAuthorizationVerification>>;
  revokedAuthorizations: Readonly<Record<Identifier, string>>;
  resourceDefinitions: Readonly<Record<string, ResourceDefinition>>;
  resourceReserved: Readonly<Record<string, number>>;
  resourceConsumed: Readonly<Record<string, number>>;
  resourceOwnerReserved: Readonly<Record<Identifier, Readonly<Record<string, number>>>>;
  resourceOwnerConsumed: Readonly<Record<Identifier, Readonly<Record<string, number>>>>;
  resourceReservations: Readonly<Record<Identifier, ResourceReservation>>;
  goals: Readonly<Record<Identifier, GoalContract>>;
  grants: Readonly<Record<Identifier, ExecutionGrant>>;
  revokedGrants: Readonly<Record<Identifier, string>>;
  planDeltas: Readonly<Record<Identifier, PlanDelta>>;
  planRevisions: Readonly<Record<Identifier, RunPlanRevision>>;
  activePlanRevisionByExecution: Readonly<Record<Identifier, Identifier>>;
  dispatchIntents: Readonly<Record<Identifier, DispatchIntent>>;
  claims: Readonly<Record<Identifier, SchedulingClaim>>;
  activeClaimByIntent: Readonly<Record<Identifier, Identifier>>;
  claimByAttemptId: Readonly<Record<Identifier, Identifier>>;
  permits: Readonly<Record<Identifier, AttemptExecutionPermit>>;
  attempts: Readonly<Record<Identifier, AttemptControlState>>;
  uncertaintyObservations: Readonly<Record<Identifier, AttemptUncertaintyObservation>>;
  outcomes: Readonly<Record<Identifier, AuthoritativeOutcomeCommit>>;
}

export interface ReplayTrustContext {
  ownerAuthorizationVerifier: OwnerAuthorizationVerifier;
  resourceDefinitions?: readonly ResourceDefinition[];
}

export interface Clock {
  now(): EpochMilliseconds;
}

export type DigestFunction = (canonicalValue: string) => Digest;
