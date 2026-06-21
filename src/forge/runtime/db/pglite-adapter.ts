import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import type { DbAdapter, DbQueryResult, DbTransaction } from "./adapter.ts";

function toQueryResult(result: {
  rows: Record<string, unknown>[];
  affectedRows?: number;
}): DbQueryResult {
  return {
    rows: result.rows,
    rowCount: result.affectedRows ?? result.rows.length,
  };
}

export class PgliteAdapter implements DbAdapter {
  readonly kind = "pglite" as const;
  private db: PGlite;

  constructor(dataDir: string) {
    this.db = new PGlite(dataDir);
  }

  async query(sql: string, params: unknown[] = []): Promise<DbQueryResult> {
    const result = await this.db.query(sql, params);
    return toQueryResult(result as { rows: Record<string, unknown>[]; affectedRows?: number });
  }

  async begin(): Promise<DbTransaction> {
    await this.db.query("BEGIN");
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
    await this.db.close();
  }
}

export async function createPgliteAdapter(dataDir: string): Promise<DbAdapter> {
  mkdirSync(dataDir, { recursive: true });
  const adapter = new PgliteAdapter(dataDir);
  try {
    await adapter.query("SELECT 1");
    return adapter;
  } catch (error) {
    await adapter.close().catch(() => undefined);
    throw error;
  }
}
