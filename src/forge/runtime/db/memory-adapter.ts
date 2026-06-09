import type { DbAdapter, DbQueryResult, DbTransaction } from "./adapter.ts";

interface MemoryRow {
  [key: string]: unknown;
}

interface MemoryTable {
  rows: MemoryRow[];
  nextSerial: number;
}

function normalizeRows(rows: MemoryRow[]): DbQueryResult {
  return {
    rows: rows.map((row) => ({ ...row })),
    rowCount: rows.length,
  };
}

export class MemoryAdapter implements DbAdapter {
  readonly kind = "memory" as const;
  private tables = new Map<string, MemoryTable>();

  async query(sql: string, params: unknown[] = []): Promise<DbQueryResult> {
    const trimmed = sql.trim();

    if (trimmed.startsWith("CREATE TABLE")) {
      const match = trimmed.match(/CREATE TABLE IF NOT EXISTS "([^"]+)"/i);
      if (match?.[1] && !this.tables.has(match[1])) {
        this.tables.set(match[1], { rows: [], nextSerial: 1 });
      }
      return { rows: [], rowCount: 0 };
    }

    if (trimmed.startsWith("CREATE INDEX")) {
      return { rows: [], rowCount: 0 };
    }

    if (trimmed.startsWith("DROP TABLE")) {
      const match = trimmed.match(/DROP TABLE IF EXISTS "([^"]+)"/i);
      if (match?.[1]) {
        this.tables.delete(match[1]);
      }
      return { rows: [], rowCount: 0 };
    }

    if (trimmed.startsWith("TRUNCATE")) {
      const match = trimmed.match(/TRUNCATE TABLE "([^"]+)"/i);
      if (match?.[1]) {
        const table = this.tables.get(match[1]);
        if (table) {
          table.rows = [];
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (trimmed.startsWith("INSERT INTO")) {
      const match = trimmed.match(/INSERT INTO "([^"]+)"/i);
      const tableName = match?.[1];
      if (!tableName) {
        return { rows: [], rowCount: 0 };
      }
      const table = this.ensureTable(tableName);
      const row: MemoryRow = {};
      const columnsMatch = trimmed.match(/\(([^)]+)\)\s*VALUES/i);
      const columns = columnsMatch?.[1]
        ?.split(",")
        .map((column) => column.trim().replace(/"/g, "")) ?? [];

      columns.forEach((column, index) => {
        row[column] = params[index];
      });

      if (tableName === "_forge_outbox" && row.id === undefined) {
        row.id = table.nextSerial++;
      }

      table.rows.push(row);
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (trimmed.startsWith("SELECT")) {
      const fromMatch = trimmed.match(/FROM "([^"]+)"/i);
      const tableName = fromMatch?.[1];
      if (!tableName) {
        return { rows: [], rowCount: 0 };
      }
      const table = this.tables.get(tableName);
      if (!table) {
        return { rows: [], rowCount: 0 };
      }

      if (trimmed.includes("WHERE")) {
        const whereMatch = trimmed.match(/WHERE "([^"]+)"\s*=\s*\$\d+/i);
        const column = whereMatch?.[1];
        if (column) {
          const value = params[0];
          const filtered = table.rows.filter((row) => row[column] === value);
          return normalizeRows(filtered);
        }
      }

      return normalizeRows(table.rows);
    }

    if (trimmed.startsWith("UPDATE")) {
      const match = trimmed.match(/UPDATE "([^"]+)"/i);
      const tableName = match?.[1];
      if (!tableName) {
        return { rows: [], rowCount: 0 };
      }
      const table = this.tables.get(tableName);
      if (!table) {
        return { rows: [], rowCount: 0 };
      }

      const idIndex = params.length - 1;
      const id = params[idIndex];
      const row = table.rows.find((candidate) => candidate.id === id);
      if (!row) {
        return { rows: [], rowCount: 0 };
      }

      const setMatch = trimmed.match(/SET (.+?) WHERE/i);
      const assignments = setMatch?.[1]?.split(",") ?? [];
      assignments.forEach((assignment, index) => {
        const column = assignment.trim().split("=")[0]?.trim().replace(/"/g, "");
        if (column) {
          row[column] = params[index];
        }
      });

      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (trimmed.startsWith("DELETE")) {
      const match = trimmed.match(/DELETE FROM "([^"]+)"/i);
      const tableName = match?.[1];
      if (!tableName) {
        return { rows: [], rowCount: 0 };
      }
      const table = this.tables.get(tableName);
      if (!table) {
        return { rows: [], rowCount: 0 };
      }
      const id = params[0];
      const before = table.rows.length;
      table.rows = table.rows.filter((row) => row.id !== id);
      return { rows: [], rowCount: before - table.rows.length };
    }

    return { rows: [], rowCount: 0 };
  }

  async begin(): Promise<DbTransaction> {
    const snapshot = new Map<string, MemoryTable>();
    for (const [name, table] of this.tables) {
      snapshot.set(name, {
        rows: table.rows.map((row) => ({ ...row })),
        nextSerial: table.nextSerial,
      });
    }

    const adapter = this;

    return {
      query: (sql, params) => adapter.query(sql, params),
      async commit() {
        // committed in place
      },
      async rollback() {
        adapter.tables = snapshot;
      },
    };
  }

  async close(): Promise<void> {
    this.tables.clear();
  }

  private ensureTable(name: string): MemoryTable {
    const existing = this.tables.get(name);
    if (existing) {
      return existing;
    }
    const created = { rows: [], nextSerial: 1 };
    this.tables.set(name, created);
    return created;
  }
}

export function createMemoryAdapter(): DbAdapter {
  return new MemoryAdapter();
}
