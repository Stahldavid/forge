import type { Diagnostic } from "./diagnostic.ts";

export interface PolicyRule {
  name: string;
  kind: "roles" | "permissions" | "public" | "system";
  roles: string[];
  permissions: string[];
  file: string;
  symbolId: string;
}

export interface CommandAuthBinding {
  commandName: string;
  file: string;
  symbolId: string;
  auth:
    | { kind: "policy"; policy: string }
    | { kind: "public" }
    | { kind: "system" }
    | { kind: "user" };
}

export interface QueryAuthBinding {
  queryName: string;
  file: string;
  symbolId: string;
  auth:
    | { kind: "policy"; policy: string }
    | { kind: "public" }
    | { kind: "system" }
    | { kind: "user" };
}

export interface PermissionMatrixEntry {
  policy: string;
  roles: string[];
  permissions: string[];
}

export interface TenantScopeEntry {
  table: string;
  exportName: string;
  tenantIdColumn: string;
  file: string;
}

export interface PolicyRegistry {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  policies: PolicyRule[];
  commandAuth: CommandAuthBinding[];
  queryAuth: QueryAuthBinding[];
  diagnostics: Diagnostic[];
}

export interface PermissionMatrix {
  schemaVersion: string;
  generatorVersion: string;
  inputHash: string;
  entries: PermissionMatrixEntry[];
}

export interface TenantScope {
  schemaVersion: string;
  generatorVersion: string;
  inputHash: string;
  tables: TenantScopeEntry[];
  diagnostics: Diagnostic[];
}
