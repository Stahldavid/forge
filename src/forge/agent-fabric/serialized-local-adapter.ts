import type { DbAdapter, DbQueryResult, DbTransaction } from "../runtime/db/adapter.ts";

/** Keep all local inbox queries outside a control-journal transaction. */
export function serializeLocalAdapter(adapter: DbAdapter): DbAdapter {
  let tail: Promise<void> = Promise.resolve();
  let poisoned = false;
  const acquire = async (): Promise<() => void> => {
    const predecessor = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await predecessor;
    return release;
  };
  const query = async (sql: string, params?: unknown[]): Promise<DbQueryResult> => {
    const release = await acquire();
    try {
      if (poisoned) throw new Error("Local database transaction recovery failed");
      return await adapter.query(sql, params);
    } finally { release(); }
  };
  return {
    kind: adapter.kind,
    query,
    async begin(): Promise<DbTransaction> {
      const release = await acquire();
      if (poisoned) { release(); throw new Error("Local database transaction recovery failed"); }
      let transaction: DbTransaction;
      try { transaction = await adapter.begin(); } catch (error) { release(); throw error; }
      let finished = false;
      const finish = async (kind: "commit" | "rollback"): Promise<void> => {
        if (finished) throw new Error("Local database transaction is already closed");
        try {
          await transaction[kind]();
        } catch (error) {
          if (kind === "commit") {
            try { await transaction.rollback(); } catch { poisoned = true; }
          } else {
            poisoned = true;
          }
          throw error;
        } finally {
          finished = true;
          release();
        }
      };
      return {
        query: (sql, params) => {
          if (finished) throw new Error("Local database transaction is already closed");
          return transaction.query(sql, params);
        },
        commit: () => finish("commit"),
        rollback: () => finish("rollback"),
      };
    },
    async close(): Promise<void> {
      const release = await acquire();
      try { await adapter.close(); } finally { release(); }
    },
  };
}
