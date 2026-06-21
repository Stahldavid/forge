import { FORGE_TENANT_SCOPE_VIOLATION } from "../../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { DbTransaction } from "./adapter.ts";
import type { AuthContext } from "../auth/types.ts";
import type { WriteTracker } from "../live/types.ts";
import { tenantIdFromAuth } from "../live/dependency-tracker.ts";

export class TenantScopeViolationError extends Error {
  readonly code = FORGE_TENANT_SCOPE_VIOLATION;
  readonly table: string;
  readonly operation: string;

  constructor(table: string, operation: string, message: string) {
    super(message);
    this.name = "TenantScopeViolationError";
    this.table = table;
    this.operation = operation;
  }
}

export interface TableClient {
  all(): Promise<Record<string, unknown>[]>;
  get(id: string): Promise<Record<string, unknown> | null>;
  insert(value: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(
    id: string,
    patch: Partial<Record<string, unknown>>,
  ): Promise<Record<string, unknown> | null>;
  delete(id: string): Promise<boolean>;
  where(partial: Partial<Record<string, unknown>>): Promise<Record<string, unknown>[]>;
}

export type DbClient = Record<string, TableClient>;

export interface GeneratedDbClientOptions {
  auth?: AuthContext;
  writeTracker?: WriteTracker;
}

function camelCase(value: string): string {
  return value.replace(/[_-]([a-zA-Z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function resolveTenantId(
  auth: AuthContext | undefined,
  entry: TableMapEntry,
): string | null {
  if (!entry.tenantScoped || !entry.tenantIdColumn) {
    return null;
  }

  if (auth?.kind === "user") {
    return auth.tenantId ?? null;
  }

  if (auth?.kind === "system" && auth.tenantId) {
    return auth.tenantId;
  }

  return null;
}

function createTableClient(
  tx: DbTransaction,
  tableName: string,
  entry: TableMapEntry,
  options?: GeneratedDbClientOptions,
): TableClient {
  const columns = entry.columns.map((column) => column.name);
  const columnByInputName = new Map<string, string>();
  const fieldNameByColumn = new Map<string, string>();
  for (const column of entry.columns) {
    columnByInputName.set(column.name, column.name);
    if (column.fieldName) {
      columnByInputName.set(column.fieldName, column.name);
      fieldNameByColumn.set(column.name, column.fieldName);
    }
  }
  const primaryKey = entry.columns.find((column) => column.primaryKey)?.name ?? "id";
  const tenantColumn = entry.tenantIdColumn;
  const tenantId = resolveTenantId(options?.auth, entry);
  const writeTenantId = tenantId ?? tenantIdFromAuth(options?.auth);

  function tenantViolation(operation: string): never {
    throw new TenantScopeViolationError(
      tableName,
      operation,
      `tenant scope violation on ${tableName}.${operation}`,
    );
  }

  function normalizeInput(value: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const column = columnByInputName.get(key);
      if (column) {
        normalized[column] = item;
      }
    }
    return normalized;
  }

  function normalizeRow(row: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!row) {
      return undefined;
    }

    const normalized = { ...row };
    for (const [column, fieldName] of fieldNameByColumn) {
      if (normalized[fieldName] === undefined && normalized[column] !== undefined) {
        normalized[fieldName] = normalized[column];
      }
    }
    return normalized;
  }

  function normalizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return rows.map((row) => normalizeRow(row) ?? row);
  }

  function enforceTenantValue(value: Record<string, unknown>, operation: string): Record<string, unknown> {
    if (!tenantColumn || !entry.tenantScoped) {
      return value;
    }

    if (options?.auth?.kind !== "user") {
      return value;
    }

    const provided = value[tenantColumn];
    if (provided === undefined) {
      return { ...value, [tenantColumn]: tenantId };
    }

    if (provided !== tenantId) {
      tenantViolation(operation);
    }

    return value;
  }

  function tenantWhereClause(startIndex = 1): { clause: string; params: unknown[] } {
    if (!tenantColumn || !tenantId || options?.auth?.kind !== "user") {
      return { clause: "", params: [] };
    }

    return {
      clause: `${quoteIdent(tenantColumn)} = $${startIndex}`,
      params: [tenantId],
    };
  }

  return {
    async all() {
      const tenantFilter = tenantWhereClause(1);
      const where = tenantFilter.clause ? ` WHERE ${tenantFilter.clause}` : "";
      const result = await tx.query(
        `SELECT * FROM ${quoteIdent(tableName)}${where}`,
        tenantFilter.params,
      );
      return normalizeRows(result.rows);
    },

    async get(id) {
      const tenantFilter = tenantWhereClause(2);
      const whereParts = [`${quoteIdent(primaryKey)} = $1`];
      const params: unknown[] = [id];
      if (tenantFilter.clause) {
        whereParts.push(tenantFilter.clause.replace("$1", "$2"));
        params.push(...tenantFilter.params);
      }

      const result = await tx.query(
        `SELECT * FROM ${quoteIdent(tableName)} WHERE ${whereParts.join(" AND ")} LIMIT 1`,
        params,
      );
      return normalizeRow(result.rows[0]) ?? null;
    },

    async insert(value) {
      const normalized = enforceTenantValue(normalizeInput(value), "insert");
      const keys = columns.filter((column) => normalized[column] !== undefined);
      const placeholders = keys.map((_, index) => `$${index + 1}`);
      const params = keys.map((key) => normalized[key]);

      const result = await tx.query(
        `INSERT INTO ${quoteIdent(tableName)} (${keys.map(quoteIdent).join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
        params,
      );
      options?.writeTracker?.record(tableName, writeTenantId, "insert");
      return normalizeRow(result.rows[0]) ?? normalizeRow(normalized) ?? normalized;
    },

    async update(id, patch) {
      const normalizedPatch = normalizeInput(patch);
      if (
        tenantColumn &&
        normalizedPatch[tenantColumn] !== undefined &&
        normalizedPatch[tenantColumn] !== tenantId
      ) {
        tenantViolation("update");
      }

      const keys = Object.keys(normalizedPatch).filter((key) => columns.includes(key));
      if (keys.length === 0) {
        return this.get(id);
      }

      const tenantFilter = tenantWhereClause(keys.length + 2);
      const assignments = keys.map((key, index) => `${quoteIdent(key)} = $${index + 1}`);
      const params = [...keys.map((key) => normalizedPatch[key]), id];
      const whereParts = [`${quoteIdent(primaryKey)} = $${keys.length + 1}`];
      if (tenantFilter.clause) {
        whereParts.push(tenantFilter.clause);
        params.push(...tenantFilter.params);
      }

      const result = await tx.query(
        `UPDATE ${quoteIdent(tableName)} SET ${assignments.join(", ")} WHERE ${whereParts.join(" AND ")} RETURNING *`,
        params,
      );
      if ((result.rowCount ?? result.rows.length) > 0) {
        options?.writeTracker?.record(tableName, writeTenantId, "update");
        if (!result.rows[0]) {
          return this.get(id);
        }
      }
      return normalizeRow(result.rows[0]) ?? null;
    },

    async delete(id) {
      const tenantFilter = tenantWhereClause(2);
      const whereParts = [`${quoteIdent(primaryKey)} = $1`];
      const params: unknown[] = [id];
      if (tenantFilter.clause) {
        whereParts.push(tenantFilter.clause.replace("$1", "$2"));
        params.push(...tenantFilter.params);
      }

      const result = await tx.query(
        `DELETE FROM ${quoteIdent(tableName)} WHERE ${whereParts.join(" AND ")}`,
        params,
      );
      if (result.rowCount > 0) {
        options?.writeTracker?.record(tableName, writeTenantId, "delete");
      }
      return result.rowCount > 0;
    },

    async where(partial) {
      const normalizedPartial = normalizeInput(partial);
      if (
        tenantColumn &&
        normalizedPartial[tenantColumn] !== undefined &&
        normalizedPartial[tenantColumn] !== tenantId
      ) {
        tenantViolation("where");
      }

      const keys = Object.keys(normalizedPartial).filter((key) => columns.includes(key));
      const tenantFilter = tenantWhereClause(keys.length + 1);
      const clauses = keys.map((key, index) => `${quoteIdent(key)} = $${index + 1}`);
      const params = keys.map((key) => normalizedPartial[key]);
      if (tenantFilter.clause) {
        clauses.push(tenantFilter.clause.replace("$1", `$${keys.length + 1}`));
        params.push(...tenantFilter.params);
      }

      if (clauses.length === 0 && !tenantFilter.clause) {
        return this.all();
      }

      const result = await tx.query(
        `SELECT * FROM ${quoteIdent(tableName)} WHERE ${clauses.join(" AND ")}`,
        params,
      );
      return normalizeRows(result.rows);
    },
  };
}

export function createGeneratedDbClient(
  tx: DbTransaction,
  tableMap: Record<string, TableMapEntry>,
  options?: GeneratedDbClientOptions,
): DbClient {
  const client: DbClient = {};

  for (const [accessName, entry] of Object.entries(tableMap).sort()) {
    const tableClient = createTableClient(tx, entry.tableName, entry, options);
    client[accessName] = tableClient;

    for (const alias of new Set([camelCase(accessName), camelCase(entry.tableName)])) {
      if (alias && client[alias] === undefined) {
        client[alias] = tableClient;
      }
    }
  }

  return client;
}
