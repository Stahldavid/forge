import type { Diagnostic } from "../../types/diagnostic.ts";

export interface ColumnDef {
  name: string;
  fieldName?: string;
  sqlType: string;
  nullable: boolean;
  primaryKey?: boolean;
  defaultExpr?: string;
  references?: { table: string; column: string };
  checkConstraint?: string;
}

export interface IndexDef {
  name: string;
  table: string;
  columns: string[];
  unique?: boolean;
}

export interface SqlChange {
  kind: "create_table" | "create_index" | "create_sequence";
  table?: string;
  columns?: ColumnDef[];
  index?: IndexDef;
  sql: string;
}

export interface SqlPlan {
  schemaVersion: string;
  migrationId: string;
  checksum: string;
  systemTables: SqlChange[];
  tables: SqlChange[];
  indexes: SqlChange[];
  diagnostics: Diagnostic[];
}
