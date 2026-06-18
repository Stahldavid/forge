import { DeltaStore, type DeltaStatus } from "./store.ts";

export interface DeltaStatusResult extends DeltaStatus {
  exitCode: 0;
}

export async function runDeltaStatus(workspaceRoot: string): Promise<DeltaStatusResult> {
  const store = await DeltaStore.open(workspaceRoot);
  try {
    return {
      ...(await store.status()),
      exitCode: 0,
    };
  } finally {
    await store.close();
  }
}

export function formatDeltaStatusHuman(result: DeltaStatusResult): string {
  const lines = ["Forge Delta", ""];
  lines.push("Status:");
  lines.push(`  ${result.recording ? "recording enabled" : "recording disabled"}`);
  lines.push(`  local store: ${result.store}`);
  lines.push("");
  lines.push("Current session:");
  if (result.session) {
    lines.push(`  ${result.session.id}`);
    lines.push(`  started: ${result.session.startedAt}`);
    lines.push(`  operations: ${result.session.operationCount}`);
  } else {
    lines.push("  none");
  }
  lines.push("");
  lines.push("Recent operations:");
  if (result.recentOperations.length === 0) {
    lines.push("  none");
  } else {
    for (const operation of result.recentOperations) {
      lines.push(`  ${operation.timestamp.slice(11, 16)} ${operation.kind}${operation.summary ? ` ${operation.summary}` : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function formatDeltaStatusJson(result: DeltaStatusResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

