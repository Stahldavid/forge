import { listQueries, runQuery, type ListQueriesResult, type RunQueryResult } from "../runtime/query/run-query.ts";
import { resolveAuthFromCli } from "../runtime/auth/resolve.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";

export type QuerySubcommand = "list" | "run";

export interface QueryCommandOptions {
  subcommand: "list" | "run";
  name?: string;
  args?: unknown;
  json: boolean;
  userId?: string;
  tenantId?: string;
  role?: string;
  workspaceRoot: string;
}

export interface QueryCommandResult {
  list?: ListQueriesResult;
  run?: RunQueryResult;
  exitCode: 0 | 1;
}

export async function runQueryCommand(
  options: QueryCommandOptions,
): Promise<QueryCommandResult> {
  if (options.subcommand === "list") {
    const list = listQueries(options.workspaceRoot);
    return { list, exitCode: list.exitCode };
  }

  if (!options.name) {
    return {
      run: {
        ok: false,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: "FORGE_CLI_USAGE",
            message: "forge query run requires a query name",
          }),
        ],
        exitCode: 1,
      },
      exitCode: 1,
    };
  }

  const auth = resolveAuthFromCli({
    userId: options.userId,
    tenantId: options.tenantId,
    role: options.role,
  });

  const run = await runQuery(options.workspaceRoot, options.name, {
    args: options.args,
    auth,
    userId: options.userId,
    tenantId: options.tenantId,
    role: options.role,
  });

  return { run, exitCode: run.exitCode };
}

export function formatQueryListHuman(list: ListQueriesResult): string {
  if (list.queries.length === 0) {
    return "no queries found\n";
  }

  const lines = ["name\tfile"];
  for (const query of list.queries) {
    lines.push(`${query.name}\t${query.file}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatQueryResultHuman(run: RunQueryResult): string {
  if (!run.ok) {
    const lines = run.diagnostics.map(
      (diagnostic) => `error ${diagnostic.code}: ${diagnostic.message}`,
    );
    return `${lines.join("\n")}\n`;
  }

  return `${JSON.stringify({ result: run.result, traceId: run.traceId }, null, 2)}\n`;
}

export function formatQueryJson(result: QueryCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
