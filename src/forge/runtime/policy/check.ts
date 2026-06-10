import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import {
  FORGE_POLICY_DENIED,
  FORGE_POLICY_MISSING,
} from "../../compiler/diagnostics/codes.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { RuntimeEntry } from "../../compiler/types/runtime-graph.ts";
import type { TelemetryContext } from "../telemetry/types.ts";
import { evaluateCommandAuth, evaluateQueryAuth } from "../auth/evaluate.ts";
import type { AuthContext } from "../auth/types.ts";
import {
  findCommandAuthBinding,
  findQueryAuthBinding,
  loadPermissionMatrix,
  loadPolicyRegistry,
} from "./load.ts";
import type { QueryDefinition } from "../../compiler/types/query-registry.ts";

export interface PolicyCheckResult {
  allowed: boolean;
  diagnostics: Diagnostic[];
  traceId?: string;
}

export interface PolicyCheckOptions {
  workspaceRoot: string;
  entry: RuntimeEntry;
  auth: AuthContext;
  telemetry?: TelemetryContext;
  strictPolicies?: boolean;
}

export async function checkCommandPolicy(
  options: PolicyCheckOptions,
): Promise<PolicyCheckResult> {
  const diagnostics: Diagnostic[] = [];
  const registry = loadPolicyRegistry(options.workspaceRoot);
  const matrix =
    loadPermissionMatrix(options.workspaceRoot) ??
    ({ entries: [] } as unknown as NonNullable<ReturnType<typeof loadPermissionMatrix>>);
  const binding = findCommandAuthBinding(registry, options.entry.name);

  if (binding?.auth.kind === "user") {
    const severity = options.strictPolicies ? "error" : "warning";
    diagnostics.push(
      createDiagnostic({
        severity,
        code: FORGE_POLICY_MISSING,
        message: `command '${options.entry.name}' has no auth policy metadata`,
        file: options.entry.file,
      }),
    );
  }

  const evaluation = evaluateCommandAuth(options.auth, binding, matrix);
  if (evaluation.allowed) {
    return { allowed: true, diagnostics };
  }

  if (options.telemetry && evaluation.policy) {
    await options.telemetry.capture("forge.policy.denied", {
      policy: evaluation.policy,
      role: evaluation.role ?? null,
      command: options.entry.name,
    });
  } else if (options.telemetry) {
    await options.telemetry.capture("forge.policy.denied", {
      policy: binding?.auth.kind === "policy" ? binding.auth.policy : null,
      role: options.auth.kind === "user" ? options.auth.role : null,
      command: options.entry.name,
    });
  }

  diagnostics.push(
    createDiagnostic({
      severity: "error",
      code: FORGE_POLICY_DENIED,
      message: evaluation.message ?? "policy denied",
      file: options.entry.file,
    }),
  );

  return {
    allowed: false,
    diagnostics,
    traceId: options.telemetry?.traceId,
  };
}

export interface QueryPolicyCheckOptions {
  workspaceRoot: string;
  query: QueryDefinition;
  auth: AuthContext;
  telemetry?: TelemetryContext;
  strictPolicies?: boolean;
}

export async function checkQueryPolicy(
  options: QueryPolicyCheckOptions,
): Promise<PolicyCheckResult> {
  const diagnostics: Diagnostic[] = [];
  const registry = loadPolicyRegistry(options.workspaceRoot);
  const matrix =
    loadPermissionMatrix(options.workspaceRoot) ??
    ({ entries: [] } as unknown as NonNullable<ReturnType<typeof loadPermissionMatrix>>);
  const binding = findQueryAuthBinding(registry, options.query.name);

  if (binding?.auth.kind === "user") {
    const severity = options.strictPolicies ? "error" : "warning";
    diagnostics.push(
      createDiagnostic({
        severity,
        code: FORGE_POLICY_MISSING,
        message: `query '${options.query.name}' has no auth policy metadata`,
        file: options.query.file,
      }),
    );
  }

  const evaluation = evaluateQueryAuth(options.auth, binding, matrix);
  if (evaluation.allowed) {
    return { allowed: true, diagnostics };
  }

  if (options.telemetry) {
    await options.telemetry.capture("forge.policy.denied", {
      policy: evaluation.policy ?? (binding?.auth.kind === "policy" ? binding.auth.policy : null),
      role: options.auth.kind === "user" ? options.auth.role : null,
      query: options.query.name,
    });
  }

  diagnostics.push(
    createDiagnostic({
      severity: "error",
      code: FORGE_POLICY_DENIED,
      message: evaluation.message ?? "policy denied",
      file: options.query.file,
    }),
  );

  return {
    allowed: false,
    diagnostics,
    traceId: options.telemetry?.traceId,
  };
}

export function loadPolicyArtifacts(workspaceRoot: string): {
  registry: ReturnType<typeof loadPolicyRegistry>;
  matrix: ReturnType<typeof loadPermissionMatrix>;
} {
  return {
    registry: loadPolicyRegistry(workspaceRoot),
    matrix: loadPermissionMatrix(workspaceRoot),
  };
}
