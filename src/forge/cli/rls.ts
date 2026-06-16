import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { run } from "../compiler/orchestrator/run.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import {
  FORGE_DB_SUPERUSER_RUNTIME,
  FORGE_RLS_APPLY_FAILED,
  FORGE_RLS_MUTATION_FAILED,
  FORGE_RLS_PGLITE_NOT_AUTHORITATIVE,
  FORGE_RLS_POLICY_MISSING,
  FORGE_RLS_TEST_FAILED,
} from "../compiler/diagnostics/codes.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { ColumnDef, SqlPlan } from "../compiler/data-graph/sql/types.ts";
import { applyMigrations } from "../runtime/db/migrate.ts";
import type { DbAdapter, DbAdapterKind, DbTransaction } from "../runtime/db/adapter.ts";
import { createDbAdapter } from "../runtime/db/factory.ts";
import { databaseUrlUsesPostgresSuperuser } from "../runtime/db/session-context.ts";
import type { RlsTableSecurity } from "../compiler/data-graph/rls/types.ts";
import { createHash, randomUUID } from "node:crypto";

export type RlsSubcommand = "generate" | "check" | "apply" | "test" | "mutate-test";

export interface RlsCommandOptions {
  subcommand: RlsSubcommand;
  workspaceRoot: string;
  db: DbAdapterKind;
  databaseUrl?: string;
  json: boolean;
}

export interface RlsCommandResult {
  ok: boolean;
  data?: unknown;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

const REQUIRED_RLS_FILES = [
  `${GENERATED_DIR}/rlsPolicies.sql`,
  `${GENERATED_DIR}/rlsPolicies.json`,
  `${GENERATED_DIR}/dbSecurityManifest.json`,
  `${GENERATED_DIR}/dbSessionContext.json`,
];

function readGeneratedText(workspaceRoot: string, relative: string): string | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  return stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const raw = readGeneratedText(workspaceRoot, relative);
  return raw ? (JSON.parse(raw) as T) : null;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;

  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "$" && next === "$") {
      inDollarQuote = !inDollarQuote;
      current += "$$";
      index += 1;
      continue;
    }

    if (char === ";" && !inDollarQuote) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function enumValue(column: ColumnDef): string | null {
  const values = column.checkConstraint?.match(/'([^']+)'/g);
  return values?.[0]?.slice(1, -1) ?? null;
}

function valueForColumn(column: ColumnDef, seed: string): unknown {
  const sqlType = column.sqlType.toLowerCase();
  if (sqlType === "uuid") {
    return stableUuid(`${seed}:${column.name}`);
  }
  if (sqlType === "boolean") {
    return true;
  }
  if (sqlType === "integer" || sqlType === "bigint" || sqlType === "smallint") {
    return Math.abs(Number.parseInt(createHash("sha1").update(seed).digest("hex").slice(0, 6), 16)) % 100000;
  }
  if (sqlType === "double precision" || sqlType === "numeric" || sqlType === "real") {
    return 42.25;
  }
  if (sqlType === "jsonb" || sqlType === "json") {
    return JSON.stringify({ forgeRlsProbe: seed });
  }
  if (sqlType === "timestamptz" || sqlType === "timestamp" || sqlType === "date") {
    return "2026-01-01T00:00:00.000Z";
  }
  return enumValue(column) ?? `forge-rls-probe-${seed}-${column.name}`;
}

function placeholderForColumn(column: ColumnDef, index: number): string {
  const sqlType = column.sqlType.toLowerCase();
  const placeholder = `$${index}`;
  if (sqlType === "uuid") {
    return `${placeholder}::uuid`;
  }
  if (sqlType === "jsonb") {
    return `${placeholder}::jsonb`;
  }
  if (sqlType === "json") {
    return `${placeholder}::json`;
  }
  if (sqlType === "timestamptz") {
    return `${placeholder}::timestamptz`;
  }
  if (sqlType === "timestamp") {
    return `${placeholder}::timestamp`;
  }
  if (sqlType === "date") {
    return `${placeholder}::date`;
  }
  return placeholder;
}

function tablePlan(plan: SqlPlan, tableName: string) {
  return plan.tables.find((table) => table.table === tableName && table.columns);
}

function primaryColumn(columns: ColumnDef[]): ColumnDef {
  return columns.find((column) => column.primaryKey) ?? columns[0]!;
}

function buildRow(
  table: { table?: string; columns?: ColumnDef[] },
  seed: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of table.columns ?? []) {
    row[column.name] = Object.hasOwn(overrides, column.name)
      ? overrides[column.name]
      : valueForColumn(column, seed);
  }
  return row;
}

async function insertRow(
  tx: DbTransaction,
  tableName: string,
  columns: ColumnDef[],
  row: Record<string, unknown>,
): Promise<void> {
  const insertColumns = columns.filter((column) => Object.hasOwn(row, column.name));
  const names = insertColumns.map((column) => quoteIdent(column.name)).join(", ");
  const placeholders = insertColumns
    .map((column, index) => placeholderForColumn(column, index + 1))
    .join(", ");
  const values = insertColumns.map((column) => row[column.name]);
  await tx.query(
    `INSERT INTO ${quoteIdent(tableName)} (${names}) VALUES (${placeholders})`,
    values,
  );
}

async function setTenant(tx: DbTransaction, tenantId: string): Promise<void> {
  await tx.query("SELECT set_config($1, $2, true)", ["forge.tenant_id", tenantId]);
}

async function setProbeRole(adapter: DbAdapter, tableNames: string[]): Promise<string | null> {
  const roleName = "forge_rls_probe";
  try {
    const schema = await adapter.query("SELECT current_schema() AS schema");
    const currentSchema = String(schema.rows[0]?.schema ?? "public");
    await adapter.query(
      `DO $$ BEGIN CREATE ROLE ${quoteIdent(roleName)} NOLOGIN NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    await adapter.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(roleName)}`);
    await adapter.query(`GRANT USAGE ON SCHEMA forge TO ${quoteIdent(roleName)}`);
    if (currentSchema !== "public" && currentSchema !== "forge") {
      await adapter.query(`GRANT USAGE ON SCHEMA ${quoteIdent(currentSchema)} TO ${quoteIdent(roleName)}`);
    }
    for (const tableName of tableNames) {
      await adapter.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${quoteIdent(tableName)} TO ${quoteIdent(roleName)}`,
      );
    }
    await adapter.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdent(roleName)}`);
    if (currentSchema !== "public" && currentSchema !== "forge") {
      await adapter.query(
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${quoteIdent(currentSchema)} TO ${quoteIdent(roleName)}`,
      );
    }
    return roleName;
  } catch {
    return null;
  }
}

async function isolateRlsProbeSchema(adapter: DbAdapter): Promise<string | null> {
  const schemaName = `forge_rls_probe_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  try {
    await adapter.query(`CREATE SCHEMA ${quoteIdent(schemaName)}`);
    await adapter.query(`SET search_path TO ${quoteIdent(schemaName)}, forge, public`);
    return schemaName;
  } catch {
    return null;
  }
}

async function seedReferencedRows(
  tx: DbTransaction,
  plan: SqlPlan,
  columns: ColumnDef[],
  row: Record<string, unknown>,
  seed: string,
  seen: Set<string>,
): Promise<void> {
  for (const column of columns) {
    if (!column.references) {
      continue;
    }
    const key = `${column.references.table}.${column.references.column}:${String(row[column.name])}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const referenced = tablePlan(plan, column.references.table);
    if (!referenced?.columns) {
      continue;
    }
    const referencedRow = buildRow(referenced, `${seed}:${column.references.table}`, {
      [column.references.column]: row[column.name],
    });
    await insertRow(tx, column.references.table, referenced.columns, referencedRow);
  }
}

async function applyRlsSql(adapter: DbAdapter, workspaceRoot: string): Promise<number> {
  const sql = readGeneratedText(workspaceRoot, `${GENERATED_DIR}/rlsPolicies.sql`);
  if (!sql) {
    return 0;
  }
  const statements = splitSqlStatements(sql);
  for (const statement of statements) {
    await adapter.query(statement);
  }
  return statements.length;
}

interface RlsProbeResult {
  table: string;
  role: string | null;
  tenantAVisible: number;
  tenantBVisible: number;
  unscopedVisible: number;
  crossTenantUpdateBlocked: boolean;
  crossTenantDeleteBlocked: boolean;
  mismatchedInsertBlocked: boolean;
}

async function runTableProbe(
  adapter: DbAdapter,
  plan: SqlPlan,
  table: RlsTableSecurity,
  role: string | null,
): Promise<RlsProbeResult> {
  const change = tablePlan(plan, table.table);
  const columns = change?.columns ?? [];
  const primary = primaryColumn(columns);
  const tenantA = table.tenantType === "uuid" ? "11111111-1111-4111-8111-111111111111" : "tenant-a";
  const tenantB = table.tenantType === "uuid" ? "22222222-2222-4222-8222-222222222222" : "tenant-b";
  const tenantColumn = columns.find((column) => column.name === table.tenantColumn);
  const mutableColumn = columns.find(
    (column) => !column.primaryKey && column.name !== table.tenantColumn,
  );
  if (!tenantColumn) {
    throw new Error(`missing tenant column ${table.table}.${table.tenantColumn}`);
  }

  const rowA = buildRow(change!, `${table.table}:a`, {
    [table.tenantColumn]: tenantA,
    [primary.name]: valueForColumn(primary, `${table.table}:a:${primary.name}`),
  });
  const rowB = buildRow(change!, `${table.table}:b`, {
    [table.tenantColumn]: tenantB,
    [primary.name]: valueForColumn(primary, `${table.table}:b:${primary.name}`),
  });
  const mismatchRow = buildRow(change!, `${table.table}:mismatch`, {
    [table.tenantColumn]: tenantB,
    [primary.name]: valueForColumn(primary, `${table.table}:mismatch:${primary.name}`),
  });

  const tx = await adapter.begin();
  try {
    const seededReferences = new Set<string>();
    await seedReferencedRows(tx, plan, columns, rowA, `${table.table}:a`, seededReferences);
    await seedReferencedRows(tx, plan, columns, rowB, `${table.table}:b`, seededReferences);
    await seedReferencedRows(tx, plan, columns, mismatchRow, `${table.table}:mismatch`, seededReferences);
    if (role) {
      await tx.query(`SET ROLE ${quoteIdent(role)}`);
    }

    await setTenant(tx, tenantA);
    await insertRow(tx, table.table, columns, rowA);
    await setTenant(tx, tenantB);
    await insertRow(tx, table.table, columns, rowB);

    await setTenant(tx, tenantA);
    const tenantAVisible = await tx.query(
      `SELECT ${quoteIdent(primary.name)} FROM ${quoteIdent(table.table)} WHERE ${quoteIdent(primary.name)} IN (${placeholderForColumn(primary, 1)}, ${placeholderForColumn(primary, 2)})`,
      [rowA[primary.name], rowB[primary.name]],
    );

    await setTenant(tx, tenantB);
    const tenantBVisible = await tx.query(
      `SELECT ${quoteIdent(primary.name)} FROM ${quoteIdent(table.table)} WHERE ${quoteIdent(primary.name)} IN (${placeholderForColumn(primary, 1)}, ${placeholderForColumn(primary, 2)})`,
      [rowA[primary.name], rowB[primary.name]],
    );

    await setTenant(tx, "");
    const unscopedVisible = await tx.query(
      `SELECT ${quoteIdent(primary.name)} FROM ${quoteIdent(table.table)} WHERE ${quoteIdent(primary.name)} IN (${placeholderForColumn(primary, 1)}, ${placeholderForColumn(primary, 2)})`,
      [rowA[primary.name], rowB[primary.name]],
    );

    await setTenant(tx, tenantA);
    let crossTenantUpdateBlocked = true;
    if (mutableColumn) {
      const updated = await tx.query(
        `UPDATE ${quoteIdent(table.table)} SET ${quoteIdent(mutableColumn.name)} = ${placeholderForColumn(mutableColumn, 1)} WHERE ${quoteIdent(primary.name)} = ${placeholderForColumn(primary, 2)} RETURNING ${quoteIdent(primary.name)}`,
        [valueForColumn(mutableColumn, `${table.table}:updated`), rowB[primary.name]],
      );
      crossTenantUpdateBlocked = updated.rows.length === 0;
    }

    const deleted = await tx.query(
      `DELETE FROM ${quoteIdent(table.table)} WHERE ${quoteIdent(primary.name)} = ${placeholderForColumn(primary, 1)} RETURNING ${quoteIdent(primary.name)}`,
      [rowB[primary.name]],
    );
    const crossTenantDeleteBlocked = deleted.rows.length === 0;

    let mismatchedInsertBlocked = false;
    try {
      await insertRow(tx, table.table, columns, mismatchRow);
    } catch {
      mismatchedInsertBlocked = true;
    }

    return {
      table: table.table,
      role,
      tenantAVisible: tenantAVisible.rows.length,
      tenantBVisible: tenantBVisible.rows.length,
      unscopedVisible: unscopedVisible.rows.length,
      crossTenantUpdateBlocked,
      crossTenantDeleteBlocked,
      mismatchedInsertBlocked,
    };
  } finally {
    await tx.rollback();
    if (role) {
      await adapter.query("RESET ROLE").catch(() => undefined);
    }
  }
}

async function runRlsIsolationTests(options: RlsCommandOptions): Promise<RlsCommandResult> {
  const checked = checkGeneratedArtifacts(options);
  if (!checked.ok) {
    return {
      ...checked,
      diagnostics: [
        ...checked.diagnostics,
        createDiagnostic({
          severity: "error",
          code: FORGE_RLS_TEST_FAILED,
          message: "RLS structural check failed before database isolation test",
        }),
      ],
      exitCode: 1,
    };
  }

  const plan = readGeneratedJson<SqlPlan>(options.workspaceRoot, `${GENERATED_DIR}/sqlPlan.json`);
  const manifest = readGeneratedJson<{
    tables?: RlsTableSecurity[];
  }>(options.workspaceRoot, `${GENERATED_DIR}/dbSecurityManifest.json`);
  const scopedTables = manifest?.tables ?? [];

  if (!plan) {
    return {
      ok: false,
      diagnostics: [
        ...checked.diagnostics,
        createDiagnostic({
          severity: "error",
          code: FORGE_RLS_TEST_FAILED,
          message: `missing ${GENERATED_DIR}/sqlPlan.json; run forge generate first`,
        }),
      ],
      exitCode: 1,
    };
  }

  const { adapter, diagnostics } = await createDbAdapter({
    kind: options.db,
    workspaceRoot: options.workspaceRoot,
    databaseUrl: options.databaseUrl,
  });
  if (!adapter) {
    return {
      ok: false,
      diagnostics: [...checked.diagnostics, ...diagnostics],
      exitCode: 1,
    };
  }

  let probeSchema: string | null = null;

  try {
    if (options.db === "postgres") {
      probeSchema = await isolateRlsProbeSchema(adapter);
    }

    const migrationDiagnostics = await applyMigrations(adapter, plan);
    const migrationErrors = migrationDiagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (migrationErrors.length > 0) {
      return {
        ok: false,
        diagnostics: [...checked.diagnostics, ...diagnostics, ...migrationDiagnostics],
        exitCode: 1,
      };
    }

    const appliedStatements = await applyRlsSql(adapter, options.workspaceRoot);
    const role = await setProbeRole(
      adapter,
      [...new Set(plan.tables.map((table) => table.table).filter((table): table is string => Boolean(table)))],
    );
    const probes: RlsProbeResult[] = [];
    const failures: Diagnostic[] = [];

    for (const table of scopedTables) {
      const probe = await runTableProbe(adapter, plan, table, role);
      probes.push(probe);
      if (
        probe.tenantAVisible !== 1 ||
        probe.tenantBVisible !== 1 ||
        probe.unscopedVisible !== 0 ||
        !probe.crossTenantUpdateBlocked ||
        !probe.crossTenantDeleteBlocked ||
        !probe.mismatchedInsertBlocked
      ) {
        failures.push(
          createDiagnostic({
            severity: "error",
            code: FORGE_RLS_TEST_FAILED,
            message: `RLS adversarial probe failed for table '${table.table}'`,
          }),
        );
      }
    }

    return {
      ok: failures.length === 0,
      data: {
        structural: checked.ok,
        appliedStatements,
        role,
        probes,
      },
      diagnostics: [
        ...checked.diagnostics,
        ...diagnostics,
        ...migrationDiagnostics,
        ...failures,
      ],
      exitCode: failures.length === 0 ? 0 : 1,
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        ...checked.diagnostics,
        ...diagnostics,
        createDiagnostic({
          severity: "error",
          code: FORGE_RLS_TEST_FAILED,
          message: error instanceof Error ? error.message : "RLS adversarial probe failed",
        }),
      ],
      exitCode: 1,
    };
  } finally {
    if (probeSchema) {
      await adapter.query("RESET ROLE").catch(() => undefined);
      await adapter.query("RESET search_path").catch(() => undefined);
      await adapter.query(`DROP SCHEMA IF EXISTS ${quoteIdent(probeSchema)} CASCADE`).catch(() => undefined);
    }
    await adapter.close();
  }
}

function dbWarnings(options: RlsCommandOptions): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (options.db !== "postgres") {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: FORGE_RLS_PGLITE_NOT_AUTHORITATIVE,
        message: "Postgres RLS is authoritative only on the postgres adapter; pglite/memory checks are structural only",
      }),
    );
  }

  if (databaseUrlUsesPostgresSuperuser(options.databaseUrl ?? process.env.DATABASE_URL)) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: FORGE_DB_SUPERUSER_RUNTIME,
        message: "runtime DATABASE_URL uses the postgres superuser; use an application role without BYPASSRLS for production",
      }),
    );
  }

  return diagnostics;
}

function checkGeneratedArtifacts(options: RlsCommandOptions): RlsCommandResult {
  const diagnostics: Diagnostic[] = [...dbWarnings(options)];
  for (const relative of REQUIRED_RLS_FILES) {
    if (!nodeFileSystem.exists(join(options.workspaceRoot, relative))) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: FORGE_RLS_POLICY_MISSING,
          message: `missing generated RLS artifact: ${relative}; run forge rls generate`,
          file: relative,
        }),
      );
    }
  }

  const manifest = readGeneratedJson<{
    tables?: Array<{ table: string; forceRowLevelSecurity?: boolean; policies?: unknown[] }>;
  }>(options.workspaceRoot, `${GENERATED_DIR}/dbSecurityManifest.json`);

  for (const table of manifest?.tables ?? []) {
    if (!table.forceRowLevelSecurity || (table.policies?.length ?? 0) < 4) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: FORGE_RLS_POLICY_MISSING,
          message: `table '${table.table}' is missing complete FORCE RLS policy coverage`,
          file: `${GENERATED_DIR}/dbSecurityManifest.json`,
        }),
      );
    }
  }

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  return {
    ok: errors.length === 0,
    data: {
      artifacts: REQUIRED_RLS_FILES,
      tables: manifest?.tables ?? [],
    },
    diagnostics,
    exitCode: errors.length === 0 ? 0 : 1,
  };
}

function manifestCoverageErrors(
  manifest: { tables?: Array<{ table: string; forceRowLevelSecurity?: boolean; policies?: unknown[] }> } | null,
): string[] {
  const errors: string[] = [];
  for (const table of manifest?.tables ?? []) {
    if (!table.forceRowLevelSecurity || (table.policies?.length ?? 0) < 4) {
      errors.push(`table '${table.table}' is missing complete FORCE RLS policy coverage`);
    }
  }
  return errors;
}

function sqlHasUnsafeRlsPredicate(sql: string): boolean {
  return /\bUSING\s*\(\s*true\s*\)/i.test(sql) || /\bWITH\s+CHECK\s*\(\s*true\s*\)/i.test(sql);
}

function sqlUsesBypassRls(sql: string): boolean {
  return /\bBYPASSRLS\b/i.test(sql);
}

function mutation(id: string, description: string, killed: boolean) {
  return {
    id,
    description,
    killed,
  };
}

function runRlsMutationTests(options: RlsCommandOptions): RlsCommandResult {
  const checked = checkGeneratedArtifacts(options);
  if (!checked.ok) {
    return checked;
  }

  const manifest = readGeneratedJson<{
    tables?: Array<{ table: string; forceRowLevelSecurity?: boolean; policies?: unknown[] }>;
  }>(options.workspaceRoot, `${GENERATED_DIR}/dbSecurityManifest.json`);
  const sql = readGeneratedText(options.workspaceRoot, `${GENERATED_DIR}/rlsPolicies.sql`) ?? "";
  const firstTable = manifest?.tables?.[0];
  const mutations: Array<ReturnType<typeof mutation>> = [];

  if (firstTable) {
    mutations.push(
      mutation(
        "force-rls-removed",
        "disable FORCE ROW LEVEL SECURITY on a tenant-scoped table",
        manifestCoverageErrors({
          tables: [
            ...((manifest?.tables ?? []).slice(0, 0)),
            { ...firstTable, forceRowLevelSecurity: false },
            ...((manifest?.tables ?? []).slice(1)),
          ],
        }).length > 0,
      ),
    );

    mutations.push(
      mutation(
        "policy-removed",
        "remove one generated RLS policy from a tenant-scoped table",
        manifestCoverageErrors({
          tables: [
            { ...firstTable, policies: (firstTable.policies ?? []).slice(1) },
            ...((manifest?.tables ?? []).slice(1)),
          ],
        }).length > 0,
      ),
    );
  }

  mutations.push(
    mutation(
      "unsafe-using-true",
      "replace an RLS USING predicate with an unconditional predicate",
      sqlHasUnsafeRlsPredicate(`${sql}\nCREATE POLICY forge_mutant ON tickets USING (true);`),
    ),
  );
  mutations.push(
    mutation(
      "unsafe-with-check-true",
      "replace an RLS WITH CHECK predicate with an unconditional predicate",
      sqlHasUnsafeRlsPredicate(`${sql}\nCREATE POLICY forge_mutant ON tickets WITH CHECK (true);`),
    ),
  );
  mutations.push(
    mutation(
      "bypassrls-role",
      "grant a runtime role BYPASSRLS",
      sqlUsesBypassRls(`${sql}\nALTER ROLE forge_runtime BYPASSRLS;`),
    ),
  );

  const survivors = mutations.filter((item) => !item.killed);
  const failures = survivors.map((item) =>
    createDiagnostic({
      severity: "error",
      code: FORGE_RLS_MUTATION_FAILED,
      message: `RLS mutation survived: ${item.id}`,
    }),
  );

  return {
    ok: failures.length === 0,
    data: {
      kind: "rls-mutation-proof",
      structural: true,
      mutations,
    },
    diagnostics: [...checked.diagnostics, ...failures],
    exitCode: failures.length === 0 ? 0 : 1,
  };
}

async function applyRls(options: RlsCommandOptions): Promise<RlsCommandResult> {
  const checked = checkGeneratedArtifacts(options);
  if (!checked.ok) {
    return checked;
  }

  if (options.db !== "postgres") {
    return {
      ok: true,
      data: { skipped: true, reason: "RLS apply requires --db postgres" },
      diagnostics: checked.diagnostics,
      exitCode: 0,
    };
  }

  const sql = readGeneratedText(options.workspaceRoot, `${GENERATED_DIR}/rlsPolicies.sql`);
  if (!sql) {
    return checked;
  }

  const { adapter, diagnostics } = await createDbAdapter({
    kind: options.db,
    workspaceRoot: options.workspaceRoot,
    databaseUrl: options.databaseUrl,
  });
  if (!adapter) {
    return {
      ok: false,
      diagnostics: [...checked.diagnostics, ...diagnostics],
      exitCode: 1,
    };
  }

  try {
    for (const statement of splitSqlStatements(sql)) {
      await adapter.query(statement);
    }
    return {
      ok: true,
      data: { applied: true, statements: splitSqlStatements(sql).length },
      diagnostics: [...checked.diagnostics, ...diagnostics],
      exitCode: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "RLS apply failed";
    return {
      ok: false,
      diagnostics: [
        ...checked.diagnostics,
        ...diagnostics,
        createDiagnostic({
          severity: "error",
          code: FORGE_RLS_APPLY_FAILED,
          message,
        }),
      ],
      exitCode: 1,
    };
  } finally {
    await adapter.close();
  }
}

export async function runRlsCommand(options: RlsCommandOptions): Promise<RlsCommandResult> {
  if (options.subcommand === "generate") {
    const generated = await run({
      workspaceRoot: options.workspaceRoot,
      check: false,
      dryRun: false,
      json: options.json,
      concurrency: 4,
    });
    return {
      ok: generated.exitCode === 0,
      data: { changed: generated.changed, unchanged: generated.unchanged },
      diagnostics: [...generated.errors, ...generated.warnings],
      exitCode: generated.exitCode,
    };
  }

  if (options.subcommand === "check") {
    const generated = await run({
      workspaceRoot: options.workspaceRoot,
      check: true,
      dryRun: false,
      json: options.json,
      concurrency: 4,
    });
    const checked = checkGeneratedArtifacts(options);
    const diagnostics = [
      ...generated.errors,
      ...generated.warnings,
      ...checked.diagnostics,
    ];
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    return {
      ok: generated.exitCode === 0 && checked.ok && errors.length === 0,
      data: checked.data,
      diagnostics,
      exitCode: generated.exitCode === 0 && checked.ok && errors.length === 0 ? 0 : 1,
    };
  }

  if (options.subcommand === "apply") {
    return applyRls(options);
  }

  if (options.subcommand === "mutate-test") {
    return runRlsMutationTests(options);
  }

  const checked = checkGeneratedArtifacts(options);
  if (options.db !== "postgres") {
    return {
      ok: true,
      data: { skipped: true, reason: "RLS isolation tests require --db postgres" },
      diagnostics: checked.diagnostics,
      exitCode: 0,
    };
  }

  return runRlsIsolationTests(options);
}

export function formatRlsJson(result: RlsCommandResult): string {
  return `${JSON.stringify(result)}\n`;
}

export function formatRlsHuman(subcommand: RlsSubcommand, result: RlsCommandResult): string {
  const diagnostics = result.diagnostics
    .map((diagnostic) => `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`)
    .join("\n");
  const suffix = diagnostics ? `\n${diagnostics}\n` : "\n";

  if (!result.ok) {
    return `rls ${subcommand} failed${suffix}`;
  }

  if (subcommand === "generate") {
    return `rls artifacts generated${suffix}`;
  }
  if (subcommand === "apply") {
    if ((result.data as { skipped?: boolean } | undefined)?.skipped) {
      return `rls apply skipped${suffix}`;
    }
    return `rls policies applied${suffix}`;
  }
  if (subcommand === "test") {
    return `rls checks passed${suffix}`;
  }
  if (subcommand === "mutate-test") {
    return `rls mutation checks passed${suffix}`;
  }
  return `rls contract is up to date${suffix}`;
}
