import {
  FORGE_QUERY_AI_FORBIDDEN,
  FORGE_QUERY_EMIT_FORBIDDEN,
  FORGE_QUERY_SECRET_FORBIDDEN,
  FORGE_QUERY_WRITE_FORBIDDEN,
  FORGE_LIVEQUERY_WRITE_FORBIDDEN,
} from "../../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { DbTransaction } from "./adapter.ts";
import {
  createGeneratedDbClient,
  type TableClient,
} from "./generated-client.ts";
import type { AuthContext } from "../auth/types.ts";
import { tenantIdFromAuth } from "../live/dependency-tracker.ts";

export interface ReadOnlyTableClient {
  all(): Promise<Record<string, unknown>[]>;
  get(id: string): Promise<Record<string, unknown> | null>;
  where(partial: Partial<Record<string, unknown>>): Promise<Record<string, unknown>[]>;
  count(): Promise<number>;
}

export type ReadOnlyDbClient = Record<string, ReadOnlyTableClient>;

function forbidden(operation: string, liveQuery = false): never {
  const code =
    operation === "emit"
      ? FORGE_QUERY_EMIT_FORBIDDEN
      : operation === "secrets"
        ? FORGE_QUERY_SECRET_FORBIDDEN
        : operation === "ai"
          ? FORGE_QUERY_AI_FORBIDDEN
          : liveQuery
            ? FORGE_LIVEQUERY_WRITE_FORBIDDEN
            : FORGE_QUERY_WRITE_FORBIDDEN;
  throw new Error(`${code}: ${operation} is forbidden in query context`);
}

function wrapReadOnlyTable(
  tableName: string,
  table: TableClient,
  options?: {
    onRead?: (table: string, tenantId: string | null) => void;
    tenantId?: string | null;
    liveQuery?: boolean;
  },
): ReadOnlyTableClient {
  const recordRead = () => options?.onRead?.(tableName, options.tenantId ?? null);
  return {
    all: () => {
      recordRead();
      return table.all();
    },
    get: (id) => {
      recordRead();
      return table.get(id);
    },
    where: (partial) => {
      recordRead();
      return table.where(partial);
    },
    count: async () => {
      recordRead();
      const rows = await table.all();
      return rows.length;
    },
  };
}

export function createReadOnlyDbClient(
  tx: DbTransaction,
  tableMap: Record<string, TableMapEntry>,
  options?: {
    auth?: AuthContext;
    onRead?: (table: string, tenantId: string | null) => void;
    liveQuery?: boolean;
  },
): ReadOnlyDbClient {
  const writable = createGeneratedDbClient(tx, tableMap, options);
  const client: ReadOnlyDbClient = {};
  const tenantId = tenantIdFromAuth(options?.auth);

  for (const [tableName, table] of Object.entries(writable).sort()) {
    client[tableName] = wrapReadOnlyTable(tableName, table, {
      onRead: options?.onRead,
      tenantId,
      liveQuery: options?.liveQuery,
    });
  }

  return client;
}

export function assertQueryContextForbidden(property: "emit" | "secrets" | "ai"): never {
  forbidden(property);
}
