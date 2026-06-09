import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { DbTransaction } from "./adapter.ts";

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

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function createTableClient(
  tx: DbTransaction,
  tableName: string,
  entry: TableMapEntry,
): TableClient {
  const columns = entry.columns.map((column) => column.name);
  const primaryKey = entry.columns.find((column) => column.primaryKey)?.name ?? "id";

  return {
    async all() {
      const result = await tx.query(`SELECT * FROM ${quoteIdent(tableName)}`);
      return result.rows;
    },

    async get(id) {
      const result = await tx.query(
        `SELECT * FROM ${quoteIdent(tableName)} WHERE ${quoteIdent(primaryKey)} = $1 LIMIT 1`,
        [id],
      );
      return result.rows[0] ?? null;
    },

    async insert(value) {
      const keys = columns.filter((column) => value[column] !== undefined);
      const placeholders = keys.map((_, index) => `$${index + 1}`);
      const params = keys.map((key) => value[key]);

      const result = await tx.query(
        `INSERT INTO ${quoteIdent(tableName)} (${keys.map(quoteIdent).join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
        params,
      );
      return result.rows[0] ?? value;
    },

    async update(id, patch) {
      const keys = Object.keys(patch).filter((key) => columns.includes(key));
      if (keys.length === 0) {
        return this.get(id);
      }

      const assignments = keys.map((key, index) => `${quoteIdent(key)} = $${index + 1}`);
      const params = [...keys.map((key) => patch[key]), id];

      const result = await tx.query(
        `UPDATE ${quoteIdent(tableName)} SET ${assignments.join(", ")} WHERE ${quoteIdent(primaryKey)} = $${keys.length + 1} RETURNING *`,
        params,
      );
      return result.rows[0] ?? null;
    },

    async delete(id) {
      const result = await tx.query(
        `DELETE FROM ${quoteIdent(tableName)} WHERE ${quoteIdent(primaryKey)} = $1`,
        [id],
      );
      return result.rowCount > 0;
    },

    async where(partial) {
      const keys = Object.keys(partial).filter((key) => columns.includes(key));
      if (keys.length === 0) {
        return this.all();
      }

      const clauses = keys.map((key, index) => `${quoteIdent(key)} = $${index + 1}`);
      const params = keys.map((key) => partial[key]);

      const result = await tx.query(
        `SELECT * FROM ${quoteIdent(tableName)} WHERE ${clauses.join(" AND ")}`,
        params,
      );
      return result.rows;
    },
  };
}

export function createGeneratedDbClient(
  tx: DbTransaction,
  tableMap: Record<string, TableMapEntry>,
): DbClient {
  const client: DbClient = {};

  for (const [tableName, entry] of Object.entries(tableMap).sort()) {
    client[tableName] = createTableClient(tx, tableName, entry);
  }

  return client;
}
