/** A pure, JSON-persistable workflow reducer. Dispatch belongs to the calling adapter. */
export interface WorkflowNode {
  nodeId: string;
  kind: "activity" | "verification" | "join" | "decision";
  dependsOn: string[];
  inputDigest: string;
  required: boolean;
  inputRefs?: string[];
  contextRefs?: string[];
  outputContract?: { requiredEvidenceKinds: string[] };
  decisionId?: string;
}
export interface WorkflowLimits { maxConcurrency: number; maxAttempts: number; maxRevisions: number; maxTotalAttempts: number }
export type WorkflowResult = { status: "succeeded"; outputDigest: string; evidenceRefs: string[]; evidenceKinds: string[]; selectedNodeIds?: string[] } | { status: "failed"; reason: string } | { status: "uncertain"; reason: string };
export interface WorkflowRun { attemptId: string; nodeId: string; executorId: string; revision: number; generation: number; status: "running" | WorkflowResult["status"]; result?: WorkflowResult }
export interface WorkflowState {
  schemaVersion: 1;
  workflowId: string;
  revision: number;
  nodes: WorkflowNode[];
  limits: WorkflowLimits;
  generations: { nodeId: string; generation: number }[];
  runs: WorkflowRun[];
  revisions: { revision: number; reason: string; evidenceRefs: string[]; invalidatedNodeIds: string[] }[];
  skipped: { nodeId: string; reason: string; decisionAttemptId?: string }[];
}
export interface WorkflowPacket {
  nodeId: string; kind: WorkflowNode["kind"]; inputDigest: string; revision: number;
  inputRefs?: string[]; contextRefs?: string[]; outputContract?: WorkflowNode["outputContract"];
  depOutputs: { nodeId: string; attemptId: string; outputDigest: string; evidenceRefs: string[]; evidenceKinds: string[] }[];
}
const defaults: WorkflowLimits = { maxConcurrency: 2, maxAttempts: 3, maxRevisions: 10, maxTotalAttempts: 100 };
const copy = <T>(value: T): T => structuredClone(value);
function ensure(value: unknown, message: string): asserts value { if (!value) throw new Error(`workflow: ${message}`); }
function nonempty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function digest(value: unknown): value is string { return typeof value === "string" && /^(?:sha256:)?[a-f0-9]{64}$/.test(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(nonempty) && new Set(value).size === value.length; }
function keys(value: unknown, allowed: string[]) { ensure(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)), "unknown or invalid properties"); }
function validateNodes(nodes: WorkflowNode[]) {
  ensure(Array.isArray(nodes) && nodes.length > 0, "nodes must be nonempty");
  const ids = new Set<string>();
  for (const node of nodes) {
    keys(node, ["nodeId", "kind", "dependsOn", "inputDigest", "required", "inputRefs", "contextRefs", "outputContract", "decisionId"]);
    ensure(node && nonempty(node.nodeId) && !ids.has(node.nodeId), "duplicate or invalid nodeId"); ids.add(node.nodeId);
    ensure(["activity", "verification", "join", "decision"].includes(node.kind), "invalid node kind");
    ensure(digest(node.inputDigest) && typeof node.required === "boolean" && strings(node.dependsOn), "invalid node contract");
    for (const refs of [node.inputRefs, node.contextRefs]) ensure(refs === undefined || strings(refs), "invalid references");
    if (node.outputContract !== undefined) { keys(node.outputContract, ["requiredEvidenceKinds"]); ensure(strings(node.outputContract.requiredEvidenceKinds), "invalid output contract"); }
    ensure(node.decisionId === undefined || nonempty(node.decisionId), "invalid decisionId");
  }
  for (const node of nodes) if (node.decisionId !== undefined) ensure(node.dependsOn.includes(node.decisionId) && nodes.some(candidate => candidate.nodeId === node.decisionId && candidate.kind === "decision"), "decisionId must reference a declared decision dependency");
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string) => {
    ensure(!visiting.has(id), "dependency cycle"); if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of nodes.find(node => node.nodeId === id)!.dependsOn) { ensure(ids.has(dep), "missing dependency"); visit(dep); }
    visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
}
function generation(state: WorkflowState, id: string) { return state.generations.find(item => item.nodeId === id)!.generation; }
function success(state: WorkflowState, id: string) {
  return [...state.runs].reverse().find(run => run.nodeId === id && run.generation === generation(state, id) && run.status === "succeeded");
}
function validateResult(state: WorkflowState, node: WorkflowNode, result: WorkflowResult) {
  ensure(result && ["succeeded", "failed", "uncertain"].includes(result.status), "invalid result status");
  if (result.status !== "succeeded") { keys(result, ["status", "reason"]); ensure(nonempty(result.reason), "result reason required"); return; }
  keys(result, ["status", "outputDigest", "evidenceRefs", "evidenceKinds", "selectedNodeIds"]);
  ensure(digest(result.outputDigest) && strings(result.evidenceRefs) && result.evidenceRefs.length > 0 && strings(result.evidenceKinds), "invalid success evidence");
  ensure((node.outputContract?.requiredEvidenceKinds ?? []).every(kind => result.evidenceKinds.includes(kind)), "required evidence missing");
  if ((node.outputContract?.requiredEvidenceKinds.length ?? 0) > 0) ensure(result.evidenceRefs.length > 0, "evidence references missing");
  if (node.kind === "decision") {
    ensure(strings(result.selectedNodeIds), "decision selection required");
    const children = state.nodes.filter(child => child.dependsOn.includes(node.nodeId));
    ensure(result.selectedNodeIds.every(id => children.some(child => child.nodeId === id)), "decision selected a non-child");
    ensure(children.filter(child => child.required).every(child => result.selectedNodeIds!.includes(child.nodeId)), "decision cannot skip required child");
  } else ensure(result.selectedNodeIds === undefined, "only decisions can select branches");
}
export function validateWorkflowState(state: WorkflowState): WorkflowState {
  keys(state, ["schemaVersion", "workflowId", "revision", "nodes", "limits", "generations", "runs", "revisions", "skipped"]);
  ensure(state && state.schemaVersion === 1 && nonempty(state.workflowId), "invalid state"); validateNodes(state.nodes);
  keys(state.limits, Object.keys(defaults)); ensure(Object.keys(defaults).every(key => Number.isSafeInteger(state.limits[key as keyof WorkflowLimits]) && state.limits[key as keyof WorkflowLimits] > 0), "invalid limits");
  ensure(Number.isSafeInteger(state.revision) && state.revision >= 1 && state.revision <= state.limits.maxRevisions, "invalid revision");
  ensure(Array.isArray(state.generations) && state.generations.length === state.nodes.length && new Set(state.generations.map(item => item.nodeId)).size === state.nodes.length, "invalid generations");
  for (const item of state.generations) { keys(item, ["nodeId", "generation"]); ensure(state.nodes.some(node => node.nodeId === item.nodeId) && Number.isSafeInteger(item.generation) && item.generation >= 1 && item.generation <= state.revision, "invalid generation"); }
  ensure(Array.isArray(state.runs) && state.runs.length <= state.limits.maxTotalAttempts && new Set(state.runs.map(run => run.attemptId)).size === state.runs.length, "invalid or duplicate attempts");
  for (const run of state.runs) {
    keys(run, ["attemptId", "nodeId", "executorId", "revision", "generation", "status", "result"]);
    ensure(nonempty(run.attemptId) && nonempty(run.nodeId) && nonempty(run.executorId), "invalid attempt identity");
    ensure(Number.isSafeInteger(run.revision) && run.revision >= 1 && run.revision <= state.revision && Number.isSafeInteger(run.generation) && run.generation >= 1 && run.generation <= run.revision, "invalid attempt revision");
    ensure(["running", "succeeded", "failed", "uncertain"].includes(run.status), "invalid attempt status");
    ensure(run.status === "running" ? run.result === undefined : run.result?.status === run.status, "inconsistent result");
    const node = state.nodes.find(node => node.nodeId === run.nodeId);
    if (run.status === "running" || run.status === "uncertain") ensure(node && run.generation === generation(state, run.nodeId), "orphan or stale active attempt");
    if (node && run.generation === generation(state, run.nodeId) && run.result) validateResult(state, node, run.result);
    else if (run.result) {
      keys(run.result, run.result.status === "succeeded" ? ["status", "outputDigest", "evidenceRefs", "evidenceKinds", "selectedNodeIds"] : ["status", "reason"]);
      ensure(run.result.status === "succeeded" ? digest(run.result.outputDigest) && strings(run.result.evidenceRefs) && run.result.evidenceRefs.length > 0 && strings(run.result.evidenceKinds) && (run.result.selectedNodeIds === undefined || strings(run.result.selectedNodeIds)) : nonempty(run.result.reason), "invalid historical result");
    }
  }
  ensure(state.runs.filter(run => run.status === "running" || run.status === "uncertain").length <= state.limits.maxConcurrency, "concurrency exceeded");
  for (const id of new Set(state.runs.map(run => run.nodeId))) {
    const runs = state.runs.filter(run => run.nodeId === id);
    ensure(runs.length <= state.limits.maxAttempts, "node attempts exceeded");
    ensure(runs.filter(run => run.status === "running" || run.status === "uncertain").length <= 1, "overlapping attempts");
    if (state.nodes.some(node => node.nodeId === id)) ensure(runs.filter(run => run.generation === generation(state, id) && run.status === "succeeded").length <= 1, "duplicate current success");
  }
  ensure(Array.isArray(state.revisions) && state.revisions.length === state.revision && state.revisions.every((revision, index) => revision.revision === index + 1 && nonempty(revision.reason) && strings(revision.evidenceRefs) && strings(revision.invalidatedNodeIds)), "invalid revision history");
  for (const revision of state.revisions) keys(revision, ["revision", "reason", "evidenceRefs", "invalidatedNodeIds"]);
  ensure(Array.isArray(state.skipped) && new Set(state.skipped.map(item => item.nodeId)).size === state.skipped.length && state.skipped.every(item => state.nodes.some(node => node.nodeId === item.nodeId) && nonempty(item.reason)), "invalid skips");
  for (const skip of state.skipped) keys(skip, ["nodeId", "reason", "decisionAttemptId"]);
  const derived = refresh(copy(state)).skipped;
  ensure(JSON.stringify(state.skipped) === JSON.stringify(derived), "skip lineage inconsistent");
  for (const node of state.nodes) {
    const completed = success(state, node.nodeId);
    if (completed || state.runs.some(run => run.nodeId === node.nodeId && run.status === "running")) {
      ensure(!derived.some(skip => skip.nodeId === node.nodeId), "attempt in skipped branch");
      ensure(node.dependsOn.every(id => success(state, id) || (node.kind === "join" && derived.some(skip => skip.nodeId === id))), "dependency evidence missing");
    }
  }
  return state;
}
function refresh(state: WorkflowState): WorkflowState {
  state.skipped = [];
  const skip = (id: string, reason: string, decisionAttemptId?: string) => { if (!state.skipped.some(item => item.nodeId === id)) state.skipped.push({ nodeId: id, reason, ...(decisionAttemptId ? { decisionAttemptId } : {}) }); };
  for (const decision of state.nodes.filter(node => node.kind === "decision")) {
    const run = success(state, decision.nodeId);
    if (run?.result?.status === "succeeded") for (const child of state.nodes.filter(node => node.dependsOn.includes(decision.nodeId))) {
      if (!run.result.selectedNodeIds!.includes(child.nodeId)) skip(child.nodeId, `unselected branch of ${decision.nodeId}`, run.attemptId);
    }
  }
  let changed = true;
  while (changed) { changed = false; for (const node of state.nodes) {
    const parent = state.skipped.find(item => node.dependsOn.includes(item.nodeId));
    if (parent && node.kind !== "join" && !state.skipped.some(item => item.nodeId === node.nodeId)) { skip(node.nodeId, `skipped dependency ${parent.nodeId}`, parent.decisionAttemptId); changed = true; }
  } }
  return state;
}
export function createWorkflow(input: { workflowId: string; nodes: WorkflowNode[]; limits?: Partial<WorkflowLimits> }): WorkflowState {
  keys(input, ["workflowId", "nodes", "limits"]);
  return validateWorkflowState(copy({ schemaVersion: 1, workflowId: input.workflowId, revision: 1, nodes: input.nodes, limits: { ...defaults, ...input.limits }, generations: input.nodes.map(node => ({ nodeId: node.nodeId, generation: 1 })), runs: [], revisions: [{ revision: 1, reason: "created", evidenceRefs: [], invalidatedNodeIds: [] }], skipped: [] }));
}
export function nextWorkflow(input: WorkflowState): { state: WorkflowState; packets: WorkflowPacket[]; complete: boolean; blockedReasons: string[] } {
  const state = refresh(copy(validateWorkflowState(input)));
  const skipped = new Set(state.skipped.map(item => item.nodeId));
  const pending = state.nodes.filter(node => !success(state, node.nodeId) && !skipped.has(node.nodeId));
  const active = state.runs.filter(run => run.status === "running" || run.status === "uncertain");
  const blockedReasons: string[] = [];
  for (const run of active.filter(run => run.status === "uncertain")) blockedReasons.push(`uncertain attempt ${run.attemptId} requires reconciliation`);
  for (const node of state.nodes.filter(node => node.required && skipped.has(node.nodeId))) blockedReasons.push(`required node ${node.nodeId} was skipped`);
  const slots = state.limits.maxConcurrency - active.length;
  const remaining = state.limits.maxTotalAttempts - state.runs.length;
  if (remaining === 0 && pending.length) blockedReasons.push("total attempt budget exhausted");
  const eligible = pending.filter(node => {
    if (active.some(run => run.nodeId === node.nodeId)) return false;
    if (state.runs.filter(run => run.nodeId === node.nodeId).length >= state.limits.maxAttempts) { blockedReasons.push(`attempt budget exhausted for ${node.nodeId}`); return false; }
    return node.dependsOn.every(id => success(state, id) || (node.kind === "join" && skipped.has(id)));
  });
  const packets = eligible.slice(0, Math.max(0, Math.min(slots, remaining))).map(node => ({
    nodeId: node.nodeId, kind: node.kind, inputDigest: node.inputDigest, revision: state.revision,
    ...(node.inputRefs ? { inputRefs: node.inputRefs } : {}), ...(node.contextRefs ? { contextRefs: node.contextRefs } : {}), ...(node.outputContract ? { outputContract: node.outputContract } : {}),
    depOutputs: node.dependsOn.flatMap(id => { const run = success(state, id); return run?.result?.status === "succeeded" ? [{ nodeId: id, attemptId: run.attemptId, outputDigest: run.result.outputDigest, evidenceRefs: run.result.evidenceRefs, evidenceKinds: run.result.evidenceKinds }] : []; }),
  }));
  return { state, packets, complete: pending.length === 0 && active.length === 0 && blockedReasons.length === 0, blockedReasons };
}
export function claimWorkflow(input: WorkflowState, claim: { nodeId: string; attemptId: string; executorId: string; expectedRevision?: number }): WorkflowState {
  keys(claim, ["nodeId", "attemptId", "executorId", "expectedRevision"]);
  const next = nextWorkflow(input), state = next.state;
  ensure(claim.expectedRevision === undefined || claim.expectedRevision === state.revision, "stale revision");
  ensure(nonempty(claim.attemptId) && nonempty(claim.executorId) && !state.runs.some(run => run.attemptId === claim.attemptId), "invalid or duplicate attempt identity");
  ensure(next.packets.some(packet => packet.nodeId === claim.nodeId), "node is not ready");
  state.runs.push({ nodeId: claim.nodeId, attemptId: claim.attemptId, executorId: claim.executorId, revision: state.revision, generation: generation(state, claim.nodeId), status: "running" });
  return validateWorkflowState(state);
}
export function completeWorkflow(input: WorkflowState, completion: { attemptId: string; result: WorkflowResult }): WorkflowState {
  keys(completion, ["attemptId", "result"]);
  const state = copy(validateWorkflowState(input)), run = state.runs.find(run => run.attemptId === completion.attemptId);
  ensure(run?.status === "running", "attempt is not running");
  const node = state.nodes.find(node => node.nodeId === run.nodeId);
  ensure(node && run.generation === generation(state, run.nodeId), "stale attempt");
  validateResult(state, node, completion.result); run.result = copy(completion.result); run.status = completion.result.status;
  return validateWorkflowState(refresh(state));
}
export function reconcileWorkflow(input: WorkflowState, completion: { attemptId: string; result: Exclude<WorkflowResult, { status: "uncertain" }> }): WorkflowState {
  keys(completion, ["attemptId", "result"]);
  const state = copy(validateWorkflowState(input)), run = state.runs.find(run => run.attemptId === completion.attemptId);
  ensure(run?.status === "uncertain", "attempt cannot be reconciled");
  run.status = "running"; delete run.result; return completeWorkflow(state, completion);
}
export function recoverWorkflow(input: WorkflowState, reason = "executor interrupted; reconcile effects before retry"): WorkflowState {
  ensure(nonempty(reason), "recovery reason required"); const state = copy(validateWorkflowState(input));
  for (const run of state.runs.filter(run => run.status === "running")) { run.status = "uncertain"; run.result = { status: "uncertain", reason }; }
  return validateWorkflowState(refresh(state));
}
export function replanWorkflow(input: WorkflowState, change: { nodes: WorkflowNode[]; expectedRevision: number; reason: string; evidenceRefs: string[] }): WorkflowState {
  keys(change, ["nodes", "expectedRevision", "reason", "evidenceRefs"]);
  const state = copy(validateWorkflowState(input)); validateNodes(change.nodes);
  ensure(change.expectedRevision === state.revision, "stale revision");
  ensure(state.revision < state.limits.maxRevisions && nonempty(change.reason) && strings(change.evidenceRefs) && change.evidenceRefs.length > 0, "replan budget or evidence missing");
  ensure(!state.runs.some(run => run.status === "running" || run.status === "uncertain"), "reconcile active attempts before replan");
  for (const previous of state.nodes.filter(node => node.required)) {
    const next = change.nodes.find(node => node.nodeId === previous.nodeId);
    ensure(next?.required && next.kind === previous.kind, "cannot remove or weaken required node");
    ensure((previous.outputContract?.requiredEvidenceKinds ?? []).every(kind => next.outputContract?.requiredEvidenceKinds.includes(kind)), "cannot weaken required evidence");
    ensure(previous.dependsOn.every(id => next.dependsOn.includes(id)), "cannot remove required dependency");
  }
  const semantic = (node: WorkflowNode) => JSON.stringify({ nodeId: node.nodeId, kind: node.kind, required: node.required, inputDigest: node.inputDigest, dependsOn: [...node.dependsOn].sort(), inputRefs: [...(node.inputRefs ?? [])].sort(), contextRefs: [...(node.contextRefs ?? [])].sort(), requiredEvidenceKinds: [...(node.outputContract?.requiredEvidenceKinds ?? [])].sort(), decisionId: node.decisionId ?? null });
  const invalid = new Set(change.nodes.filter(node => !state.nodes.some(old => old.nodeId === node.nodeId && semantic(old) === semantic(node))).map(node => node.nodeId));
  for (const decision of change.nodes.filter(node => node.kind === "decision")) {
    const children = (nodes: WorkflowNode[]) => nodes.filter(node => node.dependsOn.includes(decision.nodeId)).map(node => node.nodeId).sort();
    if (JSON.stringify(children(state.nodes)) !== JSON.stringify(children(change.nodes))) invalid.add(decision.nodeId);
  }
  let changed = true; while (changed) { changed = false; for (const node of change.nodes) if (!invalid.has(node.nodeId) && node.dependsOn.some(id => invalid.has(id))) { invalid.add(node.nodeId); changed = true; } }
  state.revision++;
  state.generations = change.nodes.map(node => ({ nodeId: node.nodeId, generation: invalid.has(node.nodeId) ? state.revision : generation(state, node.nodeId) }));
  state.nodes = copy(change.nodes); state.revisions.push({ revision: state.revision, reason: change.reason, evidenceRefs: copy(change.evidenceRefs), invalidatedNodeIds: [...invalid] });
  return validateWorkflowState(refresh(state));
}
