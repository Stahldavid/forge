import { serializeCanonical } from "../../primitives/serialize.ts";
import type { SqlPlan } from "./types.ts";
import type { TenantScope } from "../../types/policy-registry.ts";

export function serializeSqlPlanJson(plan: SqlPlan): string {
  const payload = {
    schemaVersion: plan.schemaVersion,
    migrationId: plan.migrationId,
    checksum: plan.checksum,
    systemTables: plan.systemTables.map((change) => ({
      kind: change.kind,
      table: change.table,
      sql: change.sql,
    })),
    tables: plan.tables.map((change) => ({
      kind: change.kind,
      table: change.table,
      columns: change.columns,
      sql: change.sql,
    })),
    indexes: plan.indexes.map((change) => ({
      kind: change.kind,
      table: change.table,
      index: change.index,
      sql: change.sql,
    })),
  };
  return serializeCanonical(payload);
}

export function serializeSqlPlanTs(plan: SqlPlan): string {
  const parsed: unknown = JSON.parse(serializeSqlPlanJson(plan).trimEnd());
  return `export const sqlPlan = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export interface TableMapEntry {
  tableName: string;
  columns: { name: string; sqlType: string; primaryKey?: boolean }[];
  tenantScoped?: boolean;
  tenantIdColumn?: string;
}

export function buildTableMap(
  plan: SqlPlan,
  tenantScope?: TenantScope,
): Record<string, TableMapEntry> {
  const map: Record<string, TableMapEntry> = {};
  const scopeByTable = new Map(
    (tenantScope?.tables ?? []).map((entry) => [entry.table, entry.tenantIdColumn]),
  );

  for (const change of plan.tables) {
    if (!change.table || !change.columns) {
      continue;
    }
    const tenantIdColumn = scopeByTable.get(change.table);
    map[change.table] = {
      tableName: change.table,
      columns: change.columns.map((column) => ({
        name: column.name,
        sqlType: column.sqlType,
        ...(column.primaryKey ? { primaryKey: true } : {}),
      })),
      ...(tenantIdColumn
        ? { tenantScoped: true, tenantIdColumn }
        : {}),
    };
  }

  return map;
}

export function serializeDbJson(plan: SqlPlan, tenantScope?: TenantScope): string {
  const tableMap = buildTableMap(plan, tenantScope);
  return serializeCanonical({ tableMap });
}

export function serializeDbTs(plan: SqlPlan, tenantScope?: TenantScope): string {
  const tableMap = buildTableMap(plan, tenantScope);
  return `export const tableMap = ${JSON.stringify(tableMap, null, 2)} as const;\n`;
}
