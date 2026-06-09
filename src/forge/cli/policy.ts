import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { FORGE_POLICY_MISSING } from "../compiler/diagnostics/codes.ts";
import { buildAppGraph } from "../compiler/app-graph/build.ts";
import {
  buildPermissionMatrixFromRegistry,
  buildPolicyRegistry,
} from "../compiler/policy-registry/build.ts";
import { discover } from "../compiler/orchestrator/discover.ts";
import { loadManifest } from "../compiler/orchestrator/manifest.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import type { PermissionMatrix, PolicyRegistry } from "../compiler/types/policy-registry.ts";
import { simulatePolicy } from "../runtime/auth/evaluate.ts";
import {
  loadPermissionMatrix,
  loadPolicyRegistry,
} from "../runtime/policy/load.ts";

export type PolicySubcommand = "list" | "matrix" | "simulate" | "check";

export interface PolicyCommandOptions {
  subcommand: PolicySubcommand;
  workspaceRoot: string;
  json: boolean;
  policy?: string;
  role?: string;
  strictPolicies?: boolean;
}

export interface PolicyCommandResult {
  exitCode: 0 | 1;
  data?: unknown;
  diagnostics?: ReturnType<typeof createDiagnostic>[];
}

function readGeneratedPolicyRegistry(workspaceRoot: string): PolicyRegistry | null {
  const absolute = join(workspaceRoot, GENERATED_DIR, "policyRegistry.json");
  if (!existsSync(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader(readFileSync(absolute, "utf8"));
  return JSON.parse(raw) as PolicyRegistry;
}

function readGeneratedPermissionMatrix(workspaceRoot: string): PermissionMatrix | null {
  const absolute = join(workspaceRoot, GENERATED_DIR, "permissionMatrix.json");
  if (!existsSync(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader(readFileSync(absolute, "utf8"));
  return JSON.parse(raw) as PermissionMatrix;
}

export async function runPolicyCommand(
  options: PolicyCommandOptions,
): Promise<PolicyCommandResult> {
  switch (options.subcommand) {
    case "list": {
      const registry =
        loadPolicyRegistry(options.workspaceRoot) ??
        readGeneratedPolicyRegistry(options.workspaceRoot);
      if (!registry) {
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_INSPECT_MISSING",
              message: `missing ${GENERATED_DIR}/policyRegistry.json; run forge generate first`,
            }),
          ],
        };
      }
      return {
        exitCode: 0,
        data: {
          policies: registry.policies,
          commandAuth: registry.commandAuth,
        },
      };
    }
    case "matrix": {
      const matrix =
        loadPermissionMatrix(options.workspaceRoot) ??
        readGeneratedPermissionMatrix(options.workspaceRoot);
      if (!matrix) {
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_INSPECT_MISSING",
              message: `missing ${GENERATED_DIR}/permissionMatrix.json; run forge generate first`,
            }),
          ],
        };
      }
      return { exitCode: 0, data: matrix };
    }
    case "simulate": {
      if (!options.policy || !options.role) {
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_CLI_USAGE",
              message: "forge policy simulate requires <policy> and --role",
            }),
          ],
        };
      }

      const matrix =
        loadPermissionMatrix(options.workspaceRoot) ??
        readGeneratedPermissionMatrix(options.workspaceRoot);
      if (!matrix) {
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_INSPECT_MISSING",
              message: `missing ${GENERATED_DIR}/permissionMatrix.json; run forge generate first`,
            }),
          ],
        };
      }

      const result = simulatePolicy(matrix, options.policy, options.role);
      return { exitCode: result.allowed ? 0 : 1, data: result };
    }
    case "check": {
      const ctx = discover({ workspaceRoot: options.workspaceRoot });
      const manifest = loadManifest(ctx.cacheDir);
      const appGraph = await buildAppGraph({
        workspaceRoot: ctx.workspaceRoot,
        sources: ctx.sources,
        prior: manifest.priorAppGraph,
        tsconfigPath: ctx.tsconfigPath ?? undefined,
      });
      const registry = buildPolicyRegistry(appGraph);
      const diagnostics = [...registry.diagnostics];

      for (const binding of registry.commandAuth) {
        if (binding.auth.kind === "user") {
          diagnostics.push(
            createDiagnostic({
              severity: options.strictPolicies ? "error" : "warning",
              code: FORGE_POLICY_MISSING,
              message: `command '${binding.commandName}' has no auth policy metadata`,
              file: binding.file,
            }),
          );
        }
      }

      const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      return {
        exitCode: errors.length > 0 ? 1 : 0,
        data: {
          policies: registry.policies.length,
          commandAuth: registry.commandAuth.length,
          matrix: buildPermissionMatrixFromRegistry(registry).entries,
        },
        diagnostics,
      };
    }
    default:
      return { exitCode: 1 };
  }
}

export function formatPolicyHuman(
  subcommand: PolicySubcommand,
  result: PolicyCommandResult,
): string {
  if (result.diagnostics && result.diagnostics.length > 0 && !result.data) {
    return `${result.diagnostics.map((diagnostic) => `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`).join("\n")}\n`;
  }

  if (subcommand === "list" && result.data && typeof result.data === "object") {
    const data = result.data as {
      policies: { name: string; roles: string[] }[];
      commandAuth: { commandName: string; auth: { kind: string; policy?: string } }[];
    };
    const lines = ["Policies:"];
    for (const policy of data.policies) {
      lines.push(`  ${policy.name}: ${policy.roles.join(", ")}`);
    }
    lines.push("", "Command auth:");
    for (const binding of data.commandAuth) {
      lines.push(
        `  ${binding.commandName}: ${binding.auth.kind}${binding.auth.policy ? `(${binding.auth.policy})` : ""}`,
      );
    }
    return `${lines.join("\n")}\n`;
  }

  return `${JSON.stringify(result.data ?? result.diagnostics, null, 2)}\n`;
}

export function formatPolicyJson(result: PolicyCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
