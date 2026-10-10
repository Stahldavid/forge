import { programAssert, programDigest, programValueBytes } from "./program-contract.ts";

export interface ProgramBenchmarkObservation {
  taskId: string; runtimeVersion: string; model: string; toolsDigest: string; contextDigest: string; contractDigest: string;
  category: "runtime" | "coding"; budget: string;
  timingMs: Partial<Record<"queue" | "preparation" | "execution" | "capture" | "persistence" | "integration", number>>;
  inputTokens?: number; outputTokens?: number; usageStatus: "observed" | "estimated" | "unknown";
  externalEvaluation?: { assessor: string; criteriaDigest: string; independent: boolean; success: boolean; escapedDefects: number; unnecessaryChanges: number };
  humanInterventions: number; repeatedActivities: number; retainedBytes?: number;
}
export interface ProgramBenchmarkReport { schemaVersion: 1; benchmarkId: string; observations: ProgramBenchmarkObservation[]; limitations: string[] }

/** Data validation only: producing a report never executes a model or workflow. */
export function validateBenchmarkReport(report: ProgramBenchmarkReport): void {
  programValueBytes(report, 4 * 1024 * 1024);
  programAssert(report?.schemaVersion === 1 && typeof report.benchmarkId === "string" && report.benchmarkId.length > 0, "Benchmark identity required");
  programAssert(Array.isArray(report.observations) && report.observations.length > 0 && Array.isArray(report.limitations) && report.limitations.every(value => typeof value === "string"), "Benchmark observations and limitations required");
  const identities = new Set<string>();
  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
  for (const entry of report.observations) {
    programAssert(entry && typeof entry === "object", "Benchmark observation required");
    for (const key of ["taskId", "runtimeVersion", "model", "toolsDigest", "contextDigest", "contractDigest", "budget"] as const) programAssert(typeof entry[key] === "string" && entry[key].length > 0, `Benchmark ${key} required`);
    programAssert(!identities.has(entry.taskId), "Duplicate benchmark task identity"); identities.add(entry.taskId);
    programAssert(["runtime", "coding"].includes(entry.category) && ["observed", "estimated", "unknown"].includes(entry.usageStatus), "Invalid benchmark category or usage status");
    programAssert(entry.timingMs && typeof entry.timingMs === "object" && !Array.isArray(entry.timingMs), "Timing observations required");
    for (const [key, value] of Object.entries(entry.timingMs)) programAssert(["queue", "preparation", "execution", "capture", "persistence", "integration"].includes(key) && typeof value === "number" && Number.isFinite(value) && value >= 0, "Invalid timing observation");
    for (const value of [entry.humanInterventions, entry.repeatedActivities]) programAssert(count(value), "Invalid benchmark counter");
    for (const value of [entry.inputTokens, entry.outputTokens, entry.retainedBytes]) if (value !== undefined) programAssert(count(value), "Invalid optional benchmark counter");
    if (entry.usageStatus === "unknown") programAssert(entry.inputTokens === undefined && entry.outputTokens === undefined, "Unknown consumption cannot be represented as measured tokens");
    else programAssert(entry.inputTokens !== undefined && entry.outputTokens !== undefined, "Observed or estimated consumption requires both token counters");
    if (entry.externalEvaluation) {
      const assessment = entry.externalEvaluation;
      programAssert(typeof assessment.assessor === "string" && assessment.assessor.length > 0 && typeof assessment.criteriaDigest === "string" && assessment.criteriaDigest.length > 0, "External assessment provenance required");
      programAssert(typeof assessment.independent === "boolean" && typeof assessment.success === "boolean" && count(assessment.escapedDefects) && count(assessment.unnecessaryChanges), "Invalid external assessment");
    }
  }
}
/** Pair by task identity, never by array position; unmatched/confounded trials fail eligibility. */
export function compareBenchmarkReports(left: ProgramBenchmarkReport, right: ProgramBenchmarkReport) {
  validateBenchmarkReport(left); validateBenchmarkReport(right);
  programAssert(left.benchmarkId !== right.benchmarkId, "Paired reports require distinct benchmark identities");
  const leftById = new Map(left.observations.map(entry => [entry.taskId, entry]));
  const rightById = new Map(right.observations.map(entry => [entry.taskId, entry]));
  const differences: { taskId: string; fields: string[] }[] = [];
  const unmatchedTasks = [...new Set([...leftById.keys(), ...rightById.keys()])].filter(id => !leftById.has(id) || !rightById.has(id)).sort();
  const pairs = left.observations.filter(entry => rightById.has(entry.taskId)).map(entry => {
    const counterpart = rightById.get(entry.taskId)!;
    const fields: string[] = (["category", "model", "toolsDigest", "contextDigest", "contractDigest", "budget"] as const).filter(key => entry[key] !== counterpart[key]);
    if (entry.externalEvaluation?.criteriaDigest !== counterpart.externalEvaluation?.criteriaDigest) fields.push("criteriaDigest");
    if (fields.length) differences.push({ taskId: entry.taskId, fields: [...new Set(fields)] });
    return { taskId: entry.taskId, leftVersion: entry.runtimeVersion, rightVersion: counterpart.runtimeVersion };
  });
  const leftSummary = summarizeBenchmarkReport(left), rightSummary = summarizeBenchmarkReport(right);
  const metrics = (report: ProgramBenchmarkReport) => {
    const sum = (values: number[], integral = false) => { const total = values.reduce((total, value) => total + value, 0); programAssert(Number.isFinite(total) && (!integral || Number.isSafeInteger(total)), "Benchmark aggregate exceeds numeric limits"); return total; };
    const verified = report.observations.filter(entry => entry.category === "coding" && entry.externalEvaluation?.independent && entry.externalEvaluation.success && entry.externalEvaluation.escapedDefects === 0).length;
    const observedTokens = report.observations.every(entry => entry.usageStatus === "observed") ? sum(report.observations.flatMap(entry => [entry.inputTokens!, entry.outputTokens!]), true) : null;
    const stages = ["queue", "preparation", "execution", "capture", "persistence", "integration"] as const;
    const timeMs = report.observations.every(entry => stages.every(stage => entry.timingMs[stage] !== undefined)) ? sum(report.observations.flatMap(entry => stages.map(stage => entry.timingMs[stage]!))) : null;
    return { verifiedTasks: verified, observedTokens, timeMs, tokensPerVerifiedTask: observedTokens !== null && verified ? observedTokens / verified : null, timeMsPerVerifiedTask: timeMs !== null && verified ? timeMs / verified : null, humanInterventions: sum(report.observations.map(entry => entry.humanInterventions), true), repeatedActivities: sum(report.observations.map(entry => entry.repeatedActivities), true) };
  };
  return { schemaVersion: 1, pairs, unmatchedTasks, differences, left: { ...leftSummary, metrics: metrics(left) }, right: { ...rightSummary, metrics: metrics(right) },
    comparisonEligible: unmatchedTasks.length === 0 && differences.length === 0 && leftSummary.comparisonEligible && rightSummary.comparisonEligible,
    limitations: ["Paired report validation does not execute benchmarks or verify assessor independence. Model, tools, context, contract, budget and criteria differences prevent a controlled superiority claim.", ...left.limitations, ...right.limitations] };
}
export function summarizeBenchmarkReport(report: ProgramBenchmarkReport) {
  validateBenchmarkReport(report);
  const coding = report.observations.filter(entry => entry.category === "coding");
  const independentlyAssessed = coding.filter(entry => entry.externalEvaluation?.independent);
  const success = independentlyAssessed.filter(entry => entry.externalEvaluation?.success && entry.externalEvaluation.escapedDefects === 0).length;
  return { digest: programDigest(report), tasks: report.observations.length, independentlyAssessed: independentlyAssessed.length,
    verifiedSuccessRate: independentlyAssessed.length ? success / independentlyAssessed.length : null,
    unknownUsageTasks: report.observations.filter(entry => entry.usageStatus === "unknown").length,
    comparisonEligible: coding.length > 0 && independentlyAssessed.length === coding.length,
    limitations: [...report.limitations, "Eligibility does not prove superiority; comparison requires matched workloads and declared model/tool/context differences."] };
}
