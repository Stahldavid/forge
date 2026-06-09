import {
  FORGE_QUERY_AI_FORBIDDEN,
  FORGE_QUERY_EMIT_FORBIDDEN,
  FORGE_QUERY_SECRET_FORBIDDEN,
  FORGE_QUERY_WRITE_FORBIDDEN,
} from "../../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { DbTransaction } from "./adapter.ts";
import {
  createGeneratedDbClient,
  type TableClient,
} from "./generated-client.ts";
import type { AuthContext } from "../auth/types.ts";

export interface ReadOnlyTableClient {
  all(): Promise<Record<string, unknown>[]>;
  get(id: string): Promise<Record<string, unknown> | null>;
  where(partial: Partial<Record<string, unknown>>): Promise<Record<string, unknown>[]>;
  count(): Promise<number>;
}

export type ReadOnlyDbClient = Record<string, ReadOnlyTableClient>;

function forbidden(operation: string): never {
  const code =
    operation === "emit"
      ? FORGE_QUERY_EMIT_FORBIDDEN
      : operation === "secrets"
        ? FORGE_QUERY_SECRET_FORBIDDEN
        : operation === "ai"
          ? FORGE_QUERY_AI_FORBIDDEN
          : FORGE_QUERY_WRITE_FORBIDDEN;
  throw new Error(`${code}: ${operation} is forbidden in query context`);
}

function wrapReadOnlyTable(table: TableClient): ReadOnlyTableClient {
  return {
    all: () => table.all(),
    get: (id) => table.get(id),
    where: (partial) => table.where(partial),
    count: async () => {
      const rows = await table.all();
      return rows.length;
    },
  };
}

export function createReadOnlyDbClient(
  tx: DbTransaction,
  tableMap: Record<string, TableMapEntry>,
  options?: { auth?: AuthContext },
): ReadOnlyDbClient {
  const writable = createGeneratedDbClient(tx, tableMap, options);
  const client: ReadOnlyDbClient = {};

  for (const [tableName, table] of Object.entries(writable).sort()) {
    client[tableName] = wrapReadOnlyTable(table);
  }

  return client;
}

export function assertQueryContextForbidden(property: "emit" | "secrets" | "ai"): void {
  forbidden(property);
}
