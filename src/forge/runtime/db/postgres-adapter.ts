import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import { FORGE_DB_ADAPTER_UNAVAILABLE } from "../../compiler/diagnostics/codes.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { DbAdapter, DbQueryResult, DbTransaction } from "./adapter.ts";

interface PostgresClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
}

function loadBunSql(databaseUrl: string): PostgresClient | null {
  try {
    const bunGlobal = globalThis as {
      Bun?: {
        SQL?: new (options: string | { url: string; max?: number }) => {
          unsafe: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
          close: () => Promise<void>;
        };
      };
    };

    if (!bunGlobal.Bun?.SQL) {
      return null;
    }

    const client = new bunGlobal.Bun.SQL({ url: databaseUrl, max: 1 });
    return {
      query: async (sql, params = []) => {
        const rows = await client.unsafe(sql, params);
        return { rows: rows as Record<string, unknown>[] };
      },
      close: async () => {
        await client.close();
      },
    };
  } catch {
    return null;
  }
}

async function loadPostgresJs(databaseUrl: string): Promise<PostgresClient | null> {
  try {
    const module = await import("postgres");
    const createSql = module.default;
    const sql = createSql(databaseUrl, {
      max: 1,
      onnotice: () => undefined,
    });
    return {
      query: async (statement, params = []) => {
        const rows = await sql.unsafe(statement, params as never[]);
        return { rows: rows as Record<string, unknown>[] };
      },
      close: async () => {
        await sql.end({ timeout: 5 });
      },
    };
  } catch {
    return null;
  }
}

export class PostgresAdapter implements DbAdapter {
  readonly kind = "postgres" as const;
  private client: PostgresClient;

  constructor(client: PostgresClient) {
    this.client = client;
  }

  async query(sql: string, params: unknown[] = []): Promise<DbQueryResult> {
    const result = await this.client.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rows.length,
    };
  }

  async begin(): Promise<DbTransaction> {
    await this.query("BEGIN");
    const adapter = this;

    return {
      query: (sql, params = []) => adapter.query(sql, params),
      commit: async () => {
        await adapter.query("COMMIT");
      },
      rollback: async () => {
        await adapter.query("ROLLBACK");
      },
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export async function createPostgresAdapter(
  databaseUrl: string,
): Promise<{ adapter: DbAdapter } | { adapter: null; diagnostic: Diagnostic }> {
  const client = loadBunSql(databaseUrl) ?? await loadPostgresJs(databaseUrl);
  if (!client) {
    return {
      adapter: null,
      diagnostic: createDiagnostic({
        severity: "error",
        code: FORGE_DB_ADAPTER_UNAVAILABLE,
        message: "postgres adapter requires Bun.SQL or the postgres npm package",
      }),
    };
  }

  return { adapter: new PostgresAdapter(client) };
}
