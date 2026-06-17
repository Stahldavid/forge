import type { AppGraphPhaseTimings } from "../app-graph/profile.ts";

export interface CompilePhaseTimings {
  discoverMs: number;
  appGraphMs: number;
  appGraph?: AppGraphPhaseTimings;
  packageGraphMs: number;
  planMs: number;
  emitMs: number;
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
    `  discover: ${timings.discoverMs}ms`,
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
    `  plan: ${timings.planMs}ms`,
    `  emit: ${timings.emitMs}ms`,
    `  total: ${timings.totalMs}ms`,
  ].join("\n");
}
