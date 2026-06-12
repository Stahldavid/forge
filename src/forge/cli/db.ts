import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { buildSqlPlan } from "../compiler/data-graph/sql/ddl.ts";
import type { SqlPlan } from "../compiler/data-graph/sql/types.ts";
import { buildDataGraph } from "../compiler/data-graph/build.ts";
import { buildAppGraph } from "../compiler/app-graph/build.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import {
  FORGE_RLS_APPLY_FAILED,
  FORGE_RUNTIME_NOT_FOUND,
} from "../compiler/diagnostics/codes.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { discover } from "../compiler/orchestrator/discover.ts";
import { loadManifest } from "../compiler/orchestrator/manifest.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { DataGraph } from "../compiler/types/data-graph.ts";
import { createDbAdapter, type CreateDbAdapterOptions } from "../runtime/db/factory.ts";
import {
  applyMigrations,
  diffSqlPlan,
  getMigrationStatus,
  resetDatabase,
} from "../runtime/db/migrate.ts";
import type { DbAdapterKind } from "../runtime/db/adapter.ts";

export type DbSubcommand = "diff" | "migrate" | "reset" | "status" | "rls-check";

export interface DbCommandOptions {
  subcommand: DbSubcommand;
  workspaceRoot: string;
  db: DbAdapterKind;
  databaseUrl?: string;
  json: boolean;
}

export interface DbCommandResult {
  ok: boolean;
  data?: unknown;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  return JSON.parse(raw) as T;
}

function readGeneratedText(workspaceRoot: string, relative: string): string | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  return stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
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

async function applyRlsSqlIfPostgres(
  adapter: Awaited<ReturnType<typeof createDbAdapter>>["adapter"],
  workspaceRoot: string,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  if (!adapter || adapter.kind !== "postgres") {
    return diagnostics;
  }

  const sql = readGeneratedText(workspaceRoot, `${GENERATED_DIR}/rlsPolicies.sql`);
  if (!sql) {
    return diagnostics;
  }

  try {
    for (const statement of splitSqlStatements(sql)) {
      await adapter.query(statement);
    }
  } catch (error) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: FORGE_RLS_APPLY_FAILED,
        message: error instanceof Error ? error.message : "failed to apply RLS policies",
      }),
    );
  }

  return diagnostics;
}

async function loadSqlPlan(workspaceRoot: string): Promise<{
  plan: SqlPlan | null;
  diagnostics: Diagnostic[];
}> {
  const fromDisk = readGeneratedJson<SqlPlan>(
    workspaceRoot,
    `${GENERATED_DIR}/sqlPlan.json`,
  );

  if (fromDisk) {
    return { plan: fromDisk, diagnostics: [] };
  }

  const dataGraph = readGeneratedJson<DataGraph>(
    workspaceRoot,
    `${GENERATED_DIR}/dataGraph.json`,
  );

  if (dataGraph) {
    return { plan: buildSqlPlan(dataGraph), diagnostics: dataGraph.diagnostics ?? [] };
  }

  const ctx = discover({ workspaceRoot });
  const manifest = loadManifest(ctx.cacheDir);
  const appGraph = await buildAppGraph({
    workspaceRoot: ctx.workspaceRoot,
    sources: ctx.sources,
    prior: manifest.priorAppGraph,
    tsconfigPath: ctx.tsconfigPath ?? undefined,
  });
  const built = buildDataGraph(appGraph);

  return {
    plan: buildSqlPlan(built),
    diagnostics: built.diagnostics,
  };
}

function adapterOptions(options: DbCommandOptions): CreateDbAdapterOptions {
  return {
    kind: options.db,
    workspaceRoot: options.workspaceRoot,
    databaseUrl: options.databaseUrl,
  };
}

function sqlPlanDiagnostics(plan: SqlPlan): Diagnostic[] {
  return Array.isArray(plan.diagnostics) ? plan.diagnostics : [];
}

export async function runDbCommand(options: DbCommandOptions): Promise<DbCommandResult> {
  const { plan, diagnostics: planDiagnostics } = await loadSqlPlan(options.workspaceRoot);

  if (!plan) {
    return {
      ok: false,
      diagnostics: [
        ...planDiagnostics,
        createDiagnostic({
          severity: "error",
          code: FORGE_RUNTIME_NOT_FOUND,
          message: `missing ${GENERATED_DIR}/sqlPlan.json; run forge generate first`,
        }),
      ],
      exitCode: 1,
    };
  }

  if (options.subcommand === "diff") {
    const diagnostics = sqlPlanDiagnostics(plan);
    const { adapter } = await createDbAdapter(adapterOptions(options));
    let appliedChecksum: string | null = null;

    if (adapter) {
      try {
        await applyMigrations(adapter, plan);
        const status = await getMigrationStatus(adapter);
        appliedChecksum = status.applied.at(-1)?.checksum ?? null;
      } finally {
        await adapter.close();
      }
    }

    const diff = diffSqlPlan(plan, appliedChecksum);
    return {
      ok: true,
      data: diff,
      diagnostics: [...diagnostics, ...planDiagnostics],
      exitCode: 0,
    };
  }

  const diagnostics = sqlPlanDiagnostics(plan);
  const { adapter, diagnostics: adapterDiagnostics } = await createDbAdapter(
    adapterOptions(options),
  );

  if (!adapter) {
    return {
      ok: false,
      diagnostics: [...diagnostics, ...planDiagnostics, ...adapterDiagnostics],
      exitCode: 1,
    };
  }

  try {
    if (options.subcommand === "migrate") {
      const migrationDiagnostics = await applyMigrations(adapter, plan);
      const rlsDiagnostics = await applyRlsSqlIfPostgres(adapter, options.workspaceRoot);
      const errors = migrationDiagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      );
      const rlsErrors = rlsDiagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      );
      return {
        ok: errors.length === 0 && rlsErrors.length === 0,
        data: { migrationId: plan.migrationId, checksum: plan.checksum },
        diagnostics: [
          ...diagnostics,
          ...planDiagnostics,
          ...migrationDiagnostics,
          ...rlsDiagnostics,
        ],
        exitCode: errors.length === 0 && rlsErrors.length === 0 ? 0 : 1,
      };
    }

    if (options.subcommand === "reset") {
      const migrationDiagnostics = await resetDatabase(adapter, plan);
      const errors = migrationDiagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      );
      return {
        ok: errors.length === 0,
        data: { reset: true, migrationId: plan.migrationId },
        diagnostics: [...diagnostics, ...planDiagnostics, ...migrationDiagnostics],
        exitCode: errors.length === 0 ? 0 : 1,
      };
    }

    if (options.subcommand === "status") {
      await applyMigrations(adapter, plan);
      const status = await getMigrationStatus(adapter);
      return {
        ok: true,
        data: status,
        diagnostics: [...diagnostics, ...planDiagnostics],
        exitCode: 0,
      };
    }

    return {
      ok: false,
      diagnostics: planDiagnostics,
      exitCode: 1,
    };
  } finally {
    await adapter.close();
  }
}

export function formatDbJson(result: DbCommandResult): string {
  return `${JSON.stringify({
    ok: result.ok,
    data: result.data,
    diagnostics: result.diagnostics,
    exitCode: result.exitCode,
  })}\n`;
}

export function formatDbHuman(subcommand: DbSubcommand, result: DbCommandResult): string {
  if (!result.ok) {
    return result.diagnostics
      .map((diagnostic) => `error ${diagnostic.code}: ${diagnostic.message}`)
      .join("\n")
      .concat("\n");
  }

  if (subcommand === "migrate") {
    return `migrated ${(result.data as { migrationId: string }).migrationId}\n`;
  }

  if (subcommand === "reset") {
    return "database reset complete\n";
  }

  if (subcommand === "status" || subcommand === "diff") {
    return `${JSON.stringify(result.data, null, 2)}\n`;
  }

  return "";
}
