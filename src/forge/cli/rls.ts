import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../compiler/orchestrator/run.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import {
  FORGE_DB_SUPERUSER_RUNTIME,
  FORGE_RLS_APPLY_FAILED,
  FORGE_RLS_PGLITE_NOT_AUTHORITATIVE,
  FORGE_RLS_POLICY_MISSING,
  FORGE_RLS_TEST_FAILED,
} from "../compiler/diagnostics/codes.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { DbAdapterKind } from "../runtime/db/adapter.ts";
import { createDbAdapter } from "../runtime/db/factory.ts";
import { databaseUrlUsesPostgresSuperuser } from "../runtime/db/session-context.ts";

export type RlsSubcommand = "generate" | "check" | "apply" | "test";

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
  if (!existsSync(absolute)) {
    return null;
  }
  return stripDeterministicHeader(readFileSync(absolute, "utf8"));
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
    if (!existsSync(join(options.workspaceRoot, relative))) {
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

  const checked = checkGeneratedArtifacts(options);
  if (options.db !== "postgres") {
    return {
      ok: true,
      data: { skipped: true, reason: "RLS isolation tests require --db postgres" },
      diagnostics: checked.diagnostics,
      exitCode: 0,
    };
  }

  return {
    ok: checked.ok,
    data: { structural: checked.ok },
    diagnostics: checked.ok
      ? checked.diagnostics
      : [
          ...checked.diagnostics,
          createDiagnostic({
            severity: "error",
            code: FORGE_RLS_TEST_FAILED,
            message: "RLS structural check failed before database isolation test",
          }),
        ],
    exitCode: checked.ok ? 0 : 1,
  };
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
  return `rls contract is up to date${suffix}`;
}
