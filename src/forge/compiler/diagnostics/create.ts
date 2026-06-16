import type { Diagnostic, DiagnosticSeverity } from "../types/diagnostic.ts";
import type { DiagnosticCode } from "./codes.ts";

export interface DiagnosticInput {
  severity: DiagnosticSeverity;
  code: DiagnosticCode | string;
  message: string;
  file?: string;
  span?: { start: number; end: number };
  fixHint?: string;
  suggestedCommands?: string[];
  docs?: string[];
}

interface DiagnosticGuidance {
  fixHint: string;
  suggestedCommands?: string[];
  docs?: string[];
}

function defaultGuidanceForCode(code: string): DiagnosticGuidance | null {
  if (code === "FORGE_DRIFT") {
    return {
      fixHint: "Regenerate Forge artifacts and re-run the drift check.",
      suggestedCommands: ["forge generate", "forge generate --check"],
      docs: ["AGENTS.md"],
    };
  }
  if (code === "FORGE_IMPACT_GENERATED_DRIFT") {
    return {
      fixHint: "Generated artifacts are stale. Run forge generate, then re-run the impact or verify command.",
      suggestedCommands: ["forge generate", "forge generate --check", "forge verify --changed --json"],
      docs: ["AGENTS.md", "src/forge/_generated/agentContract.json"],
    };
  }
  if (code === "FORGE_GENERATE_LOCKED") {
    return {
      fixHint: "Wait for the active forge generate command to finish. If no Forge process is running, delete .forge/locks/generate.lock and retry.",
      suggestedCommands: ["forge generate", "forge generate --check", "forge dev --once --json"],
      docs: ["AGENTS.md"],
    };
  }
  if (code === "FORGE_GUARD_VIOLATION" || code === "FORGE_RUNTIME_GUARD_BLOCKED") {
    return {
      fixHint: "Move forbidden side effects into an action/workflow, or replace the package with an allowed adapter for this runtime.",
      suggestedCommands: ["forge repair diagnose --diagnostic FORGE_GUARD_VIOLATION --json", "forge refactor extract-action <command> --package <package> --dry-run --json"],
      docs: ["src/forge/_generated/runtimeRules.md", "AGENTS.md"],
    };
  }
  if (code === "FORGE_SECRET_DIRECT_PROCESS_ENV") {
    return {
      fixHint: "Use ctx.secrets or ctx.config instead of reading process.env directly from app runtime code.",
      suggestedCommands: ["forge repair diagnose --diagnostic FORGE_SECRET_DIRECT_PROCESS_ENV --json", "forge refactor replace-process-env <ENV_NAME> --dry-run --json"],
      docs: ["src/forge/_generated/runtimeRules.md"],
    };
  }
  if (code === "FORGE_AI_FORBIDDEN_CONTEXT") {
    return {
      fixHint: "Move AI calls to an action, workflow, endpoint, or server context.",
      suggestedCommands: ["forge repair diagnose --diagnostic FORGE_AI_FORBIDDEN_CONTEXT --json", "forge inspect ai --json"],
      docs: ["src/forge/_generated/runtimeRules.md"],
    };
  }
  if (code === "FORGE_QUERY_FORBIDDEN_WRITE" || code === "FORGE_QUERY_FORBIDDEN_SIDE_EFFECT") {
    return {
      fixHint: "Keep queries and liveQueries read-only; move writes and side effects to commands/actions.",
      suggestedCommands: ["forge inspect queries --json", "forge repair diagnose --diagnostic " + code + " --json"],
      docs: ["src/forge/_generated/runtimeRules.md"],
    };
  }
  if (code.startsWith("FORGE_RLS_")) {
    return {
      fixHint: "Inspect generated RLS SQL and validate tenant isolation before applying migrations.",
      suggestedCommands: ["forge rls check --json", "forge rls test --db postgres --json"],
      docs: ["src/forge/_generated/agentContract.json"],
    };
  }
  if (code.startsWith("FORGE_UI_")) {
    return {
      fixHint: "Inspect the last UI run and use the UI report as repair input.",
      suggestedCommands: ["forge ui report last --json", "forge repair diagnose --from-last-ui-run --json"],
      docs: ["src/forge/_generated/uiTestManifest.json"],
    };
  }
  if (code === "FORGE_VERIFY_SCRIPT_TIMEOUT") {
    return {
      fixHint: "Run the timed-out script directly, or use impact-based verification to narrow the check before retrying the full gate.",
      suggestedCommands: ["forge test plan --changed --json", "forge verify --changed", "forge dev --once --json"],
      docs: ["AGENTS.md"],
    };
  }
  if (code === "FORGE_TEST_RUN_TIMEOUT") {
    return {
      fixHint: "Run the timed-out command directly, or increase the impact test timeout only after checking why it is slow.",
      suggestedCommands: ["forge test plan --changed --json", "forge test run --changed --timeout-ms 120000 --json"],
      docs: ["AGENTS.md", ".forge/test-runs/last.json"],
    };
  }
  if (code === "FORGE_TEST_COMMAND_RESOLUTION_FAILED") {
    return {
      fixHint: "Fix the local command resolution before retrying. On Windows, install Bun at ~/.bun/bin/bun.exe or set FORGE_BUN to an existing bun.exe.",
      suggestedCommands: ["forge dev --once --json", "forge test plan --changed --json"],
      docs: ["AGENTS.md"],
    };
  }
  if (code.startsWith("FORGE_FRONTEND_")) {
    return {
      fixHint: "Use the generated frontend bridge and inspect src/forge/_generated/frontendGraph.json before editing UI wiring.",
      suggestedCommands: ["forge inspect frontend --json", "forge make ui --framework vite --dry-run --json", "forge generate"],
      docs: ["src/forge/_generated/frontendGraph.json", "AGENTS.md"],
    };
  }
  if (code.startsWith("FORGE_REFACTOR_")) {
    return {
      fixHint: "Review the refactor plan, lower the scope if diagnostics are unsafe, and re-run in dry-run mode before applying.",
      suggestedCommands: ["forge refactor <operation> --dry-run --json", "forge impact --changed --json"],
      docs: ["AGENTS.md"],
    };
  }
  if (code.startsWith("FORGE_REPAIR_")) {
    return {
      fixHint: "Open the repair plan and apply only high-confidence repairs.",
      suggestedCommands: ["forge repair plan --json", "forge repair apply <repairId> --dry-run --json"],
      docs: ["AGENTS.md"],
    };
  }
  return null;
}

export function createDiagnostic(input: DiagnosticInput): Diagnostic {
  const guidance = defaultGuidanceForCode(input.code);
  return {
    severity: input.severity,
    code: input.code,
    message: input.message,
    ...(input.file !== undefined ? { file: input.file } : {}),
    ...(input.span !== undefined ? { span: input.span } : {}),
    ...(input.fixHint ?? guidance?.fixHint ? { fixHint: input.fixHint ?? guidance?.fixHint } : {}),
    ...(input.suggestedCommands ?? guidance?.suggestedCommands
      ? { suggestedCommands: input.suggestedCommands ?? guidance?.suggestedCommands }
      : {}),
    ...(input.docs ?? guidance?.docs ? { docs: input.docs ?? guidance?.docs } : {}),
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
    fixHint:
      context === "command" || context === "query" || context === "liveQuery"
        ? `Move '${packageName}' usage out of the ${context} path into an action/workflow, then emit an event from the ${context}.`
        : `Move '${packageName}' usage to a runtime context that allows it, or add a package recipe exception intentionally.`,
    suggestedCommands:
      context === "command"
        ? [`forge refactor extract-action <command> --package ${packageName} --dry-run --json`, "forge repair diagnose --diagnostic FORGE_GUARD_VIOLATION --json"]
        : ["forge inspect runtime-matrix --json", "forge repair diagnose --diagnostic FORGE_GUARD_VIOLATION --json"],
    docs: ["src/forge/_generated/runtimeRules.md", "AGENTS.md"],
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
