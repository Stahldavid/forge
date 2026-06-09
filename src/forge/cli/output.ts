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
    steps: result.steps,
    diagnostics: result.diagnostics,
    exitCode: result.exitCode,
  };
}

export function writeHumanVerify(result: VerifyResult): void {
  for (const step of result.steps) {
    if (step.skipped) {
      console.log(`skip ${step.name}: ${step.skipReason}`);
      continue;
    }
    console.log(`${step.ok ? "ok" : "fail"} ${step.name}`);
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
