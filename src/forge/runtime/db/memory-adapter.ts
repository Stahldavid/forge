import type { DbAdapter, DbQueryResult, DbTransaction } from "./adapter.ts";

interface MemoryRow {
  [key: string]: unknown;
}

interface MemoryTable {
  rows: MemoryRow[];
  nextSerial: number;
  columnTypes: Map<string, string>;
}

function normalizeRows(rows: MemoryRow[]): DbQueryResult {
  return {
    rows: rows.map((row) => ({ ...row })),
    rowCount: rows.length,
  };
}

function parseNow(): Date {
  return new Date();
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
    /INTO\s+([a-z_][a-z0-9_]*)/i,
    /FROM\s+([a-z_][a-z0-9_]*)/i,
    /UPDATE\s+"([^"]+)"/i,
    /UPDATE\s+([a-z_][a-z0-9_]*)/i,
    /TABLE\s+"([^"]+)"/i,
    /TABLE\s+([a-z_][a-z0-9_]*)/i,
  ];
  for (const pattern of patterns) {
    const match = sql.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function parseColumnTypes(sql: string): Map<string, string> {
  if (!parseTableName(sql)) {
    return new Map();
  }
  const tableNameMatch =
    sql.match(/CREATE TABLE IF NOT EXISTS\s+"?([^"\s(]+)"?/i) ??
    sql.match(/CREATE TABLE\s+"?([^"\s(]+)"?/i);
  if (!tableNameMatch?.[0]) {
    return new Map();
  }

  const start = sql.indexOf("(", tableNameMatch.index! + tableNameMatch[0].length);
  const end = sql.lastIndexOf(")");
  if (start < 0 || end <= start) {
    return new Map();
  }

  const types = new Map<string, string>();
  for (const definition of splitSqlList(sql.slice(start + 1, end))) {
    const trimmed = definition.trim();
    if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(trimmed)) {
      continue;
    }
    const match = trimmed.match(/^"?(\w+)"?\s+([a-zA-Z][a-zA-Z0-9_]*(?:\s+precision)?)/);
    if (match?.[1] && match?.[2]) {
      types.set(match[1], match[2].toLowerCase());
    }
  }
  return types;
}

function isTimestampType(sqlType: string | undefined): boolean {
  if (!sqlType) return false;
  return ["timestamp", "timestamptz", "timestamp with time zone", "timestamp without time zone"].includes(sqlType);
}

function splitSqlList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;

  for (const char of value) {
    if (char === "(" && quote === null) {
      current += char;
      continue;
    }
    if (char === ")" && quote === null) {
      current += char;
      continue;
    }
    if ((char === "'" || char === "\"") && quote === null) {
      quote = char;
    } else if (char === quote) {
      quote = null;
    }

    const openParens = (current.match(/\(/g) ?? []).length;
    const closeParens = (current.match(/\)/g) ?? []).length;
    if (char === "," && quote === null && openParens === closeParens) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

function parseSqlLiteral(token: string, params: unknown[]): unknown {
  const paramMatch = token.match(/^\$(\d+)/);
  if (paramMatch?.[1]) {
    return params[Number(paramMatch[1]) - 1];
  }
  if (/^now\(\)$/i.test(token)) {
    return parseNow();
  }
  if (/^null$/i.test(token)) {
    return null;
  }
  if (
    (token.startsWith("'") && token.endsWith("'")) ||
    (token.startsWith("\"") && token.endsWith("\""))
  ) {
    return token.slice(1, -1);
  }
  const numeric = Number(token);
  return Number.isFinite(numeric) ? numeric : token;
}

function parseUpdateExpression(
  row: MemoryRow,
  column: string,
  expression: string,
  params: unknown[],
): unknown {
  const paramMatch = expression.match(/\$(\d+)/);
  const normalizedExpression = expression.replace(/"/g, "").replace(/\s+/g, " ");

  if (normalizedExpression.toLowerCase() === `${column.toLowerCase()} + 1`) {
    return Number(row[column] ?? 0) + 1;
  }

  const coalesceMatch = expression.match(/^COALESCE\(\s*"?(\w+)"?\s*,\s*(.+)\)$/i);
  if (coalesceMatch?.[1] && coalesceMatch[2]) {
    const existing = row[coalesceMatch[1]];
    return existing ?? parseUpdateExpression(row, column, coalesceMatch[2].trim(), params);
  }

  if (paramMatch?.[1]) {
    return params[Number(paramMatch[1]) - 1];
  }

  return parseSqlLiteral(expression, params);
}

function deterministicUuid(serial: number): string {
  return `00000000-0000-0000-0000-${String(serial).padStart(12, "0")}`;
}

function coerceColumnValue(tableName: string, table: MemoryTable, column: string, value: unknown): unknown {
  if (!isTimestampType(table.columnTypes.get(column))) {
    return value;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (value === "") {
    throw new Error(`FORGE_DB_INVALID_TIMESTAMP: empty timestamp value for ${tableName}.${column}`);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`FORGE_DB_INVALID_TIMESTAMP: invalid timestamp value for ${tableName}.${column}`);
    }
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`FORGE_DB_INVALID_TIMESTAMP: invalid timestamp value for ${tableName}.${column}`);
    }
    return date;
  }
  throw new Error(`FORGE_DB_INVALID_TIMESTAMP: unsupported timestamp value for ${tableName}.${column}`);
}

function coerceRowValues(tableName: string, table: MemoryTable, row: MemoryRow): void {
  for (const column of Object.keys(row)) {
    row[column] = coerceColumnValue(tableName, table, column, row[column]);
  }
}

function applySystemDefaults(tableName: string, row: MemoryRow): void {
  const now = parseNow();

  if (tableName === "_forge_outbox") {
    row.created_at ??= now;
    row.processed_at ??= null;
  }

  if (tableName === "_forge_outbox_deliveries") {
    row.status ??= "pending";
    row.attempts ??= 0;
    row.max_attempts ??= 5;
    row.next_attempt_at ??= now;
    row.locked_at ??= null;
    row.locked_by ??= null;
    row.last_error ??= null;
    row.processed_at ??= null;
    row.created_at ??= now;
  }

  if (tableName === "_forge_workflow_runs") {
    row.status ??= "pending";
    row.current_step ??= null;
    row.last_error ??= null;
    row.created_at ??= now;
    row.updated_at ??= now;
    row.started_at ??= null;
    row.completed_at ??= null;
    row.canceled_at ??= null;
  }

  if (tableName === "_forge_workflow_steps") {
    row.status ??= "pending";
    row.input ??= null;
    row.output ??= null;
    row.attempts ??= 0;
    row.max_attempts ??= 5;
    row.next_attempt_at ??= now;
    row.locked_at ??= null;
    row.locked_by ??= null;
    row.last_error ??= null;
    row.started_at ??= null;
    row.completed_at ??= null;
    row.created_at ??= now;
  }

  if (tableName === "_forge_telemetry_events") {
    row.status ??= "pending";
    row.created_at ??= now;
    row.next_attempt_at ??= now;
    row.attempts ??= 0;
  }

  if (tableName === "_forge_trace_spans") {
    row.started_at ??= now;
  }

  if (tableName === "_forge_live_invalidations") {
    row.payload ??= {};
    row.created_at ??= now;
  }

  if (tableName === "_forge_live_subscription_debug") {
    row.created_at ??= now;
    row.updated_at ??= now;
  }
}

function projectRows(sql: string, rows: MemoryRow[]): MemoryRow[] {
  const selectMatch = sql.match(/^SELECT\s+(.+?)\s+FROM\s/i);
  const selectList = selectMatch?.[1]?.trim();
  if (!selectList || selectList === "*" || /COUNT\(\*\)/i.test(selectList)) {
    return rows;
  }

  const columns = splitSqlList(selectList)
    .map((column) => column.replace(/\s+AS\s+\w+$/i, "").trim())
    .map((column) => column.replace(/^[\w.]+\./, "").replace(/"/g, ""));

  return rows.map((row) => {
    const projected: MemoryRow = {};
    for (const column of columns) {
      projected[column] = row[column];
    }
    return projected;
  });
}

function extractWhereClause(sql: string): string | null {
  const whereIndex = sql.search(/\bWHERE\b/i);
  if (whereIndex < 0) {
    return null;
  }
  const afterWhere = sql.slice(whereIndex);
  const endMatch = afterWhere.match(/\b(ORDER\s+BY|GROUP\s+BY|LIMIT|RETURNING)\b/i);
  return endMatch?.index === undefined ? afterWhere : afterWhere.slice(0, endMatch.index);
}

export class MemoryAdapter implements DbAdapter {
  readonly kind = "memory" as const;
  private tables = new Map<string, MemoryTable>();
  private sequences = new Map<string, number>();

  async query(sql: string, params: unknown[] = []): Promise<DbQueryResult> {
    const trimmed = sql.trim().replace(/\s+/g, " ");

    if (trimmed.startsWith("CREATE TABLE")) {
      const match =
        trimmed.match(/CREATE TABLE IF NOT EXISTS "([^"]+)"/i) ??
        trimmed.match(/CREATE TABLE IF NOT EXISTS ([a-z_][a-z0-9_]*)/i);
      if (match?.[1]) {
        const table = this.ensureTable(match[1]);
        for (const [column, sqlType] of parseColumnTypes(trimmed)) {
          table.columnTypes.set(column, sqlType);
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (trimmed.startsWith("CREATE SEQUENCE")) {
      const match =
        trimmed.match(/CREATE SEQUENCE IF NOT EXISTS "([^"]+)"/i) ??
        trimmed.match(/CREATE SEQUENCE IF NOT EXISTS ([a-z_][a-z0-9_]*)/i);
      if (match?.[1] && !this.sequences.has(match[1])) {
        const start = Number(trimmed.match(/START WITH\s+(\d+)/i)?.[1] ?? 1);
        this.sequences.set(match[1], Number.isFinite(start) ? start : 1);
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
      const match =
        trimmed.match(/TRUNCATE TABLE "([^"]+)"/i) ??
        trimmed.match(/TRUNCATE TABLE ([a-z_][a-z0-9_]*)/i);
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

    const valuesMatch = sql.match(/\)\s*VALUES\s*\((.+?)\)(?:\s|$)/i);
    const values = valuesMatch?.[1] ? splitSqlList(valuesMatch[1]) : [];

    columns.forEach((column, index) => {
      const token = values[index];
      row[column] = token ? parseSqlLiteral(token, params) : params[index];
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

    if (row.id === undefined && columns.includes("id") === false) {
      row.id =
        tableName.startsWith("_forge_") || tableName.includes("outbox")
          ? table.nextSerial++
          : deterministicUuid(table.nextSerial++);
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

    applySystemDefaults(tableName, row);
    coerceRowValues(tableName, table, row);

    table.rows.push(row);

    if (/RETURNING/i.test(sql)) {
      if (/RETURNING\s+\*/i.test(sql)) {
        return { rows: [{ ...row }], rowCount: 1 };
      }
      const returningMatch = sql.match(/RETURNING\s+"?(\w+)"?/i);
      const returningCol = returningMatch?.[1] ?? "id";
      return { rows: [{ [returningCol]: row[returningCol] }], rowCount: 1 };
    }

    return { rows: [{ ...row }], rowCount: 1 };
  }

  private handleSelect(sql: string, params: unknown[]): DbQueryResult {
    const nextvalMatch = sql.match(/nextval\(\s*'([^']+)'\s*\)/i);
    if (nextvalMatch?.[1]) {
      const name = nextvalMatch[1];
      const current = this.sequences.get(name) ?? 1;
      this.sequences.set(name, current + 1);
      return { rows: [{ revision: current, nextval: current }], rowCount: 1 };
    }

    if (/MAX\(\s*revision\s*\)/i.test(sql)) {
      const table = this.tables.get("_forge_live_invalidations");
      const max = Math.max(
        0,
        ...((table?.rows ?? []).map((row) => Number(row.revision)).filter(Number.isFinite)),
      );
      const alias = sql.match(/AS\s+"?(\w+)"?/i)?.[1] ?? "revision";
      return { rows: [{ [alias]: max, revision: max }], rowCount: 1 };
    }

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

      const alias = sql.match(/COUNT\(\*\)(?:::int)?\s+AS\s+"?(\w+)"?/i)?.[1] ?? "count";
      return { rows: [{ [alias]: rows.length, count: rows.length }], rowCount: 1 };
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

    if (/ORDER BY\s+revision/i.test(sql)) {
      rows.sort((a, b) => Number(a.revision) - Number(b.revision));
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

    return normalizeRows(projectRows(sql, rows));
  }

  private handleJoinSelect(sql: string, _params: unknown[]): DbQueryResult {
    const deliveryTable = this.tables.get("_forge_outbox_deliveries");
    const outboxTable = this.tables.get("_forge_outbox");
    if (!deliveryTable || !outboxTable) {
      return { rows: [], rowCount: 0 };
    }

    let rows: MemoryRow[] = deliveryTable.rows.map((delivery) => {
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
    return normalizeRows(projectRows(sql, rows));
  }

  private filterRows(rows: MemoryRow[], sql: string, params: unknown[]): MemoryRow[] {
    const whereSql = extractWhereClause(sql) ?? sql;

    if (/status\s*=\s*'pending'/i.test(whereSql) && /next_attempt_at\s*<=\s*now\(\)/i.test(whereSql)) {
      return rows.filter((row) => row.status === "pending");
    }

    if (/trace_id\s*=\s*\$\d+/i.test(whereSql)) {
      return rows.filter((row) => row.trace_id === params[0]);
    }

    if (/status\s+IN\s*\(\s*'pending'\s*,\s*'running'\s*,\s*'failed'\s*\)/i.test(whereSql)) {
      return rows.filter((row) =>
        ["pending", "running", "failed"].includes(String(row.status)),
      );
    }

    if (/status\s+NOT\s+IN\s*\(\s*'completed'\s*,\s*'skipped'\s*\)/i.test(whereSql)) {
      return rows.filter(
        (row) => !["completed", "skipped"].includes(String(row.status)),
      );
    }

    if (/status\s*=\s*'dead'/i.test(whereSql) && /COUNT/i.test(sql)) {
      return rows.filter((row) => row.status === "dead");
    }

    if (/step_index\s*<\s*\$\d+/i.test(whereSql) && /status\s*!=\s*'completed'/i.test(whereSql)) {
      const threshold = Number(params[1]);
      const runId = params[0];
      return rows.filter(
        (row) =>
          row.run_id === runId &&
          Number(row.step_index) < threshold &&
          row.status !== "completed",
      );
    }

    if (/idempotency_key\s*=\s*\$\d+/i.test(whereSql)) {
      return rows.filter((row) => row.idempotency_key === params[0]);
    }

    if (/status\s*=\s*'dead'/i.test(whereSql)) {
      return rows.filter((row) => row.status === "dead");
    }

    const conditions = [
      ...whereSql.matchAll(
        /(?:^|\s|AND\s)(?:\w+\.)?"?(\w+)"?\s*(=|<=|>=|>|<|!=)\s*(\$\d+|now\(\)|'[^']*'|"[^"]*"|\d+)/gi,
      ),
    ];

    return rows.filter((row) => {
      for (const condition of conditions) {
        const column = condition[1]!;
        const operator = condition[2]!;
        const value = parseSqlLiteral(condition[3]!, params);

        if (operator === "<=") {
          if (!compareValue(row[column], value)) {
            return false;
          }
        } else if (operator === ">") {
          if (!(Number(row[column]) > Number(value))) {
            return false;
          }
        } else if (operator === ">=") {
          if (!(Number(row[column]) >= Number(value))) {
            return false;
          }
        } else if (operator === "<") {
          if (!(Number(row[column]) < Number(value))) {
            return false;
          }
        } else if (operator === "!=") {
          if (row[column] === value) {
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
    const assignments = setMatch?.[1] ? splitSqlList(setMatch[1]) : [];
    const matchingRows = /WHERE/i.test(sql) ? new Set(this.filterRows(table.rows, sql, params)) : new Set(table.rows);

    let updated = 0;
    for (const row of table.rows) {
      if (!matchingRows.has(row)) {
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

      for (const assignment of assignments) {
        const equalsIndex = assignment.indexOf("=");
        if (equalsIndex < 0) {
          continue;
        }
        const rawColumn = assignment.slice(0, equalsIndex);
        const rawExpression = assignment.slice(equalsIndex + 1);
        const column = rawColumn.trim().replace(/"/g, "");
        if (!column) {
          continue;
        }

        const expression = rawExpression.trim();
        row[column] = parseUpdateExpression(row, column, expression, params);
        row[column] = coerceColumnValue(tableName, table, column, row[column]);
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

    const rowsToDelete = new Set(this.filterRows(table.rows, sql, params));
    const before = table.rows.length;
    table.rows = table.rows.filter((row) => !rowsToDelete.has(row));
    return { rows: [], rowCount: before - table.rows.length };
  }

  async begin(): Promise<DbTransaction> {
    const snapshot = new Map<string, MemoryTable>();
    for (const [name, table] of this.tables) {
      snapshot.set(name, {
        rows: table.rows.map((row) => ({ ...row })),
        nextSerial: table.nextSerial,
        columnTypes: new Map(table.columnTypes),
      });
    }
    const sequenceSnapshot = new Map(this.sequences);

    const adapter = this;

    return {
      query: (querySql, queryParams) => adapter.query(querySql, queryParams),
      async commit() {
        /* committed in place */
      },
      async rollback() {
        adapter.tables = snapshot;
        adapter.sequences = sequenceSnapshot;
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
    const created = { rows: [], nextSerial: 1, columnTypes: new Map<string, string>() };
    this.tables.set(name, created);
    return created;
  }
}

export function createMemoryAdapter(): DbAdapter {
  return new MemoryAdapter();
}
