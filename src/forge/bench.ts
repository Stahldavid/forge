import { run as runCompiler } from "./compiler/orchestrator/run.ts";
import { getCompileTimings, type CompilePhaseTimings } from "./compiler/orchestrator/profile.ts";
import type { Diagnostic } from "./compiler/types/diagnostic.ts";

export type BenchSubcommand = "compiler";

export interface BenchCommandOptions {
  subcommand: BenchSubcommand;
  workspaceRoot: string;
  json: boolean;
  iterations: number;
  warmups: number;
  concurrency: number;
}

export interface CompilerBenchIteration {
  iteration: number;
  warmup: boolean;
  totalMs: number;
  phases: CompilePhaseTimings;
}

export interface CompilerBenchSummary {
  iterations: number;
  warmups: number;
  concurrency: number;
  medianMs: number;
  averageMs: number;
  minMs: number;
  maxMs: number;
}

export interface CompilerBenchResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  benchmark: "compiler";
  mode: "dry-run";
  summary: CompilerBenchSummary;
  results: CompilerBenchIteration[];
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarize(results: CompilerBenchIteration[], options: BenchCommandOptions): CompilerBenchSummary {
  const measured = results.filter((result) => !result.warmup).map((result) => result.totalMs).sort((a, b) => a - b);
  if (measured.length === 0) {
    return {
      iterations: options.iterations,
      warmups: options.warmups,
      concurrency: options.concurrency,
      medianMs: 0,
      averageMs: 0,
      minMs: 0,
      maxMs: 0,
    };
  }
  const total = measured.reduce((sum, value) => sum + value, 0);
  const middle = Math.floor(measured.length / 2);
  const median = measured.length % 2 === 0
    ? (measured[middle - 1]! + measured[middle]!) / 2
    : measured[middle]!;
  return {
    iterations: options.iterations,
    warmups: options.warmups,
    concurrency: options.concurrency,
    medianMs: roundMs(median),
    averageMs: roundMs(total / measured.length),
    minMs: roundMs(measured[0] ?? 0),
    maxMs: roundMs(measured[measured.length - 1] ?? 0),
  };
}

export async function runCompilerBenchCommand(options: BenchCommandOptions): Promise<CompilerBenchResult> {
  const normalized: BenchCommandOptions = {
    ...options,
    iterations: positiveInteger(options.iterations, 5),
    warmups: Math.max(0, Math.floor(options.warmups)),
    concurrency: positiveInteger(options.concurrency, 4),
  };
  const previousProfile = process.env.FORGE_PROFILE;
  process.env.FORGE_PROFILE = "silent";
  const results: CompilerBenchIteration[] = [];
  const diagnostics: Diagnostic[] = [];

  try {
    const totalRuns = normalized.warmups + normalized.iterations;
    for (let index = 0; index < totalRuns; index += 1) {
      const warmup = index < normalized.warmups;
      const result = await runCompiler({
        workspaceRoot: normalized.workspaceRoot,
        check: false,
        dryRun: true,
        json: true,
        concurrency: normalized.concurrency,
      });
      diagnostics.push(...result.errors, ...result.warnings);
      const timings = getCompileTimings();
      if (!timings) {
        diagnostics.push({
          severity: "error",
          code: "FORGE_BENCH_PROFILE_MISSING",
          message: "compiler timings were not recorded",
        });
        break;
      }
      results.push({
        iteration: warmup ? index + 1 : index - normalized.warmups + 1,
        warmup,
        totalMs: roundMs(timings.totalMs),
        phases: {
          fastCheckMs: roundMs(timings.fastCheckMs),
          sessionMs: roundMs(timings.sessionMs),
          discoverMs: roundMs(timings.discoverMs),
          graphBuildMs: roundMs(timings.graphBuildMs),
          appGraphMs: roundMs(timings.appGraphMs),
          ...(timings.appGraph
            ? {
                appGraph: {
                  normalizeMs: roundMs(timings.appGraph.normalizeMs),
                  parseMs: roundMs(timings.appGraph.parseMs),
                  symbolsMs: roundMs(timings.appGraph.symbolsMs),
                  duplicatesMs: roundMs(timings.appGraph.duplicatesMs),
                  moduleGraphMs: roundMs(timings.appGraph.moduleGraphMs),
                  inputHashMs: roundMs(timings.appGraph.inputHashMs),
                  totalMs: roundMs(timings.appGraph.totalMs),
                },
              }
            : {}),
          packageGraphMs: roundMs(timings.packageGraphMs),
          classifyMs: roundMs(timings.classifyMs),
          ...(timings.classifierSignals
            ? {
                classifierSignals: {
                  calls: timings.classifierSignals.calls,
                  totalMs: roundMs(timings.classifierSignals.totalMs),
                  entrypoints: timings.classifierSignals.entrypoints,
                  exports: timings.classifierSignals.exports,
                  textFragments: timings.classifierSignals.textFragments,
                  corpusBytes: timings.classifierSignals.corpusBytes,
                  packageCount: timings.classifierSignals.packageCount,
                  topPackages: timings.classifierSignals.topPackages.map((pkg) => ({
                    packageName: pkg.packageName,
                    calls: pkg.calls,
                    totalMs: roundMs(pkg.totalMs),
                    entrypoints: pkg.entrypoints,
                    exports: pkg.exports,
                    textFragments: pkg.textFragments,
                    corpusBytes: pkg.corpusBytes,
                  })),
                },
              }
            : {}),
          planMs: roundMs(timings.planMs),
          ...(timings.planDetail
            ? {
                planDetail: {
                  coreArtifactsMs: roundMs(timings.planDetail.coreArtifactsMs),
                  agentArtifactsMs: roundMs(timings.planDetail.agentArtifactsMs),
                  supportArtifactsMs: roundMs(timings.planDetail.supportArtifactsMs),
                  fileRenderMs: roundMs(timings.planDetail.fileRenderMs),
                  finalizeMs: roundMs(timings.planDetail.finalizeMs),
                  totalMs: roundMs(timings.planDetail.totalMs),
                },
              }
            : {}),
          runtimeMatrixMs: roundMs(timings.runtimeMatrixMs),
          importGuardsMs: roundMs(timings.importGuardsMs),
          qualityGateMs: roundMs(timings.qualityGateMs),
          emitMs: roundMs(timings.emitMs),
          postEmitMs: roundMs(timings.postEmitMs),
          unaccountedMs: roundMs(timings.unaccountedMs),
          totalMs: roundMs(timings.totalMs),
        },
      });
      if (result.exitCode !== 0) {
        break;
      }
    }
  } finally {
    if (previousProfile === undefined) {
      delete process.env.FORGE_PROFILE;
    } else {
      process.env.FORGE_PROFILE = previousProfile;
    }
  }

  const measuredCount = results.filter((result) => !result.warmup).length;
  const ok = measuredCount === normalized.iterations && diagnostics.every((diagnostic) => diagnostic.severity !== "error");
  return {
    schemaVersion: "0.1.0",
    ok,
    benchmark: "compiler",
    mode: "dry-run",
    summary: summarize(results, normalized),
    results,
    diagnostics,
    exitCode: ok ? 0 : 1,
  };
}

export function formatCompilerBenchJson(result: CompilerBenchResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatCompilerBenchHuman(result: CompilerBenchResult): string {
  const lines = [
    `${result.ok ? "ok" : "fail"} compiler bench (${result.summary.iterations} iterations, ${result.summary.warmups} warmups)`,
    `median ${result.summary.medianMs}ms, avg ${result.summary.averageMs}ms, min ${result.summary.minMs}ms, max ${result.summary.maxMs}ms`,
  ];
  for (const item of result.results.filter((entry) => !entry.warmup)) {
    lines.push(
      `  #${item.iteration}: ${item.totalMs}ms ` +
        `(discover ${item.phases.discoverMs}ms, graphs ${item.phases.graphBuildMs}ms, classify ${item.phases.classifyMs}ms, plan ${item.phases.planMs}ms, emit ${item.phases.emitMs}ms)`,
    );
    if (item.phases.appGraph) {
      lines.push(
        `      app detail: parse ${item.phases.appGraph.parseMs}ms, symbols ${item.phases.appGraph.symbolsMs}ms, module ${item.phases.appGraph.moduleGraphMs}ms, hash ${item.phases.appGraph.inputHashMs}ms`,
      );
    }
    if (item.phases.classifierSignals) {
      lines.push(
        `      classifier detail: gatherSignals ${item.phases.classifierSignals.totalMs}ms across ${item.phases.classifierSignals.calls} calls, ${item.phases.classifierSignals.exports} exports`,
      );
      for (const pkg of item.phases.classifierSignals.topPackages.slice(0, 3)) {
        lines.push(
          `        ${pkg.packageName}: ${pkg.totalMs}ms, ${pkg.calls} calls, ${pkg.exports} exports`,
        );
      }
    }
    if (item.phases.planDetail) {
      lines.push(
        `      plan detail: core ${item.phases.planDetail.coreArtifactsMs}ms, agent ${item.phases.planDetail.agentArtifactsMs}ms, support ${item.phases.planDetail.supportArtifactsMs}ms, render ${item.phases.planDetail.fileRenderMs}ms, finalize ${item.phases.planDetail.finalizeMs}ms`,
      );
    }
  }
  for (const diagnostic of result.diagnostics) {
    lines.push(`${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
  }
  return `${lines.join("\n")}\n`;
}
