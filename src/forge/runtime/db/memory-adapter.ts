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

function parseNow(): string {
  return new Date().toISOString();
}

function compareValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && typeof right === "string") {
    return left.getTime() <= new Date(right).getTime();
  }
  if (typeof left === "string" && typeof right === "string") {
    if (left.includes("T") && right.includes("T")) {
      return new Date(left).getTime() <= new Date(right).getTime();
    }
  }
  return left === right;
}

function parseTableName(sql: string): string | null {
  const patterns = [
    /FROM\s+"([^"]+)"/i,
    /INTO\s+"([^"]+)"/i,
    /UPDATE\s+"([^"]+)"/i,
    /TABLE\s+"([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = sql.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export class MemoryAdapter implements DbAdapter {
  readonly kind = "memory" as const;
  private tables = new Map<string, MemoryTable>();

  async query(sql: string, params: unknown[] = []): Promise<DbQueryResult> {
    const trimmed = sql.trim().replace(/\s+/g, " ");

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
          if (/RESTART IDENTITY/i.test(trimmed)) {
            table.nextSerial = 1;
          }
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (trimmed.startsWith("INSERT INTO")) {
      return this.handleInsert(trimmed, params);
    }

    if (trimmed.startsWith("SELECT")) {
      return this.handleSelect(trimmed, params);
    }

    if (trimmed.startsWith("UPDATE")) {
      return this.handleUpdate(trimmed, params);
    }

    if (trimmed.startsWith("DELETE")) {
      return this.handleDelete(trimmed, params);
    }

    return { rows: [], rowCount: 0 };
  }

  private handleInsert(sql: string, params: unknown[]): DbQueryResult {
    const tableName = parseTableName(sql);
    if (!tableName) {
      return { rows: [], rowCount: 0 };
    }

    const table = this.ensureTable(tableName);
    const row: MemoryRow = {};
    const columnsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
    const columns =
      columnsMatch?.[1]
        ?.split(",")
        .map((column) => column.trim().replace(/"/g, "")) ?? [];

    columns.forEach((column, index) => {
      let value = params[index];
      if (value === undefined && /\bnow\(\)/i.test(sql)) {
        value = parseNow();
      }
      row[column] = value;
    });

    if (/ON CONFLICT/i.test(sql)) {
      const conflictColumn = sql.match(/ON CONFLICT\s*\(\s*"?(\w+)"?\s*\)/i)?.[1];
      if (conflictColumn) {
        const existing = table.rows.find((candidate) => candidate[conflictColumn] === row[conflictColumn]);
        if (existing) {
          if (/DO NOTHING/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
        }
      }
    }

    if (row.id === undefined && (tableName.includes("outbox") || tableName.includes("workflow") || tableName.includes("telemetry") || tableName.includes("trace_spans") || columns.includes("id") === false)) {
      row.id = table.nextSerial++;
    }

    if (row.created_at === undefined && columns.includes("created_at")) {
      row.created_at = parseNow();
    }
    if (row.updated_at === undefined && columns.includes("updated_at")) {
      row.updated_at = parseNow();
    }
    if (row.next_attempt_at === undefined && columns.includes("next_attempt_at")) {
      row.next_attempt_at = parseNow();
    }

    table.rows.push(row);

    if (/RETURNING/i.test(sql)) {
      const returningMatch = sql.match(/RETURNING\s+"?(\w+)"?/i);
      const returningCol = returningMatch?.[1] ?? "id";
      return { rows: [{ [returningCol]: row[returningCol] }], rowCount: 1 };
    }

    return { rows: [{ ...row }], rowCount: 1 };
  }

  private handleSelect(sql: string, params: unknown[]): DbQueryResult {
    if (/information_schema\.tables/i.test(sql)) {
      const tables = [...this.tables.keys()].sort().map((name) => ({ table_name: name }));
      return normalizeRows(tables);
    }

    if (/COUNT\(\*\)/i.test(sql)) {
      const tableName = parseTableName(sql);
      if (!tableName) {
        return { rows: [{ count: 0 }], rowCount: 1 };
      }
      const table = this.tables.get(tableName);
      let rows = table?.rows ?? [];

      if (/GROUP BY\s+"?status"?/i.test(sql)) {
        const grouped = new Map<string, number>();
        for (const row of rows) {
          const status = String(row.status ?? "unknown");
          grouped.set(status, (grouped.get(status) ?? 0) + 1);
        }
        return normalizeRows(
          [...grouped.entries()].map(([status, count]) => ({ status, count })),
        );
      }

      if (/WHERE/i.test(sql)) {
        rows = this.filterRows(rows, sql, params);
      }

      return { rows: [{ count: rows.length }], rowCount: 1 };
    }

    if (/JOIN/i.test(sql)) {
      return this.handleJoinSelect(sql, params);
    }

    const tableName = parseTableName(sql);
    if (!tableName) {
      return { rows: [], rowCount: 0 };
    }

    const table = this.tables.get(tableName);
    if (!table) {
      return { rows: [], rowCount: 0 };
    }

    let rows = [...table.rows];

    if (/WHERE/i.test(sql)) {
      rows = this.filterRows(rows, sql, params);
    }

    if (/ORDER BY/i.test(sql)) {
      const orderMatch = sql.match(/ORDER BY\s+"?(\w+)"?/i);
      const column = orderMatch?.[1];
      if (column) {
        rows.sort((a, b) => {
          const left = a[column];
          const right = b[column];
          if (left === right) return 0;
          return (left as number) < (right as number) ? -1 : 1;
        });
      }
    }

    if (/LIMIT/i.test(sql)) {
      const limitMatch = sql.match(/LIMIT\s+\$(\d+)/i);
      const limitParam = limitMatch ? Number(params[Number(limitMatch[1]) - 1]) : Number(params[params.length - 1] ?? params[0]);
      if (Number.isFinite(limitParam)) {
        rows = rows.slice(0, limitParam);
      }
    }

    if (/ORDER BY\s+id\s+DESC/i.test(sql)) {
      rows.sort((a, b) => Number(b.id) - Number(a.id));
    }

    return normalizeRows(rows);
  }

  private handleJoinSelect(sql: string, params: unknown[]): DbQueryResult {
    const deliveryTable = this.tables.get("_forge_outbox_deliveries");
    const outboxTable = this.tables.get("_forge_outbox");
    if (!deliveryTable || !outboxTable) {
      return { rows: [], rowCount: 0 };
    }

    let rows = deliveryTable.rows.map((delivery) => {
      const event = outboxTable.rows.find((row) => row.id === delivery.outbox_id);
      return {
        ...delivery,
        event_type: event?.event_type,
        event_created_at: event?.created_at,
      };
    });

    if (/WHERE\s+d\.status\s*=\s*'dead'/i.test(sql)) {
      rows = rows.filter((row) => row.status === "dead");
    }

    rows.sort((a, b) => Number(a.id) - Number(b.id));
    return normalizeRows(rows);
  }

  private filterRows(rows: MemoryRow[], sql: string, params: unknown[]): MemoryRow[] {
    let paramIndex = 0;

    if (/status\s*=\s*'pending'\s+AND\s+next_attempt_at\s*<=\s*now\(\)/i.test(sql)) {
      const now = parseNow();
      return rows.filter(
        (row) => row.status === "pending" && compareValue(row.next_attempt_at, now),
      );
    }

    if (/trace_id\s*=\s*\$\d+/i.test(sql)) {
      return rows.filter((row) => row.trace_id === params[0]);
    }

    if (/status\s+IN\s*\(\s*'pending'\s*,\s*'running'\s*,\s*'failed'\s*\)/i.test(sql)) {
      return rows.filter((row) =>
        ["pending", "running", "failed"].includes(String(row.status)),
      );
    }

    if (/status\s+NOT\s+IN\s*\(\s*'completed'\s*,\s*'skipped'\s*\)/i.test(sql)) {
      return rows.filter(
        (row) => !["completed", "skipped"].includes(String(row.status)),
      );
    }

    if (/status\s*=\s*'dead'/i.test(sql) && /COUNT/i.test(sql)) {
      return rows.filter((row) => row.status === "dead");
    }

    if (/step_index\s*<\s*\$\d+/i.test(sql) && /status\s*!=\s*'completed'/i.test(sql)) {
      const threshold = Number(params[1]);
      const runId = params[0];
      return rows.filter(
        (row) =>
          row.run_id === runId &&
          Number(row.step_index) < threshold &&
          row.status !== "completed",
      );
    }

    if (/idempotency_key\s*=\s*\$\d+/i.test(sql)) {
      return rows.filter((row) => row.idempotency_key === params[0]);
    }

    if (/status\s*=\s*'dead'/i.test(sql)) {
      return rows.filter((row) => row.status === "dead");
    }

    const conditions = [...sql.matchAll(/"(\w+)"\s*(=|<=)\s*(?:\$\d+|now\(\))/gi)];

    return rows.filter((row) => {
      paramIndex = 0;
      for (const condition of conditions) {
        const column = condition[1]!;
        const operator = condition[2]!;
        const usesNow = /now\(\)/i.test(condition[0] ?? "");
        const value = usesNow ? parseNow() : params[paramIndex++];

        if (operator === "<=") {
          if (!compareValue(row[column], value)) {
            return false;
          }
        } else if (row[column] !== value) {
          return false;
        }
      }
      return true;
    });
  }

  private handleUpdate(sql: string, params: unknown[]): DbQueryResult {
    const tableName = parseTableName(sql);
    if (!tableName) {
      return { rows: [], rowCount: 0 };
    }

    const table = this.tables.get(tableName);
    if (!table) {
      return { rows: [], rowCount: 0 };
    }

    const setMatch = sql.match(/SET (.+?) WHERE/i);
    const assignments = setMatch?.[1]?.split(",") ?? [];
    const whereMatch = sql.match(/WHERE\s+"?(\w+)"?\s*=\s*\$\d+/i);
    const whereColumn = whereMatch?.[1] ?? "id";
    const whereValue = params[params.length - 1];

    let updated = 0;
    for (const row of table.rows) {
      if (row[whereColumn] !== whereValue) {
        continue;
      }

      if (/AND\s+"?status"?\s*=\s*'pending'/i.test(sql) && row.status !== "pending") {
        continue;
      }

      if (/trace_id\s*=\s*\$\d+\s+AND\s+span_id\s*=\s*\$\d+/i.test(sql)) {
        const traceId = params[params.length - 2];
        const spanId = params[params.length - 1];
        if (row.trace_id !== traceId || row.span_id !== spanId) {
          continue;
        }
      }

      if (
        /status\s+NOT\s+IN\s*\(\s*'completed'\s*,\s*'canceled'\s*,\s*'dead'\s*\)/i.test(sql) &&
        ["completed", "canceled", "dead"].includes(String(row.status))
      ) {
        continue;
      }

      if (/status\s+IN\s*\(\s*'pending'\s*,\s*'running'\s*\)/i.test(sql) && !["pending", "running"].includes(String(row.status))) {
        continue;
      }

      if (/status\s+IN\s*\(\s*'failed'\s*,\s*'dead'\s*\)/i.test(sql) && !["failed", "dead"].includes(String(row.status))) {
        continue;
      }

      let paramIdx = 0;
      for (const assignment of assignments) {
        const column = assignment.trim().split("=")[0]?.trim().replace(/"/g, "");
        if (!column) {
          continue;
        }

        if (/now\(\)/i.test(assignment)) {
          row[column] = parseNow();
        } else if (/NULL/i.test(assignment) && !/\$\d+/.test(assignment)) {
          row[column] = null;
        } else {
          row[column] = params[paramIdx++];
        }
      }

      updated += 1;
    }

    return { rows: [], rowCount: updated };
  }

  private handleDelete(sql: string, params: unknown[]): DbQueryResult {
    const tableName = parseTableName(sql);
    if (!tableName) {
      return { rows: [], rowCount: 0 };
    }

    const table = this.tables.get(tableName);
    if (!table) {
      return { rows: [], rowCount: 0 };
    }

    if (!/WHERE/i.test(sql)) {
      const before = table.rows.length;
      table.rows = [];
      return { rows: [], rowCount: before };
    }

    if (/WHERE\s+"?status"?\s*=\s*'dead'/i.test(sql)) {
      const before = table.rows.length;
      table.rows = table.rows.filter((row) => row.status !== "dead");
      return { rows: [], rowCount: before - table.rows.length };
    }

    const id = params[0];
    const before = table.rows.length;
    table.rows = table.rows.filter((row) => row.id !== id);
    return { rows: [], rowCount: before - table.rows.length };
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
      query: (querySql, queryParams) => adapter.query(querySql, queryParams),
      async commit() {
        /* committed in place */
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
