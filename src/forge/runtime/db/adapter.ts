export interface DbQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface DbTransaction {
  query(sql: string, params?: unknown[]): Promise<DbQueryResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export type DbAdapterKind = "pglite" | "postgres" | "memory";

export interface DbAdapter {
  kind: DbAdapterKind;
  query(sql: string, params?: unknown[]): Promise<DbQueryResult>;
  begin(): Promise<DbTransaction>;
  close(): Promise<void>;
}

export function adapterAsTransaction(adapter: DbAdapter): DbTransaction {
  return {
    query: (sql, params) => adapter.query(sql, params),
    commit: async () => {
      /* non-transactional */
    },
    rollback: async () => {
      /* non-transactional */
    },
  };
}
