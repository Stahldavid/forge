import { listEntries, runEntry } from "../runtime/executor.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { RunEntryResult, ListEntriesResult } from "../runtime/executor.ts";

export interface RunCommandOptions {
  name?: string;
  list: boolean;
  json: boolean;
  mock: boolean;
  userId?: string;
  tenantId?: string;
  role?: string;
  workspaceRoot: string;
}

export interface RunCommandResult {
  list?: ListEntriesResult;
  run?: RunEntryResult;
  exitCode: 0 | 1;
}

export async function runRunCommand(
  options: RunCommandOptions,
): Promise<RunCommandResult> {
  const shouldList = options.list || !options.name;

  if (shouldList) {
    const list = listEntries(options.workspaceRoot);
    return { list, exitCode: list.exitCode };
  }

  const run = await runEntry(options.workspaceRoot, options.name!, {
    json: options.json,
    mock: options.mock,
    userId: options.userId,
    tenantId: options.tenantId,
    role: options.role,
  });

  return { run, exitCode: run.exitCode };
}

export function formatRunListHuman(list: ListEntriesResult): string {
  if (list.entries.length === 0) {
    return "no runtime entries found\n";
  }

  const lines = ["name\tkind\tfile"];
  for (const entry of list.entries) {
    lines.push(`${entry.name}\t${entry.kind}\t${entry.file}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatRunResultHuman(run: RunEntryResult): string {
  if (!run.ok) {
    const lines = run.diagnostics.map(
      (diagnostic) => `error ${diagnostic.code}: ${diagnostic.message}`,
    );
    return `${lines.join("\n")}\n`;
  }

  return `${JSON.stringify(run.result, null, 2)}\n`;
}

export function formatRunJson(result: RunCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function runUsageDiagnostic(): ReturnType<typeof createDiagnostic> {
  return createDiagnostic({
    severity: "error",
    code: "FORGE_CLI_USAGE",
    message: "forge run requires an entry name, or use --list",
  });
}
