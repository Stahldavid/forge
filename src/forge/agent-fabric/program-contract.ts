import { createHash } from "node:crypto";
import { stableStringify } from "./canonical.ts";
import { programGraph } from "./program-structure.ts";
import { validateVisualPopulation } from "./program-evidence.ts";
import { validateProgramTypes } from "./program-types.ts";
import type { ProgramWorkerObservation, ProgramUsageSummary } from "./program-observation.ts";

export type ProgramValue = null | boolean | number | string | ProgramValue[] | { [key: string]: ProgramValue };
export interface ProgramRef { id: string; version: string }
export interface ProgramExpr { $expr: string; args: unknown[] }
export interface ProgramOperation { kind: string; id: string; options: Record<string, unknown> }
export interface WorkflowProgramV2 {
  operatorVersion?: 2;
  mode?: "data" | "candidate";
  schemaVersion: 2; id: string; version: number; inputSchema: ProgramRef; outputSchema: ProgramRef;
  acceptance: ProgramRef; population?: ProgramRef; policy: ProgramRef; steps: ProgramOperation[]; result: unknown;
}
export type ProgramSchema = { type?: string | string[]; enum?: ProgramValue[]; const?: ProgramValue;
  properties?: Record<string, ProgramSchema>; required?: string[]; additionalProperties?: boolean;
  items?: ProgramSchema; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number;
  minimum?: number; maximum?: number; anyOf?: ProgramSchema[] };
export interface ProgramLexicalContext { item?: ProgramSchema; state?: ProgramSchema }
export interface ProgramExecutor {
  id: string; version: string; kind: "command" | "codex" | "claude"; effect: "read" | "isolated-write" | "idempotent-effect" | "non-idempotent-effect";
  argv?: string[]; prompt?: string; role?: "implementer" | "reviewer" | "investigator" | "decision";
  model?: string; timeoutMs: number; writeScope: string[]; allowedGeneratedPaths?: string[];
  network: "disabled" | "host"; isolation: "cooperative" | "sandbox"; schema: ProgramRef;
  allowedExitCodes?: number[]; environment?: Record<string, string>;
  tokenAccounting?: "none" | "provider";
  inputSchema?: ProgramRef;
  dependencies?: "none" | "auto";
  cache?: "none" | "workspace";
}
export interface ProgramPolicy {
  resources?: { maxTokens: number; reserveTokensPerAttempt: number; finalReserveTokens?: number; unknownUsage: "block" | "allow" };
  allowFencedReplan?: boolean;
  captureScope?: string[];
  id: string; version: string; maxItems: number; concurrency: number; maxAttempts: number;
  maxOperations: number; maxDepth: number; deadlineMs: number; maxOutputBytes: number;
  writeScope: string[]; executors: string[]; allowCooperativeCommands: boolean; allowNetwork: boolean;
}
export interface ProgramAcceptance {
  id: string; version: string; criteria: string[]; writeScope: string[];
  requiredChecks: string[]; requireReview: boolean; allowNoWork: boolean;
  requiredChecksByScope?: { item: string[]; final: string[] };
  assessmentBindings?: Record<string, "item" | "final">;
  obligations?: { id: string; scope: "item" | "final"; criteria: string[]; requiredEvidence?: string[] }[];
  allowPartial?: boolean;
  requireHumanApproval?: boolean;
}
export interface ProgramVisualCase { itemKey: string; route: string; viewport: string; state: string; width: number; height: number }
export interface ProgramPopulation {
  visualCases?: ProgramVisualCase[];
  inventoryRoots?: string[]; extensions?: string[];
  id: string; version: string; members: string[]; exclusions: { id: string; reason: string }[];
  baselineDigest: string; evidence: string; allowNoWork: boolean;
}
export interface ProgramRegistry {
  schemas: Record<string, ProgramSchema>; executors: Record<string, ProgramExecutor>;
  policies: Record<string, ProgramPolicy>; acceptance: Record<string, ProgramAcceptance>;
  populations: Record<string, ProgramPopulation>; programs?: Record<string, WorkflowProgramV2>;
}
export interface ProgramAssessment {
  resolutionReceiptIds?: string[];
  receiptId?: string; generation?: number; operationId?: string;
  semanticDigest?: string; inputDigest?: string;
  phase?: "item" | "final"; obligationIds?: string[]; satisfiedObligationIds?: string[]; unsatisfiedObligationIds?: string[];
  environmentRef?: string; evidenceRefs?: string[]; contractDigest?: string;
  candidateDigest: string; verdict: "approved" | "changes_requested" | "inconclusive";
  findings: unknown[]; checks: { id: string; passed: boolean }[]; attemptIds: string[];
}
export interface ProgramCandidate {
  candidateId: string; digest: string; baselineDigest: string; parents: string[];
  deltas: string[]; producerAttempts: string[];
}
export type ProgramRepairResult =
  | { status: "accepted"; acceptedCandidate: ProgramCandidate; assessment: ProgramAssessment }
  | { status: "exhausted" | "stalled" | "uncertain" | "canceled"; lastCandidate: ProgramCandidate; reason: string };
export interface ProgramAttempt {
  attemptId: string; operationId: string; generation: number; inputDigest: string;
  executorDigest: string; startedAt: string; completedAt?: string;
  outcome: "running" | "completed" | "infrastructure_failed" | "invalid_output" | "uncertain" | "canceled_confirmed";
  outputRef?: string; threadId?: string; reason?: string;
  reservation?: { scopes: { id: string; limit: number }[]; status: "held" | "released"; ownerEpoch: string };
  observations?: Record<string, ProgramWorkerObservation>;
  usageApplicability?: "not-applicable" | "provider";
  usageSummary?: ProgramUsageSummary;
  resourceReservation?: { tokens: number; status: "held" | "released"; phase?: "work" | "final" };
  recovery?: { directory: string; inputDigest: string; workspaceDigest: string; threadId?: string; terminationObserved?: boolean; generationCompatible?: boolean };
  usage?: unknown;
}
export interface ProgramOperationRecord {
  kind?: string;
  retired?: boolean;
  dependencies?: string[];
  id: string; semanticDigest: string; inputDigest: string; generation: number;
  status: "declared" | "ready" | "running" | "waiting" | "completed" | "skipped" | "needs-attention" | "uncertain";
  outputRef?: string; attempts: string[]; reason?: string; reusedFromGeneration?: number;
}
export interface ProgramSignal {
  id: string; target: string; generation: number; type: string; correlation: string;
  payloadRef: string; authorization?: string; subjectDigest?: string; expiresAt?: string; status: "pending" | "consumed" | "pending-after-apply" | "stale";
}
export interface ProgramApplyIntent {
  requestId: string; requestDigest: string;
  id: string; candidateDigest: string; gateRef: string; semanticVersion: number;
  programDigest: string; acceptanceDigest: string; policyDigest: string; populationDigest: string;
  sealRefs: string[]; authorization: string; expectedDigest: string; changedFiles: string[];
}
export interface ProgramRunV2 {
  schemaVersion: 2; runId: string; requestId: string; requestDigest: string;
  program: WorkflowProgramV2; registry: ProgramRegistry; programDigest: string; registryDigest: string;
  inputRef: string; baselineDigest: string; baseRef?: string; createdAt: string; deadlineAt: string;
  version: number; semanticVersion: number; revision: number; planRevision: number;
  status: "executing" | "waiting" | "paused" | "needs-attention" | "completed" | "acceptance-ready" | "applying" | "applied" | "apply-uncertain" | "canceled";
  operations: Record<string, ProgramOperationRecord>; attempts: Record<string, ProgramAttempt>;
  seals: Record<string, string>; signals: ProgramSignal[]; candidates: Record<string, ProgramCandidate>;
  assessments: Record<string, ProgramAssessment>; coverageReceipts: Record<string, { populationDigest: string; baselineDigest: string; ids: string[]; status: string }>;
  deltas: Record<string, { artifactRef: string; inputCandidateDigest: string; outputCandidateDigest: string; producerAttemptId: string }>;
  waits: Record<string, { generation: number; deadlineAt?: string; signalId?: string; outputRef?: string }>;
  repairs: Record<string, { semanticDigest: string; inputDigest: string; candidate: ProgramCandidate; rounds: number; assessments: number; infrastructure: number; unchanged: number; repeated: number; priorFindings: string; feedback: unknown; phase: "implement" | "implementation-active" | "assess" | "assessment-active" | "decide" | "accepted" | "exhausted" | "stalled"; assessment?: ProgramAssessment }>;
  collections: Record<string, { seal: string; coverageReceiptId: string | null; generation: number; ids: string[]; acceptedAssessmentIds: string[]; acceptedCandidateIds: string[]; obligationsSatisfied: boolean }>;
  compositionResolutions?: Record<string, { receiptId: string; candidateId: string; candidateDigest: string; originalCandidateIds: string[]; attemptId: string; operationId: string; generation: number; semanticDigest: string; inputDigest: string; populationDigest: string; acceptanceDigest: string }>;
  resultRef?: string; gateRef?: string; intent?: ProgramApplyIntent; receiptRef?: string;
  acceptedCandidate?: ProgramCandidate;
  scopeResults?: Record<string, { outcomes: { id: string; status: string; reason?: string }[]; status: "completed" | "waiting" | "failed"; resultRef?: string }>;
  artifactRecords?: Record<string, ProgramCaptureReceipt>;
  queue?: { id: string; generation: number; at: string }[];
  totalAttempts: number; reason?: string;
}
export interface ProgramAssessmentContext {
  visualCases?: ProgramVisualCase[];
  runId: string; invocationId: string; assessmentId: string; phase: "item" | "final";
  candidateRef: ProgramCandidate; obligationIds: string[]; itemKey?: string;
  environmentRef: string; evidenceRefs: string[]; input: unknown;
}
export type ProgramCollectionItem = { key: string; outcome: "completed"; value: unknown } | { key: string; outcome: "failed" | "waiting"; reason?: string };
export interface ProgramCollectionResult {
  items: ProgramCollectionItem[]; results: unknown[]; failures: { id: string; reason: string }[];
  seal: string; coverage: unknown; status: "completed" | "partial" | "no-work";
}
export interface ProgramCaptureReceipt {
  receiptId: string; artifactRef: string; candidateDigest: string; environmentRef: string;
  itemKey: string; buildDigest: string; mime: string; width: number; height: number;
  route: string; viewport: string; state: string; producerAttemptId: string;
}
export class ProgramError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ProgramError"; }
}
export function programAssert(condition: unknown, message: string, code = "AF_PROGRAM_INVALID"): asserts condition {
  if (!condition) throw new ProgramError(code, message);
}
export function programDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}
/** Count before cloning/expanding; serialization is not a memory guard. */
export function programValueBytes(value: unknown, maxBytes: number, maxItems = 10000): number {
  let bytes = 0, nodes = 0;
  const walk = (entry: unknown, depth: number): void => {
    programAssert(depth <= 40 && ++nodes <= 1000000, "Value nesting/node budget exceeded");
    if (typeof entry === "string") bytes += Buffer.byteLength(entry) + 2;
    else if (entry === null || typeof entry === "number" || typeof entry === "boolean") bytes += 24;
    else if (Array.isArray(entry)) { programAssert(entry.length <= maxItems, "Value item budget exceeded"); bytes += 2; for (const item of entry) walk(item, depth + 1); }
    else if (entry && typeof entry === "object") { bytes += 2; for (const [key, child] of Object.entries(entry)) { bytes += Buffer.byteLength(key) + 4; walk(child, depth + 1); } }
    else programAssert(false, "Non-data value rejected");
    programAssert(bytes <= maxBytes, "Value byte budget exceeded");
  };
  walk(value, 0); return bytes;
}
export function refKey(ref: ProgramRef): string {
  programAssert(ref && typeof ref.id === "string" && typeof ref.version === "string", "Versioned reference required");
  return `${ref.id}@${ref.version}`;
}
export function registryEntry<T>(entries: Record<string, T>, ref: ProgramRef): T {
  const key = refKey(ref); programAssert(Object.hasOwn(entries, key), `Unregistered reference ${key}`); return entries[key];
}
export function validateProgramData(value: unknown, schema: ProgramSchema, depth = 0): void {
  programAssert(depth <= 32, "Schema/data depth exceeded");
  if (schema.anyOf) {
    programAssert(schema.anyOf.some(option => { try { validateProgramData(value, option, depth + 1); return true; } catch { return false; } }), "No schema alternative matched");
  }
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (schema.type) programAssert((Array.isArray(schema.type) ? schema.type : [schema.type]).some(expected => expected === type || expected === "integer" && typeof value === "number" && Number.isSafeInteger(value)), `Expected ${schema.type}, got ${type}`);
  if (schema.enum) programAssert(schema.enum.some(entry => programDigest(entry) === programDigest(value)), "Value outside enum");
  if (Object.hasOwn(schema, "const")) programAssert(programDigest(value) === programDigest(schema.const), "Const mismatch");
  if (typeof value === "number") programAssert(Number.isFinite(value) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum), "Number outside bounds");
  if (typeof value === "string") programAssert((schema.minLength === undefined || value.length >= schema.minLength) && (schema.maxLength === undefined || value.length <= schema.maxLength), "String outside bounds");
  if (Array.isArray(value)) {
    programAssert((schema.minItems === undefined || value.length >= schema.minItems) && (schema.maxItems === undefined || value.length <= schema.maxItems), "Array outside bounds");
    if (schema.items) for (const entry of value) validateProgramData(entry, schema.items, depth + 1);
  } else if (value && typeof value === "object") {
    const data = value as Record<string, unknown>;
    for (const key of schema.required ?? []) programAssert(Object.hasOwn(data, key), `Missing field ${key}`);
    for (const [key, entry] of Object.entries(data)) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) validateProgramData(entry, schema.properties[key], depth + 1);
      else programAssert(schema.additionalProperties !== false, `Unexpected field ${key}`);
    }
  }
}
export function programPath(path: string): void {
  programAssert(typeof path === "string" && path.length > 0 && path.length < 2048 && !path.includes("\\") && !path.includes("\0") && !path.startsWith("/") && !path.includes(":") && path.split("/").every(part => part !== ".." && part !== "." && part !== ""), "Invalid relative path");
  programAssert(path !== ".git" && !path.startsWith(".git/") && !path.startsWith(".forge/local/"), "Protected path");
}
export function programWithin(path: string, scope: string[]): boolean { return scope.some(prefix => path === prefix || path.startsWith(`${prefix}/`)); }
export function validateWorkflowProgram(program: WorkflowProgramV2, registry: ProgramRegistry, ancestry: Set<string> = new Set(), lexical: ProgramLexicalContext = {}): void {
  programAssert(program?.schemaVersion === 2 && typeof program.id === "string" && program.id.length > 0 && Number.isSafeInteger(program.version) && program.version > 0, "Program v2 required");
  programAssert(program.operatorVersion === undefined || program.operatorVersion === 2, "Unsupported operator version");
  programAssert(program.mode === undefined || ["data", "candidate"].includes(program.mode), "Invalid workflow mode");
  programValueBytes(program, 4 * 1024 * 1024); programValueBytes(registry, 4 * 1024 * 1024);
  const identity = programDigest(program); programAssert(!ancestry.has(identity), "Recursive subworkflow cycle"); ancestry = new Set([...ancestry, identity]); programAssert(ancestry.size <= 32, "Subworkflow depth exceeded");
  const schemaKeys = new Set(["type", "enum", "const", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", "anyOf"]);
  function validateSchema(schema: ProgramSchema, depth: number): void {
    programAssert(schema && typeof schema === "object" && !Array.isArray(schema) && depth <= 32 && Object.keys(schema).every(key => schemaKeys.has(key)), "Unsupported/invalid schema keyword");
    if (schema.type) programAssert((Array.isArray(schema.type) ? schema.type : [schema.type]).every(type => ["object", "array", "string", "number", "integer", "boolean", "null"].includes(type)), "Unsupported schema type");
    if (schema.properties) for (const child of Object.values(schema.properties)) validateSchema(child, depth + 1);
    if (schema.items) validateSchema(schema.items, depth + 1);
    if (schema.anyOf) { programAssert(Array.isArray(schema.anyOf) && schema.anyOf.length > 0 && schema.anyOf.length <= 32, "Invalid schema alternatives"); for (const child of schema.anyOf) validateSchema(child, depth + 1); }
    if (schema.required) programAssert(Array.isArray(schema.required) && schema.required.every(key => typeof key === "string"), "Invalid required fields");
  }
  for (const schema of Object.values(registry.schemas)) validateSchema(schema, 0);
  registryEntry(registry.schemas, program.inputSchema); registryEntry(registry.schemas, program.outputSchema);
  const policy = registryEntry(registry.policies, program.policy), acceptance = registryEntry(registry.acceptance, program.acceptance);
  for (const field of ["maxItems", "concurrency", "maxAttempts", "maxOperations", "maxDepth", "deadlineMs", "maxOutputBytes"] as const) programAssert(Number.isSafeInteger(policy[field]) && policy[field] > 0, `Invalid limit ${field}`);
  programAssert(policy.concurrency <= 32 && policy.maxDepth <= 32 && policy.maxItems <= 10000 && policy.maxAttempts <= 10000 && policy.maxOperations <= 20000 && policy.maxOutputBytes <= 4 * 1024 * 1024, "Physical limits exceeded");
  if (policy.resources) {
    const budget = policy.resources;
    for (const value of [budget.maxTokens, budget.reserveTokensPerAttempt, budget.finalReserveTokens ?? 0]) programAssert(Number.isSafeInteger(value) && value >= 0, "Invalid resource budget");
    programAssert(budget.maxTokens > 0 && budget.reserveTokensPerAttempt > 0 && (budget.finalReserveTokens ?? 0) <= budget.maxTokens && ["block", "allow"].includes(budget.unknownUsage), "Invalid resource policy");
  }
  for (const path of [...policy.writeScope, ...acceptance.writeScope, ...(policy.captureScope ?? [])]) programPath(path);
  programAssert(acceptance.criteria.length > 0 && new Set(acceptance.criteria).size === acceptance.criteria.length, "Acceptance criteria required and unique");
  if (program.population) { const population = registryEntry(registry.populations, program.population); programAssert(population.members.length <= policy.maxItems && new Set(population.members).size === population.members.length && population.evidence.length > 0, "Population inventory invalid"); validateVisualPopulation(population); }
  const kinds = new Set(["agent", "command", "map", "branch", "loop", "compose", "gate", "repair", "subworkflow", "waitEvent", "value"]);
  const expressions: Record<string, [number, number]> = { workflowInput: [0, 0], item: [0, 0], loopState: [0, 0], output: [1, 1], field: [2, 2], literal: [1, 1], object: [1, 1], array: [0, 10000], eq: [2, 2], and: [1, 100], or: [1, 100], not: [1, 1], concat: [1, 100], filter: [3, 3], unique: [2, 2], sort: [2, 2], take: [2, 2], length: [1, 1], population: [0, 0], acceptance: [0, 0], acceptedCandidate: [1, 1], acceptedCandidates: [1, 1], outputCandidate: [1, 1], candidateFromBaseline: [0, 1], coverageFor: [2, 2], coverageReceipt: [1, 1], acceptanceWriteScope: [1, 1], approvedChecksFor: [1, 1], acceptanceChecks: [1, 1] };
  function inspect(value: unknown, resolve: (id: string) => string | undefined, dependencies: Set<string>, depth = 0): void {
    programAssert(depth <= 32, "Expression nesting exceeded");
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const entry of value) inspect(entry, resolve, dependencies, depth + 1); return; }
    const object = value as Record<string, unknown>;
    if (Object.hasOwn(object, "$expr")) {
      const expression = object as unknown as ProgramExpr, limits = expressions[expression.$expr];
      programAssert(limits && Array.isArray(expression.args) && expression.args.length >= limits[0] && expression.args.length <= limits[1] && Object.keys(object).every(key => key === "$expr" || key === "args"), "Unknown expression/arity");
      if (["output", "acceptedCandidate", "acceptedCandidates", "outputCandidate", "coverageReceipt"].includes(expression.$expr)) { const target = resolve(String(expression.args[0])); programAssert(target, `Unknown output ${expression.args[0]}`); dependencies.add(target); }
      if (expression.$expr !== "literal") for (const arg of expression.args) inspect(arg, resolve, dependencies, depth + 1); return;
    }
    for (const entry of Object.values(object)) inspect(entry, resolve, dependencies, depth + 1);
  }
  const options: Record<string, string[]> = {
    value: ["value"], agent: ["executor", "input", "candidate", "writeScope"], command: ["executor", "input", "candidate", "writeScope"],
    map: ["items", "key", "coverage", "concurrency", "completion", "quorum", "body", "order"],
    branch: ["condition", "then", "else"], loop: ["initialState", "maxRounds", "body", "next", "until"],
    repair: ["recipe", "entryMode", "initialCandidate", "writeScope", "implement", "review", "checks", "input", "assessmentScope", "evidence", "maxRepairRounds", "maxAssessmentAttempts", "maxInfrastructureAttempts", "progressPolicy"],
    compose: ["candidates", "onConflict", "resolver", "resolverInput", "resolverWriteScope"], gate: ["candidate", "coverage", "authorization"], subworkflow: ["program", "input"],
    waitEvent: ["schema", "type", "correlation", "subject", "timeoutMs"], sequence: ["steps", "result"], parallel: ["steps", "result", "onFailure"],
  };
  kinds.add("sequence"); kinds.add("parallel");
  const entries = programGraph(program);
  programAssert(entries.length <= policy.maxOperations, "Template limit exceeded");
  for (const entry of entries) {
    const step = entry.step;
    programAssert(step && kinds.has(step.kind) && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(step.id) && step.options && typeof step.options === "object", "Invalid operation");
    programAssert(Object.keys(step.options).every(key => [...options[step.kind], "after", "label"].includes(key)), `Unknown ${step.kind} option`);
    programAssert(entries.filter(other => other.id === entry.id).length === 1, "Duplicate operation ID");
    inspect(Object.fromEntries(Object.entries(step.options).filter(([key]) => !["body", "steps", "result", "then", "else", "next", "until"].includes(key))), id => id, new Set());
    programAssert(entry.id.split("/").length <= policy.maxDepth * 3 + 1, "Template depth exceeded");
    if (step.kind === "map") {
      programAssert(["all-required", "partial", "quorum"].includes(String(step.options.completion)), "Explicit map completion required");
      programAssert(step.options.order === undefined || ["key", "input"].includes(String(step.options.order)), "Invalid map order");
      if (step.options.completion !== "all-required") programAssert(acceptance.allowPartial, "Partial/quorum requires owner acceptance permission");
      if (step.options.completion === "quorum") programAssert(step.options.quorum && typeof step.options.quorum === "object" && Number.isSafeInteger((step.options.quorum as { minAccepted: number }).minAccepted) && (step.options.quorum as { minAccepted: number }).minAccepted > 0, "Quorum minAccepted required");
      else programAssert(step.options.quorum === undefined, "Quorum only applies to quorum completion");
    }
    if (["agent", "command"].includes(step.kind)) { const executor = registryEntry(registry.executors, step.options.executor as ProgramRef); programAssert(executor.tokenAccounting === undefined || executor.tokenAccounting === "provider" || executor.tokenAccounting === "none" && executor.kind === "command", "Token accounting exemption only applies to owner-declared nonprovider commands"); if (executor.inputSchema) registryEntry(registry.schemas, executor.inputSchema); }
    if (step.kind === "compose" && step.options.resolver) programAssert(registryEntry(registry.executors, step.options.resolver as ProgramRef).effect === "isolated-write", "Conflict resolver must produce an isolated candidate");
    if (step.kind === "repair") {
      registryEntry(registry.executors, step.options.implement as ProgramRef); registryEntry(registry.executors, step.options.review as ProgramRef);
      programAssert(["implement-first", "assess-first"].includes(String(step.options.entryMode)), "Repair entryMode required");
      programAssert((step.options.recipe as ProgramRef)?.id === "repair" && (step.options.recipe as ProgramRef)?.version === "v2", "Unsupported repair recipe");
      const phase = step.options.assessmentScope as "item" | "final" | undefined;
      programAssert(phase === undefined || phase === "item" || phase === "final", "Invalid assessment scope");
      if (acceptance.requiredChecksByScope) {
        programAssert(phase && acceptance.assessmentBindings?.[step.id] === phase, "Assessment scope must match owner operation binding");
        if (phase === "item") programAssert(lexical.item || entries.some(ancestor => ancestor.step.kind === "map" && entry.id.startsWith(`${ancestor.id}/body/`)), "Item assessment requires a map context");
      }
      const required = phase && acceptance.requiredChecksByScope ? acceptance.requiredChecksByScope[phase] : acceptance.requiredChecks;
      programAssert(Array.isArray(step.options.checks) && required.every(check => (step.options.checks as unknown[]).includes(check)), "Repair cannot omit required checks");
      for (const ref of (step.options.evidence ?? []) as ProgramRef[]) programAssert(registryEntry(registry.executors, ref).effect === "read", "Evidence executor must be readonly");
    }
    if (step.kind === "parallel") programAssert(["collect-all", "cancel-siblings"].includes(String(step.options.onFailure)), "Parallel failure policy required");
    if (step.kind === "compose") programAssert(step.options.onConflict === undefined || step.options.onConflict === "needs-resolution", "Unsupported conflict policy");
    if (step.kind === "waitEvent") registryEntry(registry.schemas, step.options.schema as ProgramRef);
    if (step.kind === "subworkflow") { const child = registryEntry(registry.programs ?? {}, step.options.program as ProgramRef); programAssert(programDigest(child.policy) === programDigest(program.policy) && programDigest(child.acceptance) === programDigest(program.acceptance), "Child cannot replace inherited policy/acceptance"); programAssert(!child.population || program.population && programDigest(child.population) === programDigest(program.population), "Child cannot replace inherited population"); validateWorkflowProgram(child, registry, ancestry, { ...lexical, ...(entries.some(ancestor => ancestor.step.kind === "map" && entry.id.startsWith(`${ancestor.id}/body/`)) ? { item: {} } : {}), ...(entries.some(ancestor => ancestor.step.kind === "loop" && entry.id.startsWith(`${ancestor.id}/body/`)) ? { state: {} } : {}) }); }
  }
  programAssert(Object.hasOwn(program, "result"), "Explicit program result required");
  inspect(program.result, id => program.steps.some(step => step.id === id) ? id : undefined, new Set());
  if (acceptance.requiredChecksByScope) programAssert(acceptance.obligations?.length && new Set(acceptance.obligations.map(obligation => obligation.id)).size === acceptance.obligations.length, "Scoped acceptance requires unique owner obligations");
  validateProgramTypes(program, registry, lexical);
  programDigest(program); programDigest(registry);
}
