import { createDiagnostic } from "../diagnostics/create.ts";
import {
  FORGE_POLICY_DUPLICATE,
  FORGE_POLICY_ROLE_EMPTY,
  FORGE_POLICY_UNKNOWN,
  FORGE_TENANT_TABLE_WITHOUT_TENANT_ID,
} from "../diagnostics/codes.ts";
import { toSnakeCase } from "../data-graph/sql/naming.ts";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type { DataGraph } from "../types/data-graph.ts";
import type { ForgeExternalServiceGraph } from "../external-manifest/types.ts";
import type {
  CommandAuthBinding,
  PermissionMatrix,
  PermissionMatrixEntry,
  PolicyRegistry,
  PolicyRule,
  QueryAuthBinding,
  TenantScope,
  TenantScopeEntry,
} from "../types/policy-registry.ts";
import {
  POLICY_REGISTRY_ANALYZER_VERSION,
  POLICY_REGISTRY_SCHEMA_VERSION,
} from "./constants.ts";
import { parseAuthFromSlice, parsePoliciesFromSlice } from "./parse.ts";

function stableSortPolicies(policies: PolicyRule[]): PolicyRule[] {
  return [...policies].sort((a, b) => {
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }
    return a.file < b.file ? -1 : 1;
  });
}

function stableSortCommandAuth(bindings: CommandAuthBinding[]): CommandAuthBinding[] {
  return [...bindings].sort((a, b) => {
    if (a.commandName !== b.commandName) {
      return a.commandName < b.commandName ? -1 : 1;
    }
    return a.file < b.file ? -1 : 1;
  });
}

function stableSortQueryAuth(bindings: QueryAuthBinding[]): QueryAuthBinding[] {
  return [...bindings].sort((a, b) => {
    if (a.queryName !== b.queryName) {
      return a.queryName < b.queryName ? -1 : 1;
    }
    return a.file < b.file ? -1 : 1;
  });
}

function buildPermissionMatrix(policies: PolicyRule[]): PermissionMatrixEntry[] {
  return policies
    .filter((policy) => policy.kind === "roles")
    .map((policy) => ({
      policy: policy.name,
      roles: [...policy.roles].sort(),
    }))
    .sort((a, b) => (a.policy < b.policy ? -1 : a.policy > b.policy ? 1 : 0));
}

function authFromExternalPolicy(policy: string | undefined): CommandAuthBinding["auth"] {
  if (!policy) {
    return { kind: "public" };
  }
  if (policy === "public" || policy === "system" || policy === "user") {
    return { kind: policy };
  }
  return { kind: "policy", policy };
}

export function buildPolicyRegistry(
  appGraph: AppGraph,
  externalServices?: ForgeExternalServiceGraph,
): PolicyRegistry {
  const policies: PolicyRule[] = [];
  const commandAuth: CommandAuthBinding[] = [];
  const queryAuth: QueryAuthBinding[] = [];
  const diagnostics: PolicyRegistry["diagnostics"] = [];
  const seenPolicyNames = new Map<string, PolicyRule>();

  for (const symbol of appGraph.symbols) {
    if (symbol.kind === "policy") {
      const sourceSlice =
        typeof symbol.meta.sourceSlice === "string" ? symbol.meta.sourceSlice : "";
      if (sourceSlice.length === 0) {
        continue;
      }

      for (const parsed of parsePoliciesFromSlice(sourceSlice)) {
        const rule: PolicyRule = {
          name: parsed.name,
          kind: parsed.kind,
          roles: parsed.roles,
          file: symbol.file,
          symbolId: symbol.id,
        };

        if (parsed.kind === "roles" && parsed.roles.length === 0) {
          diagnostics.push(
            createDiagnostic({
              severity: "warning",
              code: FORGE_POLICY_ROLE_EMPTY,
              message: `policy '${parsed.name}' has no roles`,
              file: symbol.file,
              span: symbol.span,
            }),
          );
        }

        const existing = seenPolicyNames.get(parsed.name);
        if (existing) {
          diagnostics.push(
            createDiagnostic({
              severity: "warning",
              code: FORGE_POLICY_DUPLICATE,
              message: `duplicate policy '${parsed.name}'`,
              file: symbol.file,
              span: symbol.span,
            }),
          );
          continue;
        }

        seenPolicyNames.set(parsed.name, rule);
        policies.push(rule);
      }
    }

    if (symbol.kind === "command") {
      const sourceSlice =
        typeof symbol.meta.sourceSlice === "string" ? symbol.meta.sourceSlice : "";
      const auth =
        sourceSlice.length > 0
          ? parseAuthFromSlice(sourceSlice)
          : { kind: "public" as const };

      commandAuth.push({
        commandName: symbol.name,
        file: symbol.file,
        symbolId: symbol.id,
        auth,
      });
    }

    if (symbol.kind === "query" || symbol.kind === "liveQuery") {
      const sourceSlice =
        typeof symbol.meta.sourceSlice === "string" ? symbol.meta.sourceSlice : "";
      const auth =
        sourceSlice.length > 0
          ? parseAuthFromSlice(sourceSlice)
          : { kind: "public" as const };

      queryAuth.push({
        queryName: symbol.name,
        file: symbol.file,
        symbolId: symbol.id,
        auth,
      });
    }
  }

  for (const service of externalServices?.services ?? []) {
    for (const entry of service.entries) {
      const qualifiedName = `${service.name}.${entry.name}`;
      const binding = {
        file: `external:${service.name}`,
        symbolId: `external:${service.name}:${entry.kind}:${entry.name}`,
        auth: authFromExternalPolicy(entry.policy),
      };
      if (entry.kind === "command") {
        commandAuth.push({
          commandName: qualifiedName,
          ...binding,
        });
      } else {
        queryAuth.push({
          queryName: qualifiedName,
          ...binding,
        });
      }
    }
  }

  const sortedPolicies = stableSortPolicies(policies);
  const sortedCommandAuth = stableSortCommandAuth(commandAuth);
  const sortedQueryAuth = stableSortQueryAuth(queryAuth);

  for (const binding of sortedCommandAuth) {
    if (binding.auth.kind !== "policy") {
      continue;
    }
    if (!seenPolicyNames.has(binding.auth.policy)) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: FORGE_POLICY_UNKNOWN,
          message: `command '${binding.commandName}' references unknown policy '${binding.auth.policy}'`,
          file: binding.file,
          fixHint: binding.file.startsWith("external:")
            ? "Define this policy in the Forge app or change the external manifest policy to public, user, or system."
            : undefined,
        }),
      );
    }
  }

  for (const binding of sortedQueryAuth) {
    if (binding.auth.kind !== "policy") {
      continue;
    }
    if (!seenPolicyNames.has(binding.auth.policy)) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: FORGE_POLICY_UNKNOWN,
          message: `query '${binding.queryName}' references unknown policy '${binding.auth.policy}'`,
          file: binding.file,
          fixHint: binding.file.startsWith("external:")
            ? "Define this policy in the Forge app or change the external manifest policy to public, user, or system."
            : undefined,
        }),
      );
    }
  }

  return {
    schemaVersion: POLICY_REGISTRY_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: POLICY_REGISTRY_ANALYZER_VERSION,
    inputHash: hashStable(
      canonicalJson({
        appInputHash: appGraph.inputHash,
        externalInputHash: externalServices?.inputHash ?? "",
        analyzerVersion: POLICY_REGISTRY_ANALYZER_VERSION,
      }),
    ),
    policies: sortedPolicies,
    commandAuth: sortedCommandAuth,
    queryAuth: sortedQueryAuth,
    diagnostics: diagnostics.sort((a, b) => {
      const fileA = a.file ?? "";
      const fileB = b.file ?? "";
      if (fileA !== fileB) {
        return fileA < fileB ? -1 : 1;
      }
      return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
    }),
  };
}

export function buildPermissionMatrixFromRegistry(
  registry: PolicyRegistry,
): PermissionMatrix {
  return {
    schemaVersion: POLICY_REGISTRY_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    inputHash: registry.inputHash,
    entries: buildPermissionMatrix(registry.policies),
  };
}

export function buildTenantScope(dataGraph: DataGraph): TenantScope {
  const tables: TenantScopeEntry[] = [];
  const diagnostics: TenantScope["diagnostics"] = [];

  for (const table of dataGraph.tables) {
    const tenantField = table.fields.find((field) => field.name === "tenantId");
    if (tenantField) {
      tables.push({
        table: toSnakeCase(table.name),
        exportName: table.exportName,
        tenantIdColumn: toSnakeCase("tenantId"),
        file: table.file,
      });
      continue;
    }

    if (/tenant/i.test(table.name)) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: FORGE_TENANT_TABLE_WITHOUT_TENANT_ID,
          message: `table '${table.name}' looks tenant-related but has no tenantId field`,
          file: table.file,
        }),
      );
    }
  }

  return {
    schemaVersion: POLICY_REGISTRY_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    inputHash: hashStable(
      canonicalJson({
        dataInputHash: dataGraph.inputHash,
        analyzerVersion: POLICY_REGISTRY_ANALYZER_VERSION,
      }),
    ),
    tables: tables.sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0)),
    diagnostics,
  };
}
