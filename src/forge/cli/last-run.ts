import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LastRunRecord {
  schemaVersion: "0.1.0";
  command: string;
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  code?: string;
  failureKind?: string;
  message?: string;
  nextActions: string[];
  details?: Record<string, unknown>;
}

export interface LastRunCommandResult {
  ok: boolean;
  record: LastRunRecord | null;
  path: string;
  exitCode: 0 | 1;
}

function lastRunPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".forge", "last-run.json");
}

export function writeLastRunRecord(workspaceRoot: string, record: LastRunRecord): void {
  const file = lastRunPath(workspaceRoot);
  mkdirSync(join(workspaceRoot, ".forge"), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export function readLastRunRecord(workspaceRoot: string): LastRunRecord | null {
  const file = lastRunPath(workspaceRoot);
  if (!existsSync(file)) {
    return null;
  }
  return JSON.parse(readFileSync(file, "utf8")) as LastRunRecord;
}

export function runLastCommand(options: { workspaceRoot: string }): LastRunCommandResult {
  const path = lastRunPath(options.workspaceRoot);
  const record = readLastRunRecord(options.workspaceRoot);
  return {
    ok: record !== null,
    record,
    path,
    exitCode: record ? 0 : 1,
  };
}

export function formatLastJson(result: LastRunCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatLastHuman(result: LastRunCommandResult): string {
  if (!result.record) {
    return `No last run record found at ${result.path}\n`;
  }
  const lines = [
    `Last Forge run: ${result.record.command}`,
    `OK: ${result.record.ok}`,
    `Finished: ${result.record.finishedAt}`,
    `Duration: ${result.record.durationMs}ms`,
  ];
  if (result.record.code) {
    lines.push(`Code: ${result.record.code}`);
  }
  if (result.record.failureKind) {
    lines.push(`Failure: ${result.record.failureKind}`);
  }
  if (result.record.message) {
    lines.push(`Message: ${result.record.message}`);
  }
  if (result.record.nextActions.length > 0) {
    lines.push("Next actions:");
    for (const action of result.record.nextActions) {
      lines.push(`  ${action}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
