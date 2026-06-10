import type { Diagnostic } from "../../types/diagnostic.ts";

export type RlsTenantType = "uuid" | "text";
export type RlsOperation = "select" | "insert" | "update" | "delete";

export interface RlsPolicy {
  table: string;
  tenantColumn: string;
  tenantType: RlsTenantType;
  operation: RlsOperation;
  policyName: string;
  using?: string;
  withCheck?: string;
}

export interface RlsTableSecurity {
  table: string;
  tenantColumn: string;
  tenantType: RlsTenantType;
  rowLevelSecurityEnabled: boolean;
  forceRowLevelSecurity: boolean;
  policies: RlsPolicy[];
}

export interface RlsPoliciesArtifact {
  schemaVersion: "0.1.0";
  tables: RlsTableSecurity[];
  sql: string;
  diagnostics: Diagnostic[];
}

export interface DbSecurityManifest {
  schemaVersion: "0.1.0";
  provider: "postgres";
  tenantIsolation: "postgres-rls";
  authoritativeAdapters: ["postgres"];
  nonAuthoritativeAdapters: ["pglite", "memory"];
  tables: RlsTableSecurity[];
  diagnostics: Diagnostic[];
}

export interface DbSessionSetting {
  name: string;
  required: boolean;
  source: "ctx.auth";
  transactionScoped: true;
}

export interface DbSessionContextArtifact {
  schemaVersion: "0.1.0";
  method: "set_config";
  transactionScoped: true;
  settings: DbSessionSetting[];
  diagnostics: Diagnostic[];
}

export interface RlsArtifacts {
  policies: RlsPoliciesArtifact;
  dbSecurityManifest: DbSecurityManifest;
  dbSessionContext: DbSessionContextArtifact;
  diagnostics: Diagnostic[];
}
