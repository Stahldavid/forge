import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../compiler/primitives/header.ts";
import type {
  CommandAuthBinding,
  PermissionMatrix,
  PolicyRegistry,
  QueryAuthBinding,
  TenantScope,
} from "../../compiler/types/policy-registry.ts";

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!existsSync(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader(readFileSync(absolute, "utf8"));
  return JSON.parse(raw) as T;
}

export function loadPolicyRegistry(workspaceRoot: string): PolicyRegistry | null {
  return readGeneratedJson<PolicyRegistry>(
    workspaceRoot,
    `${GENERATED_DIR}/policyRegistry.json`,
  );
}

export function loadPermissionMatrix(workspaceRoot: string): PermissionMatrix | null {
  return readGeneratedJson<PermissionMatrix>(
    workspaceRoot,
    `${GENERATED_DIR}/permissionMatrix.json`,
  );
}

export function loadTenantScope(workspaceRoot: string): TenantScope | null {
  return readGeneratedJson<TenantScope>(
    workspaceRoot,
    `${GENERATED_DIR}/tenantScope.json`,
  );
}

export function findCommandAuthBinding(
  registry: PolicyRegistry | null,
  commandName: string,
): CommandAuthBinding | undefined {
  return registry?.commandAuth.find((binding) => binding.commandName === commandName);
}

export function findQueryAuthBinding(
  registry: PolicyRegistry | null,
  queryName: string,
): QueryAuthBinding | undefined {
  return registry?.queryAuth?.find((binding) => binding.queryName === queryName);
}
