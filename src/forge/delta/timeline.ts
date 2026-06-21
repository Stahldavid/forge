import { DeltaStore, type DeltaSemanticTimelineResult } from "./store.ts";

export interface DeltaTimelineResult {
  ok: true;
  session?: string;
  target?: string;
  rebuilt?: boolean;
  timeline: DeltaSemanticTimelineResult;
  exitCode: 0;
}

export async function runDeltaTimeline(input: {
  workspaceRoot: string;
  target?: string;
  kind?: string;
  session?: string;
  limit?: number;
  rebuild?: boolean;
}): Promise<DeltaTimelineResult> {
  const store = await DeltaStore.open(input.workspaceRoot, { access: input.rebuild ? "write" : "read" });
  try {
    if (input.rebuild) {
      await store.rebuildSemanticTimeline();
    }
    return {
      ok: true,
      session: input.session,
      target: input.target,
      rebuilt: input.rebuild || undefined,
      timeline: await store.semanticTimeline({ target: input.target, kind: input.kind, workSessionId: input.session, limit: input.limit }),
      exitCode: 0,
    };
  } finally {
    await store.close();
  }
}

export function formatDeltaTimelineHuman(result: DeltaTimelineResult): string {
  const timeline = result.timeline;
  if (timeline.events.length === 0) {
    return "Timeline\n\nno semantic timeline events recorded\n";
  }
  const title = timeline.entity
    ? `Timeline - ${timeline.entity.kind}:${timeline.entity.name}`
    : result.session
      ? `Timeline (${result.session})`
      : "Timeline";
  const lines = [title, ""];
  const grouped = new Map<string, typeof timeline.events>();
  for (const event of timeline.events) {
    const key = event.kind;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  for (const [kind, events] of grouped) {
    lines.push(formatTimelineSectionTitle(kind));
    for (const event of events) {
      const time = event.timestamp.slice(11, 16);
      const confidence = event.confidence < 0.8 ? ` likely (${event.confidence.toFixed(2)})` : "";
      lines.push(`  ${time} ${event.title}${confidence}`);
      const details = event.entities
        .filter((entity) => entity.role !== "primary")
        .slice(0, 4)
        .map((entity) => `${entity.kind}:${entity.name}`);
      if (details.length > 0) {
        lines.push(`       ${details.join(", ")}`);
      }
    }
    lines.push("");
  }
  if (Object.keys(timeline.currentState).length > 0) {
    lines.push("Current state");
    for (const [key, value] of Object.entries(timeline.currentState)) {
      if (value !== undefined) {
        lines.push(`  ${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
      }
    }
    lines.push("");
  }
  if (timeline.causalEdges.length > 0) {
    lines.push("Causality");
    for (const edge of timeline.causalEdges.slice(0, 8)) {
      lines.push(`  ${edge.kind}: ${edge.from} -> ${edge.to} (${edge.confidence.toFixed(2)})`);
    }
    lines.push("");
  }
  if (timeline.openQuestions.length > 0) {
    lines.push("Open questions");
    for (const question of timeline.openQuestions) {
      lines.push(`  ${question}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function formatDeltaTimelineJson(result: DeltaTimelineResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatTimelineSectionTitle(kind: string): string {
  return kind
    .split(".")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
