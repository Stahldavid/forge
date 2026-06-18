import { DeltaStore, type DeltaTimelineEntry } from "./store.ts";

export interface DeltaTimelineResult {
  ok: true;
  session?: string;
  entries: DeltaTimelineEntry[];
  exitCode: 0;
}

export async function runDeltaTimeline(input: {
  workspaceRoot: string;
  target?: string;
  kind?: string;
  session?: string;
  limit?: number;
}): Promise<DeltaTimelineResult> {
  const store = await DeltaStore.open(input.workspaceRoot);
  try {
    return {
      ok: true,
      session: input.session,
      entries: await store.timeline({ target: input.target, kind: input.kind, workSessionId: input.session, limit: input.limit }),
      exitCode: 0,
    };
  } finally {
    await store.close();
  }
}

export function formatDeltaTimelineHuman(result: DeltaTimelineResult): string {
  if (result.entries.length === 0) {
    return "Timeline\n\nno delta operations recorded\n";
  }
  const lines = [result.session ? `Timeline (${result.session})` : "Timeline", ""];
  for (const entry of result.entries) {
    const time = entry.timestamp.slice(11, 16);
    lines.push(`${time} ${entry.kind}${entry.summary ? ` ${entry.summary}` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatDeltaTimelineJson(result: DeltaTimelineResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
