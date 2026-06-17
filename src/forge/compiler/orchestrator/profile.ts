import type { AppGraphPhaseTimings } from "../app-graph/profile.ts";
import type { SignalProfile } from "../classifier/signals.ts";
import type { PlanPhaseTimings } from "./plan-profile.ts";

export interface CompilePhaseTimings {
  fastCheckMs: number;
  sessionMs: number;
  discoverMs: number;
  graphBuildMs: number;
  appGraphMs: number;
  appGraph?: AppGraphPhaseTimings;
  packageGraphMs: number;
  classifyMs: number;
  classifierSignals?: SignalProfile;
  planMs: number;
  planDetail?: PlanPhaseTimings;
  runtimeMatrixMs: number;
  importGuardsMs: number;
  qualityGateMs: number;
  emitMs: number;
  postEmitMs: number;
  unaccountedMs: number;
  totalMs: number;
}

let lastTimings: CompilePhaseTimings | null = null;

export function isCompileProfileEnabled(): boolean {
  return process.env.FORGE_PROFILE === "1" ||
    process.env.FORGE_PROFILE === "true" ||
    process.env.FORGE_PROFILE === "silent";
}

export function shouldPrintCompileProfile(): boolean {
  return process.env.FORGE_PROFILE === "1" || process.env.FORGE_PROFILE === "true";
}

export function recordCompileTimings(timings: CompilePhaseTimings): void {
  if (isCompileProfileEnabled()) {
    lastTimings = timings;
  }
}

export function getCompileTimings(): CompilePhaseTimings | null {
  return lastTimings;
}

export function formatCompileTimings(timings: CompilePhaseTimings): string {
  return [
    "forge compile profile:",
    `  fast-check: ${timings.fastCheckMs}ms`,
    `  session: ${timings.sessionMs}ms`,
    `  discover: ${timings.discoverMs}ms`,
    `  graph-build: ${timings.graphBuildMs}ms`,
    `  app-graph: ${timings.appGraphMs}ms`,
    ...(timings.appGraph
      ? [
          `    normalize: ${timings.appGraph.normalizeMs}ms`,
          `    parse: ${timings.appGraph.parseMs}ms`,
          `    symbols: ${timings.appGraph.symbolsMs}ms`,
          `    duplicates: ${timings.appGraph.duplicatesMs}ms`,
          `    module-graph: ${timings.appGraph.moduleGraphMs}ms`,
          `    input-hash: ${timings.appGraph.inputHashMs}ms`,
        ]
      : []),
    `  package-graph: ${timings.packageGraphMs}ms`,
    `  classify: ${timings.classifyMs}ms`,
    ...(timings.classifierSignals
      ? [
          `    gatherSignals: ${timings.classifierSignals.totalMs}ms`,
          `    gatherSignals calls: ${timings.classifierSignals.calls}`,
          `    gatherSignals exports scanned: ${timings.classifierSignals.exports}`,
          `    gatherSignals corpus bytes: ${timings.classifierSignals.corpusBytes}`,
          `    gatherSignals packages: ${timings.classifierSignals.packageCount}`,
          ...timings.classifierSignals.topPackages
            .slice(0, 5)
            .map(
              (pkg) =>
                `      ${pkg.packageName}: ${pkg.totalMs}ms, ${pkg.calls} calls, ${pkg.exports} exports`,
            ),
        ]
      : []),
    `  plan: ${timings.planMs}ms`,
    ...(timings.planDetail
      ? [
          `    core-artifacts: ${timings.planDetail.coreArtifactsMs}ms`,
          `    agent-artifacts: ${timings.planDetail.agentArtifactsMs}ms`,
          `    support-artifacts: ${timings.planDetail.supportArtifactsMs}ms`,
          `    file-render: ${timings.planDetail.fileRenderMs}ms`,
          `    finalize: ${timings.planDetail.finalizeMs}ms`,
        ]
      : []),
    `  runtime-matrix: ${timings.runtimeMatrixMs}ms`,
    `  import-guards: ${timings.importGuardsMs}ms`,
    `  quality-gate: ${timings.qualityGateMs}ms`,
    `  emit: ${timings.emitMs}ms`,
    `  post-emit: ${timings.postEmitMs}ms`,
    `  unaccounted: ${timings.unaccountedMs}ms`,
    `  total: ${timings.totalMs}ms`,
  ].join("\n");
}
