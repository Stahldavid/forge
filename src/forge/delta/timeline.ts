import { DeltaStore, type DeltaSemanticTimelineResult } from "./store.ts";

export interface DeltaTimelineResult {
  ok: true;
  session?: string;
  target?: string;
  rebuilt?: boolean;
  causal?: boolean;
  staleProofs?: boolean;
  timeline: DeltaSemanticTimelineResult;
  summary: {
    events: number;
    causalEdges: number;
    proofStatus?: string;
    staleProofs: Array<{ proof: string; lastRunAt?: string; lastRelevantChangeAt?: string }>;
    causalChains: Array<{ kind: string; from: string; to: string; confidence: number; reason?: Record<string, unknown> }>;
  };
  exitCode: 0;
}

export async function runDeltaTimeline(input: {
  workspaceRoot: string;
  target?: string;
  kind?: string;
  session?: string;
  limit?: number;
  rebuild?: boolean;
  causal?: boolean;
  staleProofs?: boolean;
}): Promise<DeltaTimelineResult> {
  const store = await DeltaStore.open(input.workspaceRoot, { access: input.rebuild ? "write" : "read" });
  try {
    if (input.rebuild) {
      await store.rebuildSemanticTimeline();
    }
    const timeline = await store.semanticTimeline({ target: input.target, kind: input.kind, workSessionId: input.session, limit: input.limit });
    return {
      ok: true,
      session: input.session,
      target: input.target,
      rebuilt: input.rebuild || undefined,
      causal: input.causal || undefined,
      staleProofs: input.staleProofs || undefined,
      timeline,
      summary: summarizeTimeline(timeline),
      exitCode: 0,
    };
  } finally {
    await store.close();
  }
}

function summarizeTimeline(timeline: DeltaSemanticTimelineResult): DeltaTimelineResult["summary"] {
  const eventById = new Map(timeline.events.map((event) => [event.id, event]));
  const proofStatus = typeof timeline.currentState.proofStatus === "string" ? timeline.currentState.proofStatus : undefined;
  const rawProofEntities = uniqueStrings(
    timeline.events.flatMap((event) =>
      event.entities
        .filter((entity) => entity.kind === "proof")
        .map((entity) => entity.name)
    ),
  );
  const proofEntities = timeline.entity?.kind === "proof"
    ? [timeline.entity.name]
    : rawProofEntities.filter((proof) => !/^forge\s/u.test(proof));
  const lastProofRun = latestTimestamp(timeline.events.filter((event) => event.kind === "proof.passed" || event.kind === "proof.failed"));
  const lastRelevantChange = latestTimestamp(timeline.events.filter((event) =>
    event.kind === "modified" ||
    event.kind === "policy.changed" ||
    event.kind === "generated" ||
    event.kind === "imported"
  ));
  return {
    events: timeline.events.length,
    causalEdges: timeline.causalEdges.length,
    ...(proofStatus ? { proofStatus } : {}),
    staleProofs: proofStatus === "stale"
      ? (proofEntities.length > 0 ? proofEntities : ["unknown"]).map((proof) => ({
        proof,
        ...(lastProofRun ? { lastRunAt: lastProofRun } : {}),
        ...(lastRelevantChange ? { lastRelevantChangeAt: lastRelevantChange } : {}),
      }))
      : [],
    causalChains: timeline.causalEdges.slice(0, 12).map((edge) => ({
      kind: edge.kind,
      from: eventById.get(edge.from)?.title ?? edge.from,
      to: eventById.get(edge.to)?.title ?? edge.to,
      confidence: edge.confidence,
      ...(edge.reason ? { reason: edge.reason } : {}),
    })),
  };
}

function latestTimestamp(events: DeltaSemanticTimelineResult["events"]): string | undefined {
  return [...events].sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0]?.timestamp;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
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
  if (result.summary.proofStatus || result.summary.staleProofs.length > 0) {
    lines.push("Proof status");
    if (result.summary.proofStatus) {
      lines.push(`  status: ${result.summary.proofStatus}`);
    }
    for (const proof of result.summary.staleProofs) {
      lines.push(`  stale: ${proof.proof}${proof.lastRelevantChangeAt ? ` after ${proof.lastRelevantChangeAt}` : ""}`);
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
