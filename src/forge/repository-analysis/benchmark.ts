import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { validateRepositorySnapshotData } from "./context.ts";
import { selectRepositoryChecks, type SuggestedRepositoryCheck } from "./check-selection.ts";
import { validateRepositoryQualityCases, type RepositoryQualityCase } from "./quality.ts";
import { selectRepositoryContext } from "./retrieval.ts";
import type { RepositorySnapshot } from "./types.ts";
import { REPOSITORY_CHECK_CATEGORIES, REPOSITORY_CHECK_COSTS } from "../repository-manifest/types.ts";

export interface RepositoryBenchmarkModel {
  provider: string;
  name: string;
  /** Explicit settings, shared by both arms. Never inferred from a local SDK. */
  settings: Record<string, string | number | boolean | null>;
}
export interface RepositoryBenchmarkBinding {
  root: string;
  snapshotId: string;
  inputDigest: string;
  manifestHash: string;
  scenarioHash: string;
}
export interface RepositoryBenchmarkRun {
  runId: string;
  caseId: string;
  repetition: number;
  arm: "without-maps" | "with-maps";
  taskDigest: string;
  executionDigest: string;
  workerInput: {
    prompt: string;
    scope: string[];
    checks: SuggestedRepositoryCheck[];
    model: RepositoryBenchmarkModel;
    repositoryContext?: ReturnType<typeof selectRepositoryContext>;
  };
}
export interface RepositoryAgentBenchmarkPlan {
  kind: "repository-agent-benchmark-plan";
  version: 1;
  planId: string;
  binding: RepositoryBenchmarkBinding;
  model: RepositoryBenchmarkModel;
  repetitions: number;
  cases: RepositoryQualityCase[];
  runs: RepositoryBenchmarkRun[];
  execution: "not-executed";
  authorization: "external-runner-required";
  comparison: "maps-only";
}
export interface RepositoryBenchmarkObservation {
  planId: string;
  runId: string;
  binding: RepositoryBenchmarkBinding;
  taskDigest: string;
  executionDigest: string;
  /** Actual model/settings reported by the runner, not merely the planned digest. */
  model: RepositoryBenchmarkModel;
  workerId: string;
  status: "completed" | "failed" | "cancelled";
  /** Digest of the actual diff/result artifact, including an empty diff when applicable. */
  artifactDigest?: string;
  artifactEvidenceRef?: string;
  metrics?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    latencyMs?: number;
    /** Actual read events; repeated reads remain separate observations. */
    sourceReads?: Array<{ path: string; chars?: number; evidenceRef: string }>;
    evidenceRefs: string[];
    provenance: "executor-observed";
  };
  checks?: Array<{ id: string; status: "passed" | "failed" | "not-run" | "unknown"; evidenceRef?: string }>;
  review?: {
    reviewerId: string;
    artifactDigest: string;
    outcome: "accepted" | "changes-requested" | "inconclusive";
    evidenceRef: string;
  };
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, maximum = 4096): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const relativePath = (value: unknown): value is string => text(value) && !/^[\\/]|[:\\]/.test(value) && !value.split("/").includes("..");
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function digest(value: unknown): string { return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`; }
function only(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every(key => keys.includes(key)); }
function boundedJson(value: unknown, maximum = 128 * 1024 * 1024): boolean {
  const queue = [{ value, depth: 0 }]; let visited = 0, chars = 0;
  while (queue.length) {
    const item = queue.pop()!;
    if (++visited > 5_000_000 || item.depth > 32) return false;
    if (item.value && typeof item.value === "object") {
      const entries = Object.entries(item.value);
      chars += entries.length * 4 + 2;
      for (const [key, child] of entries) { chars += key.length; queue.push({ value: child, depth: item.depth + 1 }); }
    } else if (typeof item.value === "string") chars += JSON.stringify(item.value).length;
    else if (typeof item.value === "number" && !Number.isFinite(item.value) || ["bigint", "function", "symbol"].includes(typeof item.value)) return false;
    if (chars > maximum) return false;
  }
  return true;
}
const list = (value: unknown, maximum: number, validator: (item: unknown) => boolean, unique = true): boolean => Array.isArray(value)
  && value.length <= maximum && (!unique || new Set(value).size === value.length) && value.every(validator);
function validCases(value: unknown): value is RepositoryQualityCase[] {
  try { validateRepositoryQualityCases(value); return true; } catch { return false; }
}
const identifier = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value);
function validChecks(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 1000 && new Set(value.map(check => check?.id)).size === value.length && value.every(check => object(check)
    && only(check, ["id", "component", "argv", "cwd", "category", "cost", "requires", "reasons", "requirements", "execution"])
    && identifier(check.id) && identifier(check.component) && Array.isArray(check.argv) && check.argv.length > 0
    && list(check.argv, 1000, value => typeof value === "string" && value.length > 0 && value.length <= 4096, false)
    && relativePath(check.cwd) && (check.category === undefined || (REPOSITORY_CHECK_CATEGORIES as readonly unknown[]).includes(check.category))
    && (check.cost === undefined || (REPOSITORY_CHECK_COSTS as readonly unknown[]).includes(check.cost))
    && list(check.requires, 32, identifier) && list(check.reasons, 1000, value => text(value)) && check.execution === "not-executed"
    && object(check.requirements) && only(check.requirements, ["status", "missing"]) && ["unknown", "satisfied", "missing"].includes(check.requirements.status as string)
    && list(check.requirements.missing, 32, value => identifier(value) && (check.requires as string[]).includes(value as string)));
}
function validPacket(value: unknown, binding: RepositoryBenchmarkBinding, scope: string[]): boolean {
  if (!object(value) || !only(value, ["provider", "snapshotId", "writeScope", "writeScopeOmitted", "queryTerms", "limitations", "nodes", "edges", "groups", "metrics", "truncated"])
    || value.provider !== "repository" || value.snapshotId !== binding.snapshotId || typeof value.truncated !== "boolean"
    || value.writeScopeOmitted !== undefined && value.writeScopeOmitted !== true || !list(value.writeScope, 200, relativePath)
    || digest(value.writeScope) !== digest(value.writeScopeOmitted ? [] : scope)
    || !list(value.queryTerms, 80, value => text(value, 512)) || !list(value.limitations, 5, value => typeof value === "string" && value.length <= 256, false)
    || !Array.isArray(value.nodes) || value.nodes.length > 30 || !Array.isArray(value.edges) || value.edges.length > 30
    || !Array.isArray(value.groups) || value.groups.length > 4 || !object(value.metrics) || JSON.stringify(value).length > 50000) return false;
  const metricKeys = ["candidates", "selected", "readOnlyExpansion", "unresolvedCandidates", "javaCallSitesOmitted", "unsupportedFiles", "analysisErrors", "omittedRelations"];
  const metrics = value.metrics;
  if (!only(metrics, metricKeys) || !metricKeys.every(key => integer(metrics[key])) || metrics.selected !== value.nodes.length) return false;
  const ids = new Set<string>();
  const evidence = (item: unknown) => object(item) && only(item, ["assurance", "resolution", "adapter", "version", "sourceHash"])
    && ["declared", "syntactic", "resolved", "inferred"].includes(item.assurance as string) && ["complete", "partial", "unresolved"].includes(item.resolution as string)
    && text(item.adapter, 80) && text(item.version, 80) && (item.sourceHash === undefined || typeof item.sourceHash === "string" && /^[a-f0-9]{64}$/.test(item.sourceHash));
  for (const node of value.nodes) {
    if (!object(node) || !only(node, ["id", "kind", "name", "file", "component", "location", "evidence", "metadata", "access", "selectionReasons"])
      || !text(node.id, 256) || ids.has(node.id) || !text(node.kind, 80) || typeof node.name !== "string" || node.name.length > 256 || !text(node.component, 80)
      || node.file !== undefined && !relativePath(node.file) || !evidence(node.evidence) || !object(node.metadata)
      || !["read-only", "write-scope"].includes(node.access as string) || !list(node.selectionReasons, 100, value => text(value))) return false;
    ids.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of value.edges) {
    if (!object(edge) || !only(edge, ["id", "from", "to", "kind", "evidence", "metadata"]) || !text(edge.id, 256) || edgeIds.has(edge.id)
      || !ids.has(edge.from as string) || !ids.has(edge.to as string) || !text(edge.kind, 80) || !evidence(edge.evidence) || !object(edge.metadata)) return false;
    edgeIds.add(edge.id);
  }
  return value.metrics.readOnlyExpansion === value.nodes.filter(node => node.access === "read-only").length && value.groups.every(group => object(group)
    && only(group, ["subject", "consumers", "tests", "related"]) && ids.has(group.subject as string)
    && ["consumers", "tests", "related"].every(key => list(group[key], 30, value => ids.has(value as string))));
}
function validModel(value: unknown): value is RepositoryBenchmarkModel {
  return object(value) && only(value, ["provider", "name", "settings"]) && text(value.provider, 128) && text(value.name, 256)
    && object(value.settings) && Object.keys(value.settings).length <= 50 && Object.entries(value.settings).every(([key, setting]) =>
      /^[a-zA-Z][\w.-]{0,79}$/.test(key) && !/(?:apiKey|accessToken|refreshToken|authToken|password|clientSecret|privateKey|secret|credentials?|authorization|cookies?|^token)$/i.test(key.replace(/[_.-]/g, ""))
      && (setting === null || typeof setting === "boolean" || typeof setting === "number" && Number.isFinite(setting)
        || typeof setting === "string" && setting.length <= 512 && !/[\u0000-\u001f]/.test(setting)));
}

/** Pure source binding, for callers that already validated snapshot integrity and freshness. */
export function repositoryAgentBenchmarkBinding(snapshot: RepositorySnapshot): RepositoryBenchmarkBinding {
  return { root: snapshot.root, snapshotId: snapshot.snapshotId, inputDigest: digest(snapshot.files), manifestHash: snapshot.manifestHash, scenarioHash: snapshot.scenarioHash };
}

/** Pure planning: validate data, bind inputs, and describe two arms. Does not read sources or run a model/check. */
export function createRepositoryAgentBenchmarkPlan(snapshot: RepositorySnapshot, cases: RepositoryQualityCase[], options: {
  model: RepositoryBenchmarkModel; repetitions?: number; maxChars?: number;
}): RepositoryAgentBenchmarkPlan {
  if (validateRepositorySnapshotData(snapshot).length) throw new Error("Invalid repository benchmark snapshot");
  if (!object(options) || !only(options, ["model", "repetitions", "maxChars"]) || !validModel(options.model)
    || options.repetitions !== undefined && (!integer(options.repetitions) || options.repetitions < 1 || options.repetitions > 10)
    || options.maxChars !== undefined && (!integer(options.maxChars) || options.maxChars < 2000 || options.maxChars > 50000)) throw new Error("Invalid repository benchmark options");
  // Reuse the strict reviewed-case contract. Static fixture success is not a prerequisite:
  // failed retrieval cases must remain in the model experiment, rather than disappear.
  validateRepositoryQualityCases(cases);
  const model = structuredClone(options.model), reviewedCases = structuredClone(cases), repetitions = options.repetitions ?? 1;
  const binding = repositoryAgentBenchmarkBinding(snapshot);
  const runs: RepositoryBenchmarkRun[] = [];
  for (const item of reviewedCases) {
    const scope = item.scope ?? ["."];
    const checks = selectRepositoryChecks(snapshot, { scope }).checks;
    const common = { prompt: item.query, scope: [...scope], checks, model };
    const taskDigest = digest({ case: item, common });
    const packet = selectRepositoryContext(snapshot, item.query, { writeScope: item.scope, maxChars: options.maxChars ?? 12000 });
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      // Counterbalance order across repetitions; always use fresh isolated sessions.
      const arms: RepositoryBenchmarkRun["arm"][] = repetition % 2 ? ["without-maps", "with-maps"] : ["with-maps", "without-maps"];
      for (const arm of arms) {
        const workerInput = structuredClone(arm === "with-maps" ? { ...common, repositoryContext: packet } : common);
        const executionDigest = digest({ binding, taskDigest, workerInput });
        runs.push({ runId: digest({ binding, taskDigest, arm, repetition }), caseId: item.id, repetition, arm, taskDigest, executionDigest, workerInput });
      }
    }
  }
  const body = { kind: "repository-agent-benchmark-plan" as const, version: 1 as const, binding, model, repetitions, cases: reviewedCases, runs,
    execution: "not-executed" as const, authorization: "external-runner-required" as const, comparison: "maps-only" as const };
  if (!boundedJson(body) || JSON.stringify(body).length > 128 * 1024 * 1024) throw new Error("Repository benchmark plan exceeds bounds");
  return { ...body, planId: digest(body) };
}

function validPlan(plan: RepositoryAgentBenchmarkPlan): boolean {
  if (!object(plan) || !boundedJson(plan) || !only(plan, ["kind", "version", "planId", "binding", "model", "repetitions", "cases", "runs", "execution", "authorization", "comparison"])
    || plan.kind !== "repository-agent-benchmark-plan" || plan.version !== 1 || plan.execution !== "not-executed" || plan.authorization !== "external-runner-required"
    || plan.comparison !== "maps-only" || !hash(plan.planId) || !validModel(plan.model) || !integer(plan.repetitions) || plan.repetitions < 1 || plan.repetitions > 10
    || !object(plan.binding) || !only(plan.binding, ["root", "snapshotId", "inputDigest", "manifestHash", "scenarioHash"])
    || !text(plan.binding.root, 32768) || !isAbsolute(plan.binding.root) || !/^repo:[a-f0-9]{64}$/.test(plan.binding.snapshotId) || !hash(plan.binding.inputDigest)
    || !/^[a-f0-9]{64}$/.test(plan.binding.manifestHash) || !/^[a-f0-9]{64}$/.test(plan.binding.scenarioHash)
    || !validCases(plan.cases) || !Array.isArray(plan.runs) || !plan.runs.every(object) || plan.runs.length !== plan.cases.length * plan.repetitions * 2) return false;
  const { planId, ...body } = plan;
  if (digest(body) !== planId) return false;
  const runIds = new Set<string>();
  for (const item of plan.cases) {
    if (!object(item) || !text(item.id, 128) || !text(item.query, 4000)) return false;
    const expected = plan.runs.filter(run => run.caseId === item.id);
    if (expected.length !== plan.repetitions * 2) return false;
    for (let repetition = 1; repetition <= plan.repetitions; repetition++) {
      const pair = expected.filter(run => run.repetition === repetition);
      if (pair.length !== 2 || new Set(pair.map(run => run.arm)).size !== 2) return false;
      for (const run of pair) {
        if (!object(run) || !only(run, ["runId", "caseId", "repetition", "arm", "taskDigest", "executionDigest", "workerInput"])
          || !["without-maps", "with-maps"].includes(run.arm) || !object(run.workerInput)
          || !only(run.workerInput, ["prompt", "scope", "checks", "model", "repositoryContext"]) || !hash(run.runId)
          || runIds.has(run.runId) || !validModel(run.workerInput.model) || digest(run.workerInput.model) !== digest(plan.model)
          || !list(run.workerInput.scope, 200, relativePath) || !validChecks(run.workerInput.checks)) return false;
        runIds.add(run.runId);
        const { repositoryContext, ...common } = run.workerInput;
        if (run.workerInput.prompt !== item.query || digest(run.workerInput.scope) !== digest(item.scope ?? ["."])
          || run.taskDigest !== digest({ case: item, common }) || run.executionDigest !== digest({ binding: plan.binding, taskDigest: run.taskDigest, workerInput: run.workerInput })
          || run.runId !== digest({ binding: plan.binding, taskDigest: run.taskDigest, arm: run.arm, repetition: run.repetition })
          || run.arm === "without-maps" && repositoryContext !== undefined
          || run.arm === "with-maps" && !validPacket(repositoryContext, plan.binding, item.scope ?? [])) return false;
      }
      const common = (run: RepositoryBenchmarkRun) => { const { repositoryContext: _packet, ...value } = run.workerInput; return value; };
      if (digest(common(pair[0]!)) !== digest(common(pair[1]!))) return false;
    }
  }
  return runIds.size === plan.runs.length;
}

function validateObservation(value: RepositoryBenchmarkObservation, plan: RepositoryAgentBenchmarkPlan, run: RepositoryBenchmarkRun): boolean {
  if (!object(value) || !only(value, ["planId", "runId", "binding", "taskDigest", "executionDigest", "model", "workerId", "status", "artifactDigest", "artifactEvidenceRef", "metrics", "checks", "review"])
    || value.planId !== plan.planId || value.runId !== run.runId || !object(value.binding) || digest(value.binding) !== digest(plan.binding)
    || value.taskDigest !== run.taskDigest || value.executionDigest !== run.executionDigest || !validModel(value.model) || digest(value.model) !== digest(plan.model) || !text(value.workerId, 256)
    || !["completed", "failed", "cancelled"].includes(value.status)
    || value.artifactDigest !== undefined && !hash(value.artifactDigest) || value.artifactEvidenceRef !== undefined && !text(value.artifactEvidenceRef)
    || (value.artifactDigest === undefined) !== (value.artifactEvidenceRef === undefined)) return false;
  if (value.metrics !== undefined) {
    const metrics = value.metrics;
    if (!object(metrics) || !only(metrics, ["inputTokens", "outputTokens", "cachedInputTokens", "latencyMs", "sourceReads", "evidenceRefs", "provenance"])
      || metrics.provenance !== "executor-observed" || !Array.isArray(metrics.evidenceRefs) || !metrics.evidenceRefs.length || metrics.evidenceRefs.length > 200
      || !metrics.evidenceRefs.every(ref => text(ref))
      || (["inputTokens", "outputTokens", "cachedInputTokens"] as const).some(key => metrics[key] !== undefined && !integer(metrics[key]))
      || metrics.latencyMs !== undefined && (typeof metrics.latencyMs !== "number" || !Number.isFinite(metrics.latencyMs) || metrics.latencyMs < 0 || metrics.latencyMs > Number.MAX_SAFE_INTEGER)
      || metrics.cachedInputTokens !== undefined && metrics.inputTokens !== undefined && metrics.cachedInputTokens > metrics.inputTokens) return false;
    if (metrics.sourceReads !== undefined && (!Array.isArray(metrics.sourceReads) || metrics.sourceReads.length > 20000 || metrics.sourceReads.some(read =>
      !object(read) || !only(read, ["path", "chars", "evidenceRef"]) || !relativePath(read.path) || !text(read.evidenceRef)
      || read.chars !== undefined && !integer(read.chars)))) return false;
    if (metrics.sourceReads && !Number.isSafeInteger(metrics.sourceReads.reduce((total, read) => total + (read.chars ?? 0), 0))) return false;
  }
  if (value.checks !== undefined && (!Array.isArray(value.checks) || value.checks.length > run.workerInput.checks.length || new Set(value.checks.map(check => check?.id)).size !== value.checks.length
    || value.checks.some(check => !object(check) || !only(check, ["id", "status", "evidenceRef"]) || !run.workerInput.checks.some(expected => expected.id === check.id)
      || !["passed", "failed", "not-run", "unknown"].includes(check.status) || check.evidenceRef !== undefined && !text(check.evidenceRef)
      || ["passed", "failed"].includes(check.status) && !text(check.evidenceRef)))) return false;
  if (value.review !== undefined) {
    const review = value.review;
    if (!object(review) || !only(review, ["reviewerId", "artifactDigest", "outcome", "evidenceRef"]) || !text(review.reviewerId, 256)
      || review.reviewerId === value.workerId || review.artifactDigest !== value.artifactDigest || !hash(review.artifactDigest)
      || !["accepted", "changes-requested", "inconclusive"].includes(review.outcome) || !text(review.evidenceRef)) return false;
  }
  return true;
}

const METRICS = ["inputTokens", "outputTokens", "cachedInputTokens", "latencyMs", "sourceReadEvents", "uniqueSourceFiles", "sourceChars"] as const;
function observedMetrics(observation: RepositoryBenchmarkObservation | undefined): Record<typeof METRICS[number], number | null> {
  const metrics = observation?.metrics, reads = metrics?.sourceReads;
  return { inputTokens: metrics?.inputTokens ?? null, outputTokens: metrics?.outputTokens ?? null,
    cachedInputTokens: metrics?.cachedInputTokens ?? null, latencyMs: metrics?.latencyMs ?? null,
    sourceReadEvents: reads?.length ?? null, uniqueSourceFiles: reads ? new Set(reads.map(read => read.path)).size : null,
    sourceChars: reads && reads.every(read => read.chars !== undefined) ? reads.reduce((total, read) => total + read.chars!, 0) : null };
}

/** Evaluate supplied evidence only. References and identities are runner assertions, not authenticated executions. */
export function evaluateRepositoryAgentBenchmark(plan: RepositoryAgentBenchmarkPlan, observations: RepositoryBenchmarkObservation[]) {
  if (!validPlan(plan)) throw new Error("Invalid repository agent benchmark plan");
  if (!Array.isArray(observations) || !boundedJson(observations, 16 * 1024 * 1024) || observations.length > plan.runs.length) throw new Error("Invalid repository agent benchmark observations");
  const byId = new Map<string, RepositoryBenchmarkObservation>();
  for (const observation of observations) {
    const run = plan.runs.find(item => item.runId === observation?.runId);
    if (!run || byId.has(run.runId) || !validateObservation(observation, plan, run)) throw new Error("Invalid or incomparable repository agent benchmark observation");
    byId.set(run.runId, observation);
  }
  const workers = new Set(observations.map(observation => observation.workerId));
  if (workers.size !== observations.length) throw new Error("Benchmark runs require distinct isolated worker sessions");
  if (observations.some(observation => observation.review && workers.has(observation.review.reviewerId))) throw new Error("Benchmark reviewers must be independent of all worker sessions");
  const results = plan.runs.map(run => {
    const observation = byId.get(run.runId);
    const checks = run.workerInput.checks.map(check => ({ id: check.id, status: observation?.checks?.find(item => item.id === check.id)?.status ?? "unknown" }));
    return { runId: run.runId, caseId: run.caseId, repetition: run.repetition, arm: run.arm,
      status: observation?.status ?? "unknown", review: observation?.review?.outcome ?? "unknown", checks,
      artifactObserved: !!observation?.artifactDigest, metrics: observedMetrics(observation),
      evidence: observation ? structuredClone({ workerId: observation.workerId, model: observation.model, artifactDigest: observation.artifactDigest,
        artifactEvidenceRef: observation.artifactEvidenceRef, metrics: observation.metrics, checks: observation.checks, review: observation.review }) : null };
  });
  const pairs = plan.cases.flatMap(item => Array.from({ length: plan.repetitions }, (_, index) => {
    const repetition = index + 1;
    const without = results.find(run => run.caseId === item.id && run.repetition === repetition && run.arm === "without-maps")!;
    const withMaps = results.find(run => run.caseId === item.id && run.repetition === repetition && run.arm === "with-maps")!;
    const completed = without.status === "completed" && withMaps.status === "completed";
    const accepted = without.review === "accepted" && withMaps.review === "accepted" && without.artifactObserved && withMaps.artifactObserved;
    const checksPassed = [...without.checks, ...withMaps.checks].every(check => check.status === "passed");
    const comparable = completed && accepted && checksPassed;
    const delta = Object.fromEntries(METRICS.map(metric => [metric, comparable && without.metrics[metric] !== null && withMaps.metrics[metric] !== null
      ? withMaps.metrics[metric]! - without.metrics[metric]! : null])) as Record<typeof METRICS[number], number | null>;
    return { caseId: item.id, repetition, comparable,
      status: without.status === "unknown" || withMaps.status === "unknown" ? "pending" : !completed ? "execution-incomplete"
        : !accepted ? "review-required" : !checksPassed ? "checks-required" : "comparable",
      withoutMapsRunId: without.runId, withMapsRunId: withMaps.runId, deltaWithMinusWithout: delta };
  }));
  const metrics = Object.fromEntries(METRICS.map(metric => {
    const observed = pairs.flatMap(pair => pair.deltaWithMinusWithout[metric] === null ? [] : [pair.deltaWithMinusWithout[metric]!]);
    return [metric, { observedPairs: observed.length, meanDeltaWithMinusWithout: observed.length ? observed.reduce((a, b) => a + b, 0) / observed.length : null }];
  }));
  return { kind: "repository-agent-benchmark-report" as const, version: 1 as const, planId: plan.planId, binding: plan.binding,
    evidence: "external-runner-reported" as const, execution: "not-executed-by-evaluator" as const, identitiesAuthenticated: false,
    metrics, comparablePairs: pairs.filter(pair => pair.comparable).length, totalPairs: pairs.length, results, pairs,
    limitations: ["Missing evidence is unknown, never zero.", "Metrics require both arms to complete, pass declared application checks and receive independent artifact review.",
      "Evidence references and worker identities require external verification; this evaluator does not run or authenticate a model.",
      "Metric differences describe these tasks and settings; they do not establish general model productivity."] };
}
