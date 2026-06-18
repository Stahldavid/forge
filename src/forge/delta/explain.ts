import { DeltaStore } from "./store.ts";

export interface DeltaExplainResult {
  ok: true;
  thing: string;
  explanation: Record<string, unknown>;
  exitCode: 0;
}

export async function runDeltaExplain(input: {
  workspaceRoot: string;
  thing: string;
}): Promise<DeltaExplainResult> {
  const store = await DeltaStore.open(input.workspaceRoot);
  try {
    return {
      ok: true,
      thing: input.thing,
      explanation: await store.explain(input.thing),
      exitCode: 0,
    };
  } finally {
    await store.close();
  }
}

export function formatDeltaExplainHuman(result: DeltaExplainResult): string {
  const explanation = result.explanation;
  if (explanation.type === "work-session") {
    const session = explanation.session as Record<string, unknown> | null | undefined;
    const lines = [result.thing, ""];
    if (!session) {
      lines.push("work session not found");
      return `${lines.join("\n")}\n`;
    }
    lines.push("Work session:");
    lines.push(`  ${String(session.id)}`);
    lines.push(`  title: ${String(session.title ?? "Work session")}`);
    lines.push(`  status: ${String(session.status ?? "unknown")}`);
    lines.push(`  confidence: ${Number(session.confidence ?? 0).toFixed(2)}`);
    if (session.summary) {
      lines.push(`  summary: ${String(session.summary)}`);
    }
    const operations = Array.isArray(session.operations) ? session.operations as Array<Record<string, unknown>> : [];
    lines.push("");
    lines.push("Operations:");
    for (const operation of operations.slice(-12)) {
      const timestamp = typeof operation.timestamp === "string" ? operation.timestamp.slice(11, 16) : "??:??";
      lines.push(`  ${timestamp} ${String(operation.kind)}${operation.summary ? ` ${String(operation.summary)}` : ""}`);
    }
    return `${lines.join("\n")}\n`;
  }
  const runtime = explanation.runtime as Record<string, unknown> | null | undefined;
  const semanticTimeline = explanation.semanticTimeline as Record<string, unknown> | null | undefined;
  const semanticEvents = semanticTimeline && Array.isArray(semanticTimeline.events)
    ? semanticTimeline.events as Array<Record<string, unknown>>
    : [];
  const currentState = semanticTimeline && semanticTimeline.currentState && typeof semanticTimeline.currentState === "object"
    ? semanticTimeline.currentState as Record<string, unknown>
    : {};
  const proofs = Array.isArray(explanation.proofs) ? explanation.proofs as Array<Record<string, unknown>> : [];
  const workSessions = Array.isArray(explanation.workSessions) ? explanation.workSessions as Array<Record<string, unknown>> : [];
  const lines = [result.thing, ""];
  lines.push("Type:");
  lines.push(`  ${String(explanation.type ?? "unknown")}`);
  lines.push("");
  if (runtime) {
    lines.push("Runtime:");
    lines.push(`  kind: ${String(runtime.entry_kind ?? "unknown")}`);
    lines.push(`  result: ${String(runtime.result ?? "unknown")}`);
    if (runtime.diagnostic_code) {
      lines.push(`  diagnostic: ${String(runtime.diagnostic_code)}`);
    }
    if (runtime.trace_id) {
      lines.push(`  trace: ${String(runtime.trace_id)}`);
    }
    lines.push("");
  }
  lines.push("Semantic timeline:");
  if (semanticEvents.length === 0) {
    lines.push("  no matching operations");
  } else {
    for (const item of semanticEvents.slice(-12)) {
      const timestamp = typeof item.timestamp === "string" ? item.timestamp.slice(11, 16) : "??:??";
      lines.push(`  ${timestamp} ${String(item.kind)} ${String(item.title ?? item.summary ?? "")}`.trimEnd());
    }
  }
  if (Object.keys(currentState).length > 0) {
    lines.push("");
    lines.push("Current state:");
    for (const [key, value] of Object.entries(currentState)) {
      if (value !== undefined) {
        lines.push(`  ${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
      }
    }
  }
  lines.push("");
  lines.push("Introduced in:");
  if (workSessions.length === 0) {
    lines.push("  no inferred work session linked");
  } else {
    const session = workSessions[0]!;
    lines.push(`  ${String(session.id)} - ${String(session.title ?? "Work session")}`);
    lines.push(`  confidence: ${Number(session.confidence ?? 0).toFixed(2)}`);
    if (session.summary) {
      lines.push(`  ${String(session.summary)}`);
    }
  }
  lines.push("");
  lines.push("Proofs:");
  if (proofs.length === 0) {
    lines.push("  none recorded");
  } else {
    for (const proof of proofs.slice(-6)) {
      lines.push(`  ${String(proof.proof_kind)} -> ${String(proof.result)}`);
    }
  }
  lines.push("");
  lines.push("Git:");
  lines.push(explanation.git ? "  linked metadata recorded" : "  no linked commit yet");
  return `${lines.join("\n")}\n`;
}

export function formatDeltaExplainJson(result: DeltaExplainResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
