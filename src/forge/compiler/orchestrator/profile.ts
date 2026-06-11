export interface CompilePhaseTimings {
  discoverMs: number;
  appGraphMs: number;
  packageGraphMs: number;
  planMs: number;
  emitMs: number;
  totalMs: number;
}

let lastTimings: CompilePhaseTimings | null = null;

export function isCompileProfileEnabled(): boolean {
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
    `  package-graph: ${timings.packageGraphMs}ms`,
    `  plan: ${timings.planMs}ms`,
    `  emit: ${timings.emitMs}ms`,
    `  total: ${timings.totalMs}ms`,
  ].join("\n");
}
