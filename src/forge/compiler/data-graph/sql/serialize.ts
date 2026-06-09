import { serializeCanonical } from "../../primitives/serialize.ts";
import type { SqlPlan } from "./types.ts";

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
}

export function buildTableMap(plan: SqlPlan): Record<string, TableMapEntry> {
  const map: Record<string, TableMapEntry> = {};

  for (const change of plan.tables) {
    if (!change.table || !change.columns) {
      continue;
    }
    map[change.table] = {
      tableName: change.table,
      columns: change.columns.map((column) => ({
        name: column.name,
        sqlType: column.sqlType,
        ...(column.primaryKey ? { primaryKey: true } : {}),
      })),
    };
  }

  return map;
}

export function serializeDbJson(plan: SqlPlan): string {
  const tableMap = buildTableMap(plan);
  return serializeCanonical({ tableMap });
}

export function serializeDbTs(plan: SqlPlan): string {
  const tableMap = buildTableMap(plan);
  return `export const tableMap = ${JSON.stringify(tableMap, null, 2)} as const;\n`;
}
