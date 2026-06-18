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
  const runtime = explanation.runtime as Record<string, unknown> | null | undefined;
  const timeline = Array.isArray(explanation.timeline) ? explanation.timeline as Array<Record<string, unknown>> : [];
  const proofs = Array.isArray(explanation.proofs) ? explanation.proofs as Array<Record<string, unknown>> : [];
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
  lines.push("Timeline:");
  if (timeline.length === 0) {
    lines.push("  no matching operations");
  } else {
    for (const item of timeline.slice(-12)) {
      const timestamp = typeof item.timestamp === "string" ? item.timestamp.slice(11, 16) : "??:??";
      lines.push(`  ${timestamp} ${String(item.kind)}${item.summary ? ` ${String(item.summary)}` : ""}`);
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

