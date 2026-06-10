import { createDiagnostic } from "../../diagnostics/create.ts";
import {
  FORGE_RLS_TENANT_FIELD_MISSING,
  FORGE_RLS_UNSUPPORTED_TENANT_TYPE,
} from "../../diagnostics/codes.ts";
import type { SqlChange, SqlPlan } from "../sql/types.ts";
import { quoteIdent } from "../sql/naming.ts";
import type { TenantScope } from "../../types/policy-registry.ts";
import type { Diagnostic } from "../../types/diagnostic.ts";
import type {
  DbSecurityManifest,
  DbSessionContextArtifact,
  RlsArtifacts,
  RlsOperation,
  RlsPolicy,
  RlsTableSecurity,
  RlsTenantType,
} from "./types.ts";

const OPERATIONS: RlsOperation[] = ["select", "insert", "update", "delete"];

function tenantTypeFromSqlType(sqlType: string): RlsTenantType | null {
  if (sqlType === "uuid") {
    return "uuid";
  }
  if (sqlType === "text") {
    return "text";
  }
  return null;
}

function findTable(plan: SqlPlan, tableName: string): SqlChange | undefined {
  return plan.tables.find((change) => change.table === tableName);
}

function tenantExpression(tenantColumn: string, tenantType: RlsTenantType): string {
  const right =
    tenantType === "uuid" ? "forge.current_tenant_id()" : "forge.current_tenant_text()";
  return `${quoteIdent(tenantColumn)} = ${right}`;
}

function policyName(table: string, operation: RlsOperation): string {
  return `forge_${table}_${operation}`;
}

function buildPolicy(
  table: string,
  tenantColumn: string,
  tenantType: RlsTenantType,
  operation: RlsOperation,
): RlsPolicy {
  const expression = tenantExpression(tenantColumn, tenantType);
  const base = {
    table,
    tenantColumn,
    tenantType,
    operation,
    policyName: policyName(table, operation),
  };

  if (operation === "insert") {
    return { ...base, withCheck: expression };
  }
  if (operation === "update") {
    return { ...base, using: expression, withCheck: expression };
  }
  return { ...base, using: expression };
}

function renderPolicySql(table: string, policy: RlsPolicy): string {
  const lines = [
    `DROP POLICY IF EXISTS ${quoteIdent(policy.policyName)} ON ${quoteIdent(table)};`,
    `CREATE POLICY ${quoteIdent(policy.policyName)}`,
    `ON ${quoteIdent(table)}`,
    `FOR ${policy.operation.toUpperCase()}`,
  ];

  if (policy.using) {
    lines.push(`USING (${policy.using})`);
  }
  if (policy.withCheck) {
    lines.push(`WITH CHECK (${policy.withCheck})`);
  }

  return `${lines.join("\n")};`;
}

function renderRlsSql(tables: RlsTableSecurity[]): string {
  const header = `CREATE SCHEMA IF NOT EXISTS forge;

CREATE OR REPLACE FUNCTION forge.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('forge.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION forge.current_tenant_text()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('forge.tenant_id', true), '')
$$;

CREATE OR REPLACE FUNCTION forge.current_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('forge.user_id', true), '')
$$;

CREATE OR REPLACE FUNCTION forge.current_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('forge.role', true), '')
$$;`;

  const sections = tables.map((table) => {
    const tableName = quoteIdent(table.table);
    return [
      `ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY;`,
      ...table.policies.map((policy) => renderPolicySql(table.table, policy)),
    ].join("\n\n");
  });

  return [header, ...sections].join("\n\n").trimEnd().concat("\n");
}

function buildSessionContext(): DbSessionContextArtifact {
  return {
    schemaVersion: "0.1.0",
    method: "set_config",
    transactionScoped: true,
    settings: [
      { name: "forge.tenant_id", required: true, source: "ctx.auth", transactionScoped: true },
      { name: "forge.user_id", required: false, source: "ctx.auth", transactionScoped: true },
      { name: "forge.role", required: false, source: "ctx.auth", transactionScoped: true },
      { name: "forge.roles", required: false, source: "ctx.auth", transactionScoped: true },
      { name: "forge.permissions", required: false, source: "ctx.auth", transactionScoped: true },
    ],
    diagnostics: [],
  };
}

export function buildRlsArtifacts(plan: SqlPlan, tenantScope: TenantScope): RlsArtifacts {
  const diagnostics: Diagnostic[] = [];
  const tables: RlsTableSecurity[] = [];

  for (const scoped of [...tenantScope.tables].sort((a, b) => a.table.localeCompare(b.table))) {
    const table = findTable(plan, scoped.table);
    const column = table?.columns?.find(
      (candidate) => candidate.name === scoped.tenantIdColumn,
    );

    if (!table || !column) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: FORGE_RLS_TENANT_FIELD_MISSING,
          message: `tenant-scoped table '${scoped.table}' is missing tenant column '${scoped.tenantIdColumn}' in the SQL plan`,
          file: scoped.file,
        }),
      );
      continue;
    }

    const tenantType = tenantTypeFromSqlType(column.sqlType);
    if (!tenantType) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: FORGE_RLS_UNSUPPORTED_TENANT_TYPE,
          message: `tenant column '${scoped.table}.${scoped.tenantIdColumn}' uses unsupported SQL type '${column.sqlType}' for RLS`,
          file: scoped.file,
        }),
      );
      continue;
    }

    tables.push({
      table: scoped.table,
      tenantColumn: scoped.tenantIdColumn,
      tenantType,
      rowLevelSecurityEnabled: true,
      forceRowLevelSecurity: true,
      policies: OPERATIONS.map((operation) =>
        buildPolicy(scoped.table, scoped.tenantIdColumn, tenantType, operation),
      ),
    });
  }

  const sortedTables = tables.sort((a, b) => a.table.localeCompare(b.table));
  const policies = {
    schemaVersion: "0.1.0" as const,
    tables: sortedTables,
    sql: renderRlsSql(sortedTables),
    diagnostics,
  };
  const dbSecurityManifest: DbSecurityManifest = {
    schemaVersion: "0.1.0",
    provider: "postgres",
    tenantIsolation: "postgres-rls",
    authoritativeAdapters: ["postgres"],
    nonAuthoritativeAdapters: ["pglite", "memory"],
    tables: sortedTables,
    diagnostics,
  };
  const dbSessionContext = buildSessionContext();

  return {
    policies,
    dbSecurityManifest,
    dbSessionContext,
    diagnostics,
  };
}
