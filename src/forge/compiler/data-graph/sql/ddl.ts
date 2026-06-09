import { createDiagnostic } from "../../diagnostics/create.ts";
import {
  FORGE_DB_INVALID_SQL_PLAN,
  FORGE_DB_UNSUPPORTED_FIELD_TYPE,
} from "../../diagnostics/codes.ts";
import { hashStable } from "../../primitives/hash.ts";
import { canonicalJson } from "../../primitives/serialize.ts";
import type { DataField, DataGraph, DataTable } from "../../types/data-graph.ts";
import type { Diagnostic } from "../../types/diagnostic.ts";
import { quoteIdent, toSnakeCase } from "./naming.ts";
import type { ColumnDef, IndexDef, SqlChange, SqlPlan } from "./types.ts";

export const SQL_PLAN_SCHEMA_VERSION = "1.0.0";

const SYSTEM_MIGRATIONS_SQL = `CREATE TABLE IF NOT EXISTS _forge_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;

const SYSTEM_OUTBOX_SQL = `CREATE TABLE IF NOT EXISTS _forge_outbox (id bigserial PRIMARY KEY, event_type text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;

const SYSTEM_OUTBOX_DELIVERIES_SQL = `CREATE TABLE IF NOT EXISTS _forge_outbox_deliveries (id bigserial PRIMARY KEY, outbox_id bigint NOT NULL REFERENCES _forge_outbox(id), action_name text NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5, next_attempt_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz, locked_by text, last_error text, processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(outbox_id, action_name))`;

const SYSTEM_WORKFLOW_RUNS_SQL = `CREATE TABLE IF NOT EXISTS _forge_workflow_runs (id bigserial PRIMARY KEY, workflow_name text NOT NULL, trigger_type text NOT NULL, trigger_outbox_id bigint, idempotency_key text NOT NULL UNIQUE, input jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', current_step text, last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz, canceled_at timestamptz)`;

const SYSTEM_WORKFLOW_STEPS_SQL = `CREATE TABLE IF NOT EXISTS _forge_workflow_steps (id bigserial PRIMARY KEY, run_id bigint NOT NULL REFERENCES _forge_workflow_runs(id), step_name text NOT NULL, step_index integer NOT NULL, status text NOT NULL DEFAULT 'pending', input jsonb, output jsonb, attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5, next_attempt_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz, locked_by text, last_error text, started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id, step_name))`;

interface ParsedFieldType {
  sqlType: string;
  references?: { table: string; column: string };
  checkConstraint?: string;
}

function stableSortTables(tables: DataTable[]): DataTable[] {
  return [...tables].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function parseFieldType(
  field: DataField,
  tableName: string,
  diagnostics: Diagnostic[],
): ParsedFieldType | null {
  const raw = field.type.trim().toLowerCase();

  if (raw === "uuid") {
    return { sqlType: "uuid" };
  }
  if (raw === "text" || raw === "string") {
    return { sqlType: "text" };
  }
  if (raw === "number") {
    return { sqlType: "double precision" };
  }
  if (raw === "integer" || raw === "int") {
    return { sqlType: "integer" };
  }
  if (raw === "boolean" || raw === "bool") {
    return { sqlType: "boolean" };
  }
  if (raw === "timestamp") {
    return { sqlType: "timestamptz" };
  }
  if (raw === "json") {
    return { sqlType: "jsonb" };
  }

  if (raw.startsWith("enum:")) {
    const values = raw
      .slice("enum:".length)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length === 0) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: FORGE_DB_UNSUPPORTED_FIELD_TYPE,
          message: `unsupported enum field type '${field.type}' on ${tableName}.${field.name}`,
        }),
      );
      return null;
    }
    const checkValues = values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
    return {
      sqlType: "text",
      checkConstraint: `${quoteIdent(toSnakeCase(field.name))} IN (${checkValues})`,
    };
  }

  if (raw.startsWith("enum_")) {
    return { sqlType: "text" };
  }

  if (raw.startsWith("ref:")) {
    const refTable = raw.slice("ref:".length).trim();
    if (!refTable) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: FORGE_DB_UNSUPPORTED_FIELD_TYPE,
          message: `invalid ref field type '${field.type}' on ${tableName}.${field.name}`,
        }),
      );
      return null;
    }
    return {
      sqlType: "uuid",
      references: { table: toSnakeCase(refTable), column: "id" },
    };
  }

  if (raw === "ref") {
    return {
      sqlType: "uuid",
      references: { table: toSnakeCase(field.name.replace(/Id$/i, "")), column: "id" },
    };
  }

  diagnostics.push(
    createDiagnostic({
      severity: "error",
      code: FORGE_DB_UNSUPPORTED_FIELD_TYPE,
      message: `unsupported field type '${field.type}' on ${tableName}.${field.name}`,
    }),
  );
  return null;
}

function defaultExprForField(field: DataField): string | undefined {
  const name = field.name;
  const type = field.type.trim().toLowerCase();

  if (name === "id" && type === "uuid") {
    return "gen_random_uuid()";
  }

  if (
    (name === "createdAt" || name === "updatedAt") &&
    (type === "timestamp" || type === "timestamptz")
  ) {
    return "now()";
  }

  return undefined;
}

function buildColumns(table: DataTable, diagnostics: Diagnostic[]): ColumnDef[] {
  const columns: ColumnDef[] = [];
  const fields = [...table.fields].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );

  const hasIdField = fields.some((field) => field.name === "id");
  if (!hasIdField) {
    columns.push({
      name: "id",
      sqlType: "uuid",
      nullable: false,
      primaryKey: true,
      defaultExpr: "gen_random_uuid()",
    });
  }

  for (const field of fields) {
    const parsed = parseFieldType(field, table.name, diagnostics);
    if (!parsed) {
      continue;
    }

    const snakeName = toSnakeCase(field.name);
    const defaultExpr = defaultExprForField(field);
    const isPrimaryKey = field.name === "id" && parsed.sqlType === "uuid";

    columns.push({
      name: snakeName,
      sqlType: parsed.sqlType,
      nullable: false,
      primaryKey: isPrimaryKey,
      defaultExpr,
      references: parsed.references,
      checkConstraint: parsed.checkConstraint,
    });
  }

  if (!columns.some((column) => column.primaryKey) && columns.length > 0) {
    columns[0]!.primaryKey = true;
  }

  return columns;
}

function renderColumn(column: ColumnDef): string {
  const parts = [
    quoteIdent(column.name),
    column.sqlType,
    column.nullable ? "" : "NOT NULL",
    column.defaultExpr ? `DEFAULT ${column.defaultExpr}` : "",
    column.primaryKey ? "PRIMARY KEY" : "",
    column.references
      ? `REFERENCES ${quoteIdent(column.references.table)} (${quoteIdent(column.references.column)})`
      : "",
    column.checkConstraint ? `CHECK (${column.checkConstraint})` : "",
  ].filter((part) => part.length > 0);

  return parts.join(" ");
}

function buildCreateTableSql(tableName: string, columns: ColumnDef[]): string {
  const rendered = columns.map(renderColumn).join(", ");
  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(tableName)} (${rendered})`;
}

function buildForeignKeyIndexes(tableName: string, columns: ColumnDef[]): IndexDef[] {
  const indexes: IndexDef[] = [];

  for (const column of columns) {
    if (column.references) {
      indexes.push({
        name: `idx_${tableName}_${column.name}`,
        table: tableName,
        columns: [column.name],
      });
    }
  }

  return indexes;
}

function buildTableChange(table: DataTable, diagnostics: Diagnostic[]): SqlChange | null {
  const tableName = toSnakeCase(table.name);
  const columns = buildColumns(table, diagnostics);

  if (columns.length === 0) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: FORGE_DB_INVALID_SQL_PLAN,
        message: `table '${table.name}' has no valid columns`,
        file: table.file,
      }),
    );
    return null;
  }

  return {
    kind: "create_table",
    table: tableName,
    columns,
    sql: buildCreateTableSql(tableName, columns),
  };
}

function buildIndexChange(index: IndexDef): SqlChange {
  const columns = index.columns.map(quoteIdent).join(", ");
  const unique = index.unique ? "UNIQUE " : "";
  return {
    kind: "create_index",
    table: index.table,
    index,
    sql: `CREATE INDEX IF NOT EXISTS ${quoteIdent(index.name)} ON ${quoteIdent(index.table)} ${unique}(${columns})`,
  };
}

export function buildSqlPlan(dataGraph: DataGraph): SqlPlan {
  const diagnostics: Diagnostic[] = [];
  const tables: SqlChange[] = [];
  const indexes: SqlChange[] = [];

  const systemTables: SqlChange[] = [
    {
      kind: "create_table",
      table: "_forge_migrations",
      sql: SYSTEM_MIGRATIONS_SQL,
    },
    {
      kind: "create_table",
      table: "_forge_outbox",
      sql: SYSTEM_OUTBOX_SQL,
    },
    {
      kind: "create_table",
      table: "_forge_outbox_deliveries",
      sql: SYSTEM_OUTBOX_DELIVERIES_SQL,
    },
    {
      kind: "create_table",
      table: "_forge_workflow_runs",
      sql: SYSTEM_WORKFLOW_RUNS_SQL,
    },
    {
      kind: "create_table",
      table: "_forge_workflow_steps",
      sql: SYSTEM_WORKFLOW_STEPS_SQL,
    },
  ];

  for (const table of stableSortTables(dataGraph.tables)) {
    const change = buildTableChange(table, diagnostics);
    if (!change) {
      continue;
    }
    tables.push(change);

    if (change.columns) {
      for (const index of buildForeignKeyIndexes(change.table!, change.columns)) {
        indexes.push(buildIndexChange(index));
      }
    }
  }

  indexes.sort((a, b) => {
    const nameA = a.index?.name ?? "";
    const nameB = b.index?.name ?? "";
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
  });

  const payload = {
    schemaVersion: SQL_PLAN_SCHEMA_VERSION,
    systemTables: systemTables.map((change) => change.sql),
    tables: tables.map((change) => change.sql),
    indexes: indexes.map((change) => change.sql),
  };

  const checksum = hashStable(canonicalJson(payload));
  const migrationId = `migration_${checksum.slice(0, 16)}`;

  return {
    schemaVersion: SQL_PLAN_SCHEMA_VERSION,
    migrationId,
    checksum,
    systemTables,
    tables,
    indexes,
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
