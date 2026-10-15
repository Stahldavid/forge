import { requestExistingDeltaBroker } from "../delta/broker.ts";
import { readTraceOwnerConfiguration, type TraceOwnerConfiguration } from "../agent-fabric/trace-owner-runtime.ts";
import { normalizeTraceRunKey, traceOpaque, traceRelativePath, traceSummary, type TraceRunKey } from "../agent-fabric/trace-contract.ts";
import type { AgentMemoryContextEvent, AgentMemoryContextPack, AgentMemoryTraceContext, AgentMemoryTraceContextItem } from "./types.ts";

export interface AgentMemoryTraceContextInput {
  workspaceRoot: string;
  scope: AgentMemoryContextPack["scope"];
  entry?: string;
  proof?: string;
  change?: string;
  events?: Array<Pick<AgentMemoryContextEvent, "files" | "entries" | "proofs">>;
  paths?: string[];
}
export interface TraceContextReaders {
  readConfiguration: (root: string, options: { timeoutMs: number }) => Promise<TraceOwnerConfiguration | undefined>;
  request: (root: string, method: string, args: unknown[], timeoutMs: number) => Promise<unknown>;
  now: () => number;
}
const limits = { maxRuns: 4, maxPaths: 8, maxFacts: 128, maxBytes: 32768, maxRpcCalls: 8, timeBudgetMs: 2000 };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const digest = (value: unknown): value is string => typeof value === "string" && /^(?:sha256:)?[a-f0-9]{64}$/u.test(value);
const ref = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const strings = (value: unknown) => list(value).filter((item): item is string => typeof item === "string");
function opaque(value: unknown): string | undefined { try { return traceOpaque(value); } catch { return; } }
function path(value: unknown): string | undefined { try { return traceRelativePath(value); } catch { return; } }
function summary(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  if (/```|=>|\b(?:const|let|var|function|import|export|class)\s|console\.|<script/iu.test(value)) return "[CODE OMITTED]";
  try { return traceSummary(value).replace(/[\x00-\x1f\x7f]/gu, " "); } catch { return; }
}
const unique = (values: string[]) => [...new Set(values)].sort();
function identityMatches(key: TraceRunKey, configuration: TraceOwnerConfiguration) {
  return key.repositoryId === configuration.identity.repositoryId && key.checkoutId === configuration.identity.checkoutId && key.fabricStoreId === configuration.identity.fabricStoreId;
}
function selectedPaths(input: AgentMemoryTraceContextInput): AgentMemoryTraceContext["selection"] {
  let events = input.events ?? [], basis: AgentMemoryTraceContext["selection"]["basis"] = "workspace-observed-files";
  if (input.paths !== undefined) { basis = "explicit-paths"; return { basis, relevance: "path-overlap", paths: unique(input.paths.map(path).filter((value): value is string => !!value)), causality: "not-inferred" }; }
  if (input.scope === "entry") events = events.filter(event => !!input.entry && event.entries.includes(input.entry));
  else if (input.scope === "proof") events = events.filter(event => !!input.proof && event.proofs.some(proof => proof.replace(/^proof:/u, "") === input.proof!.replace(/^proof:/u, "")));
  else if (input.scope === "change") events = [];
  const paths = unique(events.flatMap(event => event.files).map(path).filter((value): value is string => !!value));
  if (paths.length) return { basis, relevance: "path-overlap", paths, causality: "not-inferred" };
  basis = (input.scope === "current" || input.scope === "handoff") && !events.some(event => event.files.length) ? "workspace-overview" : "unmapped-target";
  return { basis, relevance: "unknown", paths: [], causality: "not-inferred" };
}

/** Adds bounded historical metadata through an existing broker. Never opens storage or starts a worker. */
export async function buildAgentMemoryTraceContext(input: AgentMemoryTraceContextInput, overrides: Partial<TraceContextReaders> = {}): Promise<AgentMemoryTraceContext> {
  const readers: TraceContextReaders = { readConfiguration: readTraceOwnerConfiguration, request: requestExistingDeltaBroker, now: Date.now, ...overrides };
  const deadline = readers.now() + limits.timeBudgetMs;
  const result: AgentMemoryTraceContext = { schema: "forge.agent-memory-trace-context.v1", status: "unavailable", mode: "historical-context-only", authority: "none", approvalForNewTask: "not-evaluated", selection: selectedPaths(input), items: [], limits: { ...limits }, reads: { runsConsidered: 0, factsRead: 0, rpcCalls: 0, bytesUsed: 0, budgetExhausted: false }, gaps: [], truncated: false };
  const remaining = () => Math.max(0, deadline - readers.now());
  const gap = (value: string, truncated = false) => { if (!result.gaps.includes(value)) result.gaps.push(value); if (truncated) result.truncated = true; };
  const finish = () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const bytes = Buffer.byteLength(JSON.stringify(result));
      if (bytes === result.reads.bytesUsed) break;
      result.reads.bytesUsed = bytes;
    }
    return result;
  };
  try {
    const configuration = await readers.readConfiguration(input.workspaceRoot, { timeoutMs: Math.max(1, remaining()) });
    if (!configuration) { result.status = "disabled"; gap("trace-not-configured"); return finish(); }
    if (!remaining()) { result.reads.budgetExhausted = true; gap("trace-time-budget-exceeded", true); return finish(); }
    if (input.paths !== undefined && (!input.paths.length || input.paths.some(value => !path(value)))) { gap("invalid-explicit-trace-paths"); return finish(); }
    if (result.selection.basis === "unmapped-target") { gap("scope-mapping-unavailable"); return finish(); }
    if (result.selection.paths.length > limits.maxPaths) { result.selection.paths = result.selection.paths.slice(0, limits.maxPaths); gap("trace-path-limit-exceeded", true); }
    if (result.selection.basis === "workspace-overview") gap("task-relevance-unmapped");
    const rpc = async (method: string, args: unknown[]) => {
      if (!remaining() || result.reads.rpcCalls >= limits.maxRpcCalls) throw Object.assign(new Error("budget"), { code: "TRACE_CONTEXT_BUDGET" });
      result.reads.rpcCalls++; return readers.request(input.workspaceRoot, method, args, Math.max(1, remaining()));
    };
    const status = await rpc("traceStatus", []);
    if (!object(status) || typeof status.generationId !== "string" || !opaque(status.generationId) || !opaque(status.extractorVersion) || status.status !== "active" || !Array.isArray(status.cuts)) { gap("active-projection-unavailable"); return finish(); }
    result.projection = { generationId: status.generationId, extractorVersion: String(status.extractorVersion), status: "active" };
    let hadReadFailure = false;
    const cuts: Array<{ runKey: TraceRunKey; cut: AgentMemoryTraceContextItem["cut"] }> = [];
    if (status.cuts.length > 1024) { gap("projection-catalog-limit-exceeded", true); return finish(); }
    for (const raw of status.cuts) {
      if (!object(raw) || !object(raw.cut)) continue;
      let runKey: TraceRunKey; try { runKey = normalizeTraceRunKey(raw.runKey); } catch { continue; }
      if (!identityMatches(runKey, configuration)) continue;
      if (!Number.isSafeInteger(raw.cut.version) || Number(raw.cut.version) < 1 || !ref(raw.cut.journalRef) || !ref(raw.cut.stateRef)) { hadReadFailure = true; gap("projection-cut-invalid"); continue; }
      cuts.push({ runKey, cut: { version: Number(raw.cut.version), journalRef: raw.cut.journalRef, stateRef: raw.cut.stateRef } });
    }
    cuts.sort((a,b) => a.runKey.runId < b.runKey.runId ? -1 : a.runKey.runId > b.runKey.runId ? 1 : 0);
    if (!cuts.length) { gap("identity-matching-projection-unavailable"); return finish(); }
    if (cuts.length > limits.maxRuns) gap("trace-run-limit-exceeded", true);
    for (const pinned of cuts.slice(0, limits.maxRuns)) {
      if (!remaining() || result.reads.factsRead >= limits.maxFacts) { result.reads.budgetExhausted = true; gap(!remaining() ? "trace-time-budget-exceeded" : "trace-fact-limit-exceeded", true); break; }
      result.reads.runsConsidered++;
      const explanation = await rpc("traceExplain", [{ runKey: pinned.runKey, generationId: status.generationId, atVersion: pinned.cut.version, limit: limits.maxFacts - result.reads.factsRead }]);
      if (!object(explanation) || !object(explanation.projection) || !object(explanation.projection.sourceCut)) { hadReadFailure = true; gap("trace-run-unavailable"); continue; }
      let replyKey: TraceRunKey; try { replyKey = normalizeTraceRunKey(explanation.runKey); } catch { hadReadFailure = true; gap("trace-identity-mismatch"); continue; }
      const sourceCut = explanation.projection.sourceCut;
      if (!identityMatches(replyKey, configuration) || replyKey.runId !== pinned.runKey.runId || explanation.projection.generationId !== status.generationId || explanation.projection.extractorVersion !== status.extractorVersion || sourceCut.version !== pinned.cut.version || sourceCut.journalRef !== pinned.cut.journalRef || sourceCut.stateRef !== pinned.cut.stateRef) { hadReadFailure = true; gap("trace-cut-or-identity-mismatch"); continue; }
      if (!Array.isArray(explanation.sources) || !explanation.sources.length || explanation.sources.length > limits.maxFacts - result.reads.factsRead) { gap("trace-source-limit-exceeded", true); break; }
      result.reads.factsRead += explanation.sources.length;
      if (result.reads.factsRead === limits.maxFacts && cuts.slice(0, limits.maxRuns).length > result.reads.runsConsidered) gap("trace-fact-limit-exceeded", true);
      if (explanation.sources.some(source => !validSource(source, pinned.cut.version))) { hadReadFailure = true; gap("source-metadata-invalid"); continue; }
      if (!explanation.sources.some(source => object(source) && source.version === pinned.cut.version && source.journalRef === pinned.cut.journalRef && source.stateRef === pinned.cut.stateRef)) {
        if (explanation.truncated === true || explanation.projection.graphScope === "page") gap("pinned-cut-source-not-in-page", true);
        else { hadReadFailure = true; gap("source-metadata-invalid"); }
        continue;
      }
      const item = contextItem(explanation, pinned, status.generationId, result.selection.paths);
      if (!item) { if (explanation.truncated === true || explanation.projection.graphScope === "page") gap("target-relevance-unknown-in-partial-run", true); continue; }
      if (item.completeness === "partial") gap("trace-run-partial", true);
      // Source-list presentation is independent of the completeness of the queried graph.
      // Keep a source at the pinned cut first, then a bounded prefix; no entity-to-fact map is claimed.
      const reversedSources = [...item.sources].reverse();
      const cutSource = reversedSources.find(source => source.version === item.cut.version && source.factKind === "snapshot") ?? reversedSources.find(source => source.version === item.cut.version);
      if (cutSource) item.sources = [cutSource, ...item.sources.filter(source => source !== cutSource)];
      const fits = () => Buffer.byteLength(JSON.stringify({ ...result, items: [...result.items, item] })) <= limits.maxBytes - 512;
      while (!fits() && item.sources.length > 1) item.sources.pop();
      if (item.sources.length < item.sourcesTotal) {
        item.sourceScope = "run-source-subset"; item.sourceCompleteness = "partial";
        item.sourcesOmitted = item.sourcesTotal - item.sources.length;
        item.gaps.push("source-list-truncated"); gap("source-list-truncated", true);
        while (!fits() && item.sources.length > 1) { item.sources.pop(); item.sourcesOmitted++; }
      }
      if (!fits()) { gap("trace-byte-limit-exceeded", true); break; }
      result.items.push(item);
    }
    result.status = result.truncated ? "partial" : hadReadFailure ? (result.items.length ? "partial" : "unavailable") : result.items.length ? "available" : "no-relevant-history";
    return finish();
  } catch (error) {
    const code = object(error) ? error.code : undefined;
    if (!remaining() || code === "TRACE_CONTEXT_BUDGET" || code === "ABORT_ERR" || code === "TRACE_LIMIT_EXCEEDED") { result.reads.budgetExhausted = true; gap("trace-time-budget-exceeded", true); }
    else gap(code === "TRACE_IDENTITY_MISMATCH" ? "trace-identity-mismatch" : "trace-source-unavailable");
    result.status = result.items.length || result.truncated ? "partial" : "unavailable";
    return finish();
  }
}

function validSource(source: unknown, version: number): source is Record<string, unknown> {
  return object(source) && digest(source.sourceKey) && digest(source.digest) && Number.isSafeInteger(source.version) && Number(source.version) > 0 && Number(source.version) <= version && ref(source.journalRef) && ref(source.stateRef) && !!opaque(source.factKind) && !!opaque(source.factIdentity);
}

function contextItem(raw: Record<string, unknown>, pinned: { runKey: TraceRunKey; cut: AgentMemoryTraceContextItem["cut"] }, generationId: string, requestedPaths: string[]): AgentMemoryTraceContextItem | undefined {
  const entities = list(raw.entities).filter(object);
  const data = (entity: Record<string, unknown>) => object(entity.data) ? entity.data : {};
  const candidates = entities.filter(entity => entity.kind === "candidate" && opaque(data(entity).candidateId)).map(entity => ({ candidateId: String(data(entity).candidateId), ...(digest(data(entity).candidateDigest) ? { candidateDigest: String(data(entity).candidateDigest) } : {}), paths: unique(strings(data(entity).paths).map(path).filter((value): value is string => !!value)) })).filter(candidate => !requestedPaths.length || requestedPaths.some(path => candidate.paths.includes(path)));
  if (requestedPaths.length && !candidates.length) return;
  const digests = new Set(candidates.map(candidate => candidate.candidateDigest));
  const partial = raw.truncated === true || (object(raw.projection) && (raw.projection.graphScope === "page" || raw.projection.status === "partial" || raw.projection.status === "conflict"));
  const matchesGitEvidence = (evidence: Record<string, unknown>) => !requestedPaths.length || (digests.has(String(evidence.candidateDigest)) && requestedPaths.some(file => strings(evidence.paths).some(scope => file === scope || file.startsWith(`${scope}/`))));
  const git = (object(raw.git) ? list(raw.git.evidence) : []).filter(object).filter(matchesGitEvidence).map(evidence => ({ ...(ref(evidence.annotationRef) ? { annotationRef: evidence.annotationRef } : {}), ...(digest(evidence.candidateDigest) ? { candidateDigest: evidence.candidateDigest } : {}), ...(typeof evidence.commitOid === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(evidence.commitOid) ? { commitOid: evidence.commitOid } : {}), observation: ["observed", "not-observed", "unknown"].includes(String(evidence.observation)) ? String(evidence.observation) : "unknown", contentMatch: ["matches", "differs", "unverifiable", "unsupported", "not-evaluated"].includes(String(evidence.contentMatch)) ? String(evidence.contentMatch) : "not-evaluated", paths: unique(strings(evidence.paths).map(path).filter((value): value is string => !!value)), superseded: evidence.superseded === true }));
  const refs = new Set(git.flatMap(evidence => evidence.annotationRef ? [evidence.annotationRef] : []));
  // Old generations may carry the annotation link only as an explicit records edge.
  const selectedGitIds = new Set(entities.filter(entity => (entity.kind === "git-observation" || entity.kind === "commit") && matchesGitEvidence(data(entity))).map(entity => String(entity.id)));
  for (const occurrence of list(raw.relations).filter(object)) {
    const edge = object(occurrence.relation) ? occurrence.relation : undefined;
    if (!edge || edge.predicate !== "records" || !selectedGitIds.has(String(edge.to))) continue;
    const annotation = entities.find(entity => entity.id === edge.from);
    if (annotation && ref(data(annotation).annotationRef)) refs.add(String(data(annotation).annotationRef));
  }
  const correctionInputs = list(raw.corrections).filter(object);
  let expanded = true;
  while (expanded) { expanded = false; for (const correction of correctionInputs) if ((!requestedPaths.length || refs.has(String(correction.supersedesRef))) && ref(correction.annotationRef) && !refs.has(correction.annotationRef)) { refs.add(correction.annotationRef); expanded = true; } }
  const corrections = correctionInputs.filter(correction => ref(correction.annotationRef) && ref(correction.supersedesRef) && (!requestedPaths.length || refs.has(correction.annotationRef))).map(correction => ({ annotationRef: String(correction.annotationRef), supersedesRef: String(correction.supersedesRef), ...(summary(correction.reason) ? { reason: summary(correction.reason) } : {}), replacement: { ...(object(correction.replacement) && summary(correction.replacement.summary) ? { summary: summary(correction.replacement.summary) } : {}), ...(object(correction.replacement) && opaque(correction.replacement.producer) ? { producer: String(correction.replacement.producer) } : {}) }, superseded: correction.superseded === true, authority: "none" as const }));
  const sources = list(raw.sources).filter(object).filter(source => digest(source.sourceKey) && digest(source.digest) && Number.isSafeInteger(source.version) && Number(source.version) > 0 && Number(source.version) <= pinned.cut.version && ref(source.journalRef) && ref(source.stateRef) && opaque(source.factKind) && opaque(source.factIdentity)).map(source => ({ sourceKey: String(source.sourceKey), digest: String(source.digest), version: Number(source.version), journalRef: String(source.journalRef), stateRef: String(source.stateRef), factKind: String(source.factKind), factIdentity: String(source.factIdentity) }));
  const evidence: AgentMemoryTraceContextItem["evidence"] = entities.filter(entity => ["assessment", "check", "gate", "apply"].includes(String(entity.kind)) && (!requestedPaths.length || digests.has(String(data(entity).candidateDigest)))).filter(entity => opaque(entity.id)).map(entity => {
    const value = data(entity);
    const validity = value.superseded === true ? "superseded" : partial ? "unknown" : value.validity === "owner-gated-at-cut" && value.current === true ? "owner-gated-at-cut" : value.validity === "historical-or-unverified" ? "historical-or-unverified" : "unknown";
    return { id: String(entity.id), kind: String(entity.kind), validity, ...(opaque(value.result) ? { result: String(value.result) } : {}), refs: unique([value.gateRef, value.receiptRef, value.artifactRef, value.environmentRef, value.contractDigest, value.inputDigest, value.semanticDigest].filter(ref)), ...(Array.isArray(value.supersededBy) ? { supersededBy: strings(value.supersededBy).filter(ref) } : {}) };
  });
  const latestGit = git.filter(evidence => !evidence.superseded).at(-1);
  const gitObservation = partial ? "unknown" : latestGit?.observation === "observed" ? (latestGit.commitOid ? "observed" : "unknown") : latestGit?.observation ?? (git.some(evidence => evidence.superseded) ? "unknown" : "not-observed");
  const gitContentMatch = partial || (latestGit?.observation === "observed" && !latestGit.commitOid) ? "not-evaluated" : latestGit?.contentMatch ?? "not-evaluated";
  const originRefs = entities.filter(entity => entity.kind === "origin").map(entity => data(entity).originRef).filter(ref);
  return { runKey: pinned.runKey, cut: pinned.cut, generationId, selection: { basis: requestedPaths.length ? "path-overlap" : "workspace-overview", relevance: requestedPaths.length ? "path-overlap" : "unknown", paths: unique(candidates.flatMap(candidate => candidate.paths).filter(path => requestedPaths.includes(path))) }, completeness: partial ? "partial" : "complete-at-cut", authority: "none", approvalForNewTask: "not-evaluated", sourceAvailability: "primary-source-unverified", sourceScope: "run-source-set", sourceCompleteness: "complete", sourcesTotal: sources.length, sourcesOmitted: 0, execution: { observedStatus: object(raw.execution) ? opaque(raw.execution.observedStatus) ?? "unknown" : "unknown" }, origin: { status: originRefs.length ? "declared" : partial ? "unknown" : "origin-unavailable", refs: unique(originRefs) }, candidates, evidence, git: { observation: gitObservation, contentMatch: gitContentMatch, evidence: git }, corrections, sources, gaps: unique([...strings(raw.gaps).map(opaque).filter((value): value is string => !!value), ...(sources.length !== list(raw.sources).length ? ["source-metadata-invalid"] : []), ...(partial ? ["historical-validity-unknown-in-partial-run"] : [])]) };
}
