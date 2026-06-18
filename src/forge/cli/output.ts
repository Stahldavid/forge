import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type {
  ForgeAddResult,
  GenerateResult,
  InspectResult,
  VerifyResult,
} from "../compiler/types/cli.ts";

function failureKindFromDiagnostics(errors: Diagnostic[]): string | undefined {
  if (errors.length === 0) {
    return undefined;
  }
  return errors.some((error) => error.severity === "error")
    ? "error"
    : undefined;
}

export function attachFailureKind<T extends GenerateResult>(result: T): T {
  return {
    ...result,
    failureKind: result.failureKind ?? failureKindFromDiagnostics(result.errors),
  };
}

export function formatJsonResult(payload: unknown): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function buildGenerateJson(result: GenerateResult): Record<string, unknown> {
  return {
    changed: result.changed,
    unchanged: result.unchanged,
    warnings: result.warnings,
    errors: result.errors,
    exitCode: result.exitCode,
    failureKind: result.failureKind ?? null,
  };
}

export function buildAddJson(result: ForgeAddResult): Record<string, unknown> {
  return {
    alias: result.alias ?? null,
    ...buildGenerateJson(result),
  };
}

export function buildVerifyJson(result: VerifyResult): Record<string, unknown> {
  return {
    ok: result.ok,
    profile: result.profile ?? null,
    steps: result.steps,
    diagnostics: result.diagnostics,
    testGraphPlan: result.testGraphPlan ?? null,
    durationMs: result.durationMs ?? null,
    exitCode: result.exitCode,
  };
}

export function writeHumanVerify(result: VerifyResult): void {
  if (result.testGraphPlan) {
    const plan = result.testGraphPlan;
    console.log(
      `testgraph plan: ${plan.fileCount} files, ${plan.chunkCount} chunks, ${plan.laneMode} lanes, total jobs ${plan.totalJobs}, parallel jobs ${plan.jobs}, isolated jobs ${plan.isolatedJobs}, estimated ${plan.criticalPathEstimateMs}ms`,
    );
    for (const file of plan.slowestFiles.slice(0, 5)) {
      console.log(`testgraph slow: ${file.file} (${file.lane}, ${file.estimatedMs}ms, ${file.source})`);
    }
    for (const recommendation of plan.recommendations) {
      console.log(`testgraph hint: ${recommendation}`);
    }
  }

  for (const step of result.steps) {
    if (step.skipped) {
      console.log(`skip ${step.name}: ${step.skipReason}`);
      continue;
    }
    const suffix = [
      step.durationMs !== undefined ? `${step.durationMs}ms` : null,
      step.timedOut ? "timed out" : null,
      step.failureKind ? step.failureKind : null,
      step.command ? step.command : null,
    ].filter(Boolean).join(" ");
    console.log(`${step.ok ? "ok" : "fail"} ${step.name}${suffix ? ` (${suffix})` : ""}`);
  }

  for (const diagnostic of result.diagnostics) {
    const location = diagnostic.file ? ` ${diagnostic.file}` : "";
    console.log(
      `${diagnostic.severity} ${diagnostic.code}:${location} ${diagnostic.message}`,
    );
  }
}

export function buildInspectJson(result: InspectResult): Record<string, unknown> {
  return {
    target: result.target,
    data: result.data,
    warnings: result.warnings,
    errors: result.errors,
    exitCode: result.exitCode,
    failureKind: result.failureKind ?? null,
  };
}

export function writeHumanGenerate(result: GenerateResult): void {
  for (const path of result.changed) {
    console.log(`changed: ${path}`);
  }
  for (const path of result.unchanged) {
    console.log(`unchanged: ${path}`);
  }
  for (const diagnostic of [...result.warnings, ...result.errors]) {
    console.error(`${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
  }
}

export function writeHumanAdd(result: ForgeAddResult): void {
  console.log(`forge add ${result.alias ?? ""}`);
  writeHumanGenerate(result);
}

export function writeHumanInspect(result: InspectResult): void {
  console.log(JSON.stringify(result.data, null, 2));
  for (const diagnostic of [...result.warnings, ...result.errors]) {
    console.error(`${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
  }
}
