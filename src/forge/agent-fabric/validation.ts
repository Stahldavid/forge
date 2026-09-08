import { AgentFabricError } from "./errors.ts";
import type {
  ControlEventEnvelope,
  UncommittedControlEvent,
  WorkerResultReport,
} from "./types.ts";

const EFFECT_CLASSES = new Set([
  "read",
  "internal_write",
  "bounded_external_inference",
  "consequential",
]);
const RESOURCE_SEMANTICS = new Set(["consumable", "capacity", "counter"]);
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function fail(message: string): never {
  throw new AgentFabricError("AF_INVALID_EVENT", message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function keys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) fail(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label}.${key} is not allowed`);
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function textStrings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((item, index) => {
    if (typeof item !== "string") fail(`${label}[${index}] must be a string`);
    return item;
  });
}

function digest(value: unknown, label: string): string {
  const result = string(value, label);
  if (!DIGEST.test(result)) fail(`${label} must be a sha256 digest`);
  return result;
}

function number(value: unknown, label: string, options: { integer?: boolean; min?: number } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  if (options.integer && !Number.isInteger(value)) fail(`${label} must be an integer`);
  if (options.min !== undefined && value < options.min) fail(`${label} must be >= ${options.min}`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be boolean`);
  return value;
}

function strings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((item, index) => string(item, `${label}[${index}]`));
}

function digests(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((item, index) => digest(item, `${label}[${index}]`));
}

function recordOfPositiveNumbers(value: unknown, label: string): void {
  const record = object(value, label);
  for (const [key, amount] of Object.entries(record)) {
    const parsed = number(amount, `${label}.${key}`);
    if (parsed <= 0) fail(`${label}.${key} must be > 0`);
  }
}

function effectClasses(value: unknown, label: string): void {
  for (const item of strings(value, label)) if (!EFFECT_CLASSES.has(item)) fail(`${label} contains ${item}`);
}

function workflowNode(value: unknown, label: string): void {
  const node = object(value, label);
  keys(
    node,
    ["nodeId", "kind", "dependsOn"],
    ["agentSpecId", "harnessSpecId", "executionProfileId", "outputContractId"],
    label,
  );
  string(node.nodeId, `${label}.nodeId`);
  const kind = string(node.kind, `${label}.kind`);
  if (!new Set(["activity", "verification", "join"]).has(kind)) fail(`${label}.kind is invalid`);
  strings(node.dependsOn, `${label}.dependsOn`);
  for (const optional of ["agentSpecId", "harnessSpecId", "executionProfileId", "outputContractId"] as const) {
    if (node[optional] !== undefined) string(node[optional], `${label}.${optional}`);
  }
}

function workflowNodes(value: unknown, label: string): void {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  value.forEach((item, index) => workflowNode(item, `${label}[${index}]`));
}

function ownerAuthorization(value: unknown, label: string): void {
  const authorization = object(value, label);
  keys(
    authorization,
    [
      "authorizationId", "principalId", "rootExecutionId", "goalIds", "subjectIds",
      "capabilities", "sourceIds", "targetIds", "effectClasses", "notBefore", "expiresAt",
      "maximumAttempts", "maximumDelegationDepth", "resourceCeilings",
    ],
    [],
    label,
  );
  for (const field of ["authorizationId", "principalId", "rootExecutionId"] as const) {
    string(authorization[field], `${label}.${field}`);
  }
  for (const field of ["goalIds", "subjectIds", "capabilities", "sourceIds", "targetIds"] as const) {
    strings(authorization[field], `${label}.${field}`);
  }
  effectClasses(authorization.effectClasses, `${label}.effectClasses`);
  number(authorization.notBefore, `${label}.notBefore`, { min: 0 });
  number(authorization.expiresAt, `${label}.expiresAt`, { min: 0 });
  number(authorization.maximumAttempts, `${label}.maximumAttempts`, { integer: true, min: 1 });
  number(authorization.maximumDelegationDepth, `${label}.maximumDelegationDepth`, { integer: true, min: 0 });
  recordOfPositiveNumbers(authorization.resourceCeilings, `${label}.resourceCeilings`);
}

function ownerAuthorizationVerification(value: unknown, label: string): void {
  const verification = object(value, label);
  keys(verification, ["verifierId", "authorizationDigest", "evidenceDigest"], [], label);
  string(verification.verifierId, `${label}.verifierId`);
  digest(verification.authorizationDigest, `${label}.authorizationDigest`);
  digest(verification.evidenceDigest, `${label}.evidenceDigest`);
}

function resourceDefinition(value: unknown, label: string): void {
  const definition = object(value, label);
  keys(definition, ["resource", "semantics", "limit"], [], label);
  string(definition.resource, `${label}.resource`);
  const semantics = string(definition.semantics, `${label}.semantics`);
  if (!RESOURCE_SEMANTICS.has(semantics)) fail(`${label}.semantics is invalid`);
  number(definition.limit, `${label}.limit`, { min: 0 });
}

function resourceDefinitions(value: unknown, label: string): void {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  value.forEach((item, index) => resourceDefinition(item, `${label}[${index}]`));
}

function goal(value: unknown, label: string): void {
  const goalValue = object(value, label);
  keys(
    goalValue,
    [
      "goalId", "revision", "authorityInvocationId", "objectives", "nonObjectives",
      "acceptanceCriteria", "allowedEffectClasses", "prohibitedEffectClasses", "sourceBoundary",
    ],
    [],
    label,
  );
  string(goalValue.goalId, `${label}.goalId`);
  number(goalValue.revision, `${label}.revision`, { integer: true, min: 1 });
  string(goalValue.authorityInvocationId, `${label}.authorityInvocationId`);
  textStrings(goalValue.objectives, `${label}.objectives`);
  textStrings(goalValue.nonObjectives, `${label}.nonObjectives`);
  textStrings(goalValue.acceptanceCriteria, `${label}.acceptanceCriteria`);
  effectClasses(goalValue.allowedEffectClasses, `${label}.allowedEffectClasses`);
  effectClasses(goalValue.prohibitedEffectClasses, `${label}.prohibitedEffectClasses`);
  const boundary = object(goalValue.sourceBoundary, `${label}.sourceBoundary`);
  keys(boundary, ["sourceIds", "allowExpansion"], [], `${label}.sourceBoundary`);
  strings(boundary.sourceIds, `${label}.sourceBoundary.sourceIds`);
  boolean(boundary.allowExpansion, `${label}.sourceBoundary.allowExpansion`);
}

function grant(value: unknown, label: string): void {
  const grantValue = object(value, label);
  keys(
    grantValue,
    [
      "grantId", "rootAuthorizationId", "subjectId", "parentGrantId", "capabilities", "sourceIds",
      "targetIds", "effectClasses", "notBefore", "expiresAt", "maximumAttempts",
      "delegationDepthRemaining", "resourceCeilings",
    ],
    ["reservationId"],
    label,
  );
  for (const field of ["grantId", "rootAuthorizationId", "subjectId"] as const) {
    string(grantValue[field], `${label}.${field}`);
  }
  if (grantValue.parentGrantId !== null) string(grantValue.parentGrantId, `${label}.parentGrantId`);
  for (const field of ["capabilities", "sourceIds", "targetIds"] as const) {
    strings(grantValue[field], `${label}.${field}`);
  }
  effectClasses(grantValue.effectClasses, `${label}.effectClasses`);
  number(grantValue.notBefore, `${label}.notBefore`, { min: 0 });
  number(grantValue.expiresAt, `${label}.expiresAt`, { min: 0 });
  number(grantValue.maximumAttempts, `${label}.maximumAttempts`, { integer: true, min: 1 });
  number(grantValue.delegationDepthRemaining, `${label}.delegationDepthRemaining`, { integer: true, min: 0 });
  recordOfPositiveNumbers(grantValue.resourceCeilings, `${label}.resourceCeilings`);
  if (grantValue.reservationId !== undefined) string(grantValue.reservationId, `${label}.reservationId`);
}

function reservation(value: unknown, label: string): void {
  const reservationValue = object(value, label);
  keys(reservationValue, ["reservationId", "ownerId", "requests", "status"], [], label);
  string(reservationValue.reservationId, `${label}.reservationId`);
  string(reservationValue.ownerId, `${label}.ownerId`);
  if (!Array.isArray(reservationValue.requests)) fail(`${label}.requests must be an array`);
  reservationValue.requests.forEach((item, index) => {
    const request = object(item, `${label}.requests[${index}]`);
    keys(request, ["resource", "amount"], [], `${label}.requests[${index}]`);
    string(request.resource, `${label}.requests[${index}].resource`);
    const amount = number(request.amount, `${label}.requests[${index}].amount`);
    if (amount <= 0) fail(`${label}.requests[${index}].amount must be > 0`);
  });
  const status = string(reservationValue.status, `${label}.status`);
  if (!new Set(["active", "consumed", "released"]).has(status)) fail(`${label}.status is invalid`);
}

function planDelta(value: unknown, label: string): void {
  const delta = object(value, label);
  keys(delta, ["deltaId", "rootExecutionId", "baseRevisionId", "nextRevisionId", "operations"], [], label);
  for (const field of ["deltaId", "rootExecutionId", "baseRevisionId", "nextRevisionId"] as const) {
    string(delta[field], `${label}.${field}`);
  }
  if (!Array.isArray(delta.operations)) fail(`${label}.operations must be an array`);
  delta.operations.forEach((item, index) => {
    const operation = object(item, `${label}.operations[${index}]`);
    const kind = string(operation.kind, `${label}.operations[${index}].kind`);
    if (kind === "remove_node") {
      keys(operation, ["kind", "nodeId"], [], `${label}.operations[${index}]`);
      string(operation.nodeId, `${label}.operations[${index}].nodeId`);
      return;
    }
    if (kind === "add_node" || kind === "replace_node") {
      keys(operation, ["kind", "node"], [], `${label}.operations[${index}]`);
      workflowNode(operation.node, `${label}.operations[${index}].node`);
      return;
    }
    fail(`${label}.operations[${index}].kind is invalid`);
  });
}

function revision(value: unknown, label: string): void {
  const revisionValue = object(value, label);
  keys(
    revisionValue,
    [
      "revisionId", "rootExecutionId", "goalId", "programVersionId", "revisionNumber",
      "parentRevisionId", "sourcePlanDeltaId", "nodes", "contentDigest",
    ],
    [],
    label,
  );
  for (const field of ["revisionId", "rootExecutionId", "goalId", "programVersionId"] as const) {
    string(revisionValue[field], `${label}.${field}`);
  }
  number(revisionValue.revisionNumber, `${label}.revisionNumber`, { integer: true, min: 1 });
  if (revisionValue.parentRevisionId !== null) string(revisionValue.parentRevisionId, `${label}.parentRevisionId`);
  if (revisionValue.sourcePlanDeltaId !== null) string(revisionValue.sourcePlanDeltaId, `${label}.sourcePlanDeltaId`);
  workflowNodes(revisionValue.nodes, `${label}.nodes`);
  digest(revisionValue.contentDigest, `${label}.contentDigest`);
}

function dispatchIntent(value: unknown, label: string): void {
  const intent = object(value, label);
  keys(
    intent,
    [
      "intentId", "rootExecutionId", "planRevisionId", "taskNodeId", "effectiveRunSpecDigest",
      "sourceIds", "targetId", "requiredCapability", "effectClass", "createdAt",
    ],
    [],
    label,
  );
  for (const field of ["intentId", "rootExecutionId", "planRevisionId", "taskNodeId", "targetId", "requiredCapability"] as const) {
    string(intent[field], `${label}.${field}`);
  }
  digest(intent.effectiveRunSpecDigest, `${label}.effectiveRunSpecDigest`);
  strings(intent.sourceIds, `${label}.sourceIds`);
  effectClasses([intent.effectClass], `${label}.effectClass`);
  number(intent.createdAt, `${label}.createdAt`, { min: 0 });
}

function claim(value: unknown, label: string): void {
  const claimValue = object(value, label);
  keys(
    claimValue,
    ["claimId", "intentId", "workerId", "attemptId", "leaseExpiresAt", "fencingToken", "committedAt"],
    [],
    label,
  );
  for (const field of ["claimId", "intentId", "workerId", "attemptId"] as const) string(claimValue[field], `${label}.${field}`);
  number(claimValue.leaseExpiresAt, `${label}.leaseExpiresAt`, { min: 0 });
  number(claimValue.fencingToken, `${label}.fencingToken`, { integer: true, min: 1 });
  number(claimValue.committedAt, `${label}.committedAt`, { min: 0 });
}

function permit(value: unknown, label: string): void {
  const permitValue = object(value, label);
  keys(
    permitValue,
    [
      "permitId", "intentId", "claimId", "attemptId", "workerId", "planRevisionId",
      "effectiveRunSpecDigest", "grantId", "fencingToken", "notBefore", "expiresAt",
    ],
    [],
    label,
  );
  for (const field of ["permitId", "intentId", "claimId", "attemptId", "workerId", "planRevisionId", "grantId"] as const) {
    string(permitValue[field], `${label}.${field}`);
  }
  digest(permitValue.effectiveRunSpecDigest, `${label}.effectiveRunSpecDigest`);
  number(permitValue.fencingToken, `${label}.fencingToken`, { integer: true, min: 1 });
  number(permitValue.notBefore, `${label}.notBefore`, { min: 0 });
  number(permitValue.expiresAt, `${label}.expiresAt`, { min: 0 });
}

export function validateWorkerResultReport(value: unknown): asserts value is WorkerResultReport {
  const report = object(value, "report");
  keys(
    report,
    [
      "reportId", "attemptId", "permitId", "intentId", "planRevisionId",
      "effectiveRunSpecDigest", "fencingToken", "status", "resultDigest", "evidenceDigests",
      "reportedAt",
    ],
    [],
    "report",
  );
  for (const field of ["reportId", "attemptId", "permitId", "intentId", "planRevisionId"] as const) {
    string(report[field], `report.${field}`);
  }
  digest(report.effectiveRunSpecDigest, "report.effectiveRunSpecDigest");
  number(report.fencingToken, "report.fencingToken", { integer: true, min: 1 });
  const status = string(report.status, "report.status");
  if (!new Set(["succeeded", "failed"]).has(status)) fail("report.status is invalid");
  digest(report.resultDigest, "report.resultDigest");
  digests(report.evidenceDigests, "report.evidenceDigests");
  number(report.reportedAt, "report.reportedAt", { min: 0 });
}

function uncertainty(value: unknown, label: string): void {
  const observation = object(value, label);
  keys(observation, ["observationId", "attemptId", "permitId", "phase", "reason", "observedAt"], [], label);
  string(observation.observationId, `${label}.observationId`);
  string(observation.attemptId, `${label}.attemptId`);
  string(observation.permitId, `${label}.permitId`);
  const phase = string(observation.phase, `${label}.phase`);
  if (!new Set(["startup", "outcome"]).has(phase)) fail(`${label}.phase is invalid`);
  string(observation.reason, `${label}.reason`);
  number(observation.observedAt, `${label}.observedAt`, { min: 0 });
}

function outcome(value: unknown, label: string): void {
  const outcomeValue = object(value, label);
  keys(
    outcomeValue,
    [
      "outcomeId", "attemptId", "permitId", "intentId", "planRevisionId",
      "effectiveRunSpecDigest", "fencingToken", "status", "resultDigest", "reportId",
      "reportDigest", "evidenceDigests", "reportedAt", "committedAt",
    ],
    [],
    label,
  );
  for (const field of ["outcomeId", "attemptId", "permitId", "intentId", "planRevisionId", "reportId"] as const) {
    string(outcomeValue[field], `${label}.${field}`);
  }
  digest(outcomeValue.effectiveRunSpecDigest, `${label}.effectiveRunSpecDigest`);
  number(outcomeValue.fencingToken, `${label}.fencingToken`, { integer: true, min: 1 });
  const status = string(outcomeValue.status, `${label}.status`);
  if (!new Set(["succeeded", "failed"]).has(status)) fail(`${label}.status is invalid`);
  digest(outcomeValue.resultDigest, `${label}.resultDigest`);
  digest(outcomeValue.reportDigest, `${label}.reportDigest`);
  digests(outcomeValue.evidenceDigests, `${label}.evidenceDigests`);
  number(outcomeValue.reportedAt, `${label}.reportedAt`, { min: 0 });
  number(outcomeValue.committedAt, `${label}.committedAt`, { min: 0 });
}

function payload(value: unknown, label: string): void {
  const payloadValue = object(value, label);
  const type = string(payloadValue.type, `${label}.type`);
  switch (type) {
    case "owner_authorization_registered":
      keys(payloadValue, ["type", "authorization", "verification"], [], label);
      ownerAuthorization(payloadValue.authorization, `${label}.authorization`);
      ownerAuthorizationVerification(payloadValue.verification, `${label}.verification`);
      return;
    case "owner_authorization_revoked":
      keys(payloadValue, ["type", "authorizationId", "reason"], [], label);
      string(payloadValue.authorizationId, `${label}.authorizationId`);
      string(payloadValue.reason, `${label}.reason`);
      return;
    case "resource_ledger_initialized":
      keys(payloadValue, ["type", "definitions"], [], label);
      resourceDefinitions(payloadValue.definitions, `${label}.definitions`);
      return;
    case "resource_reservation_consumed":
    case "resource_reservation_released":
      keys(payloadValue, ["type", "reservationId"], [], label);
      string(payloadValue.reservationId, `${label}.reservationId`);
      return;
    case "goal_registered":
      keys(payloadValue, ["type", "goal"], [], label);
      goal(payloadValue.goal, `${label}.goal`);
      return;
    case "grant_registered":
      keys(payloadValue, ["type", "grant", "reservation"], [], label);
      grant(payloadValue.grant, `${label}.grant`);
      if (payloadValue.reservation !== null) reservation(payloadValue.reservation, `${label}.reservation`);
      return;
    case "grant_revoked":
      keys(payloadValue, ["type", "grantId", "reason"], [], label);
      string(payloadValue.grantId, `${label}.grantId`);
      string(payloadValue.reason, `${label}.reason`);
      return;
    case "plan_delta_registered":
      keys(payloadValue, ["type", "delta"], [], label);
      planDelta(payloadValue.delta, `${label}.delta`);
      return;
    case "plan_revision_activated":
      keys(payloadValue, ["type", "revision"], [], label);
      revision(payloadValue.revision, `${label}.revision`);
      return;
    case "dispatch_intent_committed":
      keys(payloadValue, ["type", "intent"], [], label);
      dispatchIntent(payloadValue.intent, `${label}.intent`);
      return;
    case "scheduling_claim_committed":
      keys(payloadValue, ["type", "claim"], [], label);
      claim(payloadValue.claim, `${label}.claim`);
      return;
    case "attempt_execution_permit_issued":
      keys(payloadValue, ["type", "permit"], [], label);
      permit(payloadValue.permit, `${label}.permit`);
      return;
    case "attempt_started":
      keys(payloadValue, ["type", "attemptId", "permitId", "startupReportId", "startedAt"], [], label);
      string(payloadValue.attemptId, `${label}.attemptId`);
      string(payloadValue.permitId, `${label}.permitId`);
      string(payloadValue.startupReportId, `${label}.startupReportId`);
      number(payloadValue.startedAt, `${label}.startedAt`, { min: 0 });
      return;
    case "attempt_uncertainty_observed":
      keys(payloadValue, ["type", "observation"], [], label);
      uncertainty(payloadValue.observation, `${label}.observation`);
      return;
    case "attempt_outcome_committed":
      keys(payloadValue, ["type", "outcome"], [], label);
      outcome(payloadValue.outcome, `${label}.outcome`);
      return;
    default:
      fail(`${label}.type is unknown: ${type}`);
  }
}

export function validateUncommittedControlEvent(value: unknown): asserts value is UncommittedControlEvent {
  const event = object(value, "event");
  keys(event, ["eventId", "rootExecutionId", "occurredAt", "payload"], ["idempotencyKey"], "event");
  string(event.eventId, "event.eventId");
  string(event.rootExecutionId, "event.rootExecutionId");
  number(event.occurredAt, "event.occurredAt", { min: 0 });
  if (event.idempotencyKey !== undefined) string(event.idempotencyKey, "event.idempotencyKey");
  payload(event.payload, "event.payload");
}

export function validateControlEventEnvelope(value: unknown): asserts value is ControlEventEnvelope {
  const event = object(value, "event");
  keys(
    event,
    [
      "eventId", "rootExecutionId", "occurredAt", "payload", "sequence", "predecessorEventId",
      "predecessorEventDigest", "eventDigest",
    ],
    ["idempotencyKey"],
    "event",
  );
  validateUncommittedControlEvent({
    eventId: event.eventId,
    rootExecutionId: event.rootExecutionId,
    occurredAt: event.occurredAt,
    ...(event.idempotencyKey === undefined ? {} : { idempotencyKey: event.idempotencyKey }),
    payload: event.payload,
  });
  number(event.sequence, "event.sequence", { integer: true, min: 1 });
  if (event.predecessorEventId !== null) string(event.predecessorEventId, "event.predecessorEventId");
  if (event.predecessorEventDigest !== null) digest(event.predecessorEventDigest, "event.predecessorEventDigest");
  digest(event.eventDigest, "event.eventDigest");
}
