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
  lines.push("Current work session:");
  if (result.workSession) {
    lines.push(`  ${result.workSession.id}`);
    lines.push(`  title: ${result.workSession.title}`);
    lines.push(`  status: ${result.workSession.status}`);
    lines.push(`  confidence: ${result.workSession.confidence.toFixed(2)}`);
    lines.push(`  operations: ${result.workSession.operationCount}`);
    if (result.workSession.gitBranch) {
      lines.push(`  branch: ${result.workSession.gitBranch}`);
    }
    if (result.workSession.reasons.length > 0) {
      lines.push("");
      lines.push("Why this session:");
      for (const reason of result.workSession.reasons.slice(0, 5)) {
        lines.push(`  - ${reason.signal}${reason.value ? `: ${reason.value}` : ""}`);
      }
    }
  } else {
    lines.push("  none");
  }
  lines.push("");
  lines.push("Latest recorder session:");
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
