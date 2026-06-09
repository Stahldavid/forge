import type { Diagnostic, DiagnosticSeverity } from "../types/diagnostic.ts";
import type { DiagnosticCode } from "./codes.ts";

export interface DiagnosticInput {
  severity: DiagnosticSeverity;
  code: DiagnosticCode | string;
  message: string;
  file?: string;
  span?: { start: number; end: number };
}

export function createDiagnostic(input: DiagnosticInput): Diagnostic {
  return {
    severity: input.severity,
    code: input.code,
    message: input.message,
    ...(input.file !== undefined ? { file: input.file } : {}),
    ...(input.span !== undefined ? { span: input.span } : {}),
  };
}

export function forgeDupSymbol(
  qualifiedName: string,
  file: string,
): Diagnostic {
  return createDiagnostic({
    severity: "warning",
    code: "FORGE_DUP_SYMBOL",
    message: `duplicate symbol id for '${qualifiedName}'`,
    file,
  });
}

export function forgeDrift(file: string): Diagnostic {
  return createDiagnostic({
    severity: "warning",
    code: "FORGE_DRIFT",
    message: `generated file drift detected: ${file}`,
    file,
  });
}

export function forgePkgNoTypes(
  packageName: string,
  subpath: string,
): Diagnostic {
  return createDiagnostic({
    severity: "warning",
    code: "FORGE_PKG_NO_TYPES",
    message: `no types found for '${packageName}' subpath '${subpath}'`,
  });
}

export function forgeGuardViolation(
  packageName: string,
  context: string,
  rationale: string,
  file: string,
  span: { start: number; end: number },
): Diagnostic {
  return createDiagnostic({
    severity: "error",
    code: "FORGE_GUARD_VIOLATION",
    message: `'${packageName}' is not allowed in '${context}' context: ${rationale}`,
    file,
    span,
  });
}

export function forgeSandboxLimit(packageName: string): Diagnostic {
  return createDiagnostic({
    severity: "warning",
    code: "FORGE_SANDBOX_LIMIT",
    message: `sandbox limit exceeded while inspecting '${packageName}'; falling back to static analysis`,
  });
}

export function forgeSandboxAbnormal(packageName: string, detail?: string): Diagnostic {
  const suffix = detail ? ` (${detail})` : "";
  return createDiagnostic({
    severity: "warning",
    code: "FORGE_SANDBOX_ABNORMAL",
    message: `runtime inspection process exited abnormally for '${packageName}'; falling back to static-only package analysis${suffix}`,
  });
}

export function forgeSecretLeak(): Diagnostic {
  return createDiagnostic({
    severity: "error",
    code: "FORGE_SECRET_LEAK",
    message:
      "secret leak detected in sandbox inspection result; withholding runtime data",
  });
}

export function forgeOrphanedGeneratedFile(file: string): Diagnostic {
  return createDiagnostic({
    severity: "error",
    code: "FORGE_ORPHANED_GENERATED_FILE",
    message: `orphaned generated file: ${file}`,
    file,
  });
}

export function forgeWriteError(file: string): Diagnostic {
  return createDiagnostic({
    severity: "error",
    code: "FORGE_WRITE_ERROR",
    message: `failed to write generated file: ${file}`,
    file,
  });
}
