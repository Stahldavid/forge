import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  const store = await DeltaStore.open(input.workspaceRoot, { access: "read" });
  try {
    const explanation = await store.explain(input.thing);
    return {
      ok: true,
      thing: input.thing,
      explanation: enrichWithCurrentAgentContract(input.workspaceRoot, input.thing, explanation),
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
    if (runtime.source) {
      lines.push(`  source: ${String(runtime.source)}`);
    }
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
  const currentContract = explanation.currentContract as Record<string, unknown> | null | undefined;
  if (currentContract) {
    lines.push("");
    lines.push("Current contract:");
    lines.push(`  kind: ${String(currentContract.kind ?? "unknown")}`);
    lines.push(`  name: ${String(currentContract.name ?? result.thing)}`);
    if (currentContract.auth) {
      lines.push(`  auth: ${String(currentContract.auth)}`);
    }
    if (currentContract.policy) {
      lines.push(`  policy: ${String(currentContract.policy)}`);
    }
    if (currentContract.sourceFile) {
      lines.push(`  file: ${String(currentContract.sourceFile)}`);
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

function enrichWithCurrentAgentContract(
  workspaceRoot: string,
  thing: string,
  explanation: Record<string, unknown>,
): Record<string, unknown> {
  const currentContract = currentContractForThing(workspaceRoot, thing);
  if (!currentContract) {
    return explanation;
  }
  const runtime = explanation.runtime && typeof explanation.runtime === "object"
    ? explanation.runtime as Record<string, unknown>
    : null;
  return {
    ...explanation,
    type: explanation.type === "unknown" ? "runtime-entry" : explanation.type,
    runtime: runtime ?? {
      entry_name: currentContract.name,
      entry_kind: currentContract.kind,
      result: "defined",
      source: "agentContract",
      ...(currentContract.policy ? { policy: currentContract.policy } : {}),
      ...(typeof currentContract.tenantScoped === "boolean" ? { tenant_scoped: currentContract.tenantScoped } : {}),
      ...(typeof currentContract.needsApproval === "boolean" ? { needs_approval: currentContract.needsApproval } : {}),
    },
    currentContract,
  };
}

function currentContractForThing(workspaceRoot: string, thing: string): Record<string, unknown> | undefined {
  const contractPath = join(workspaceRoot, "src", "forge", "_generated", "agentContract.json");
  if (!existsSync(contractPath)) {
    return undefined;
  }
  try {
    const contract = JSON.parse(readFileSync(contractPath, "utf8")) as Record<string, unknown>;
    const collections: Array<[keyof typeof runtimeKinds, string]> = [
      ["commands", "command"],
      ["queries", "query"],
      ["liveQueries", "liveQuery"],
      ["actions", "action"],
      ["workflows", "workflow"],
    ];
    for (const [collection, kind] of collections) {
      const entries = Array.isArray(contract[collection]) ? contract[collection] as Record<string, unknown>[] : [];
      for (const entry of entries) {
        const name = runtimeEntryName(entry);
        if (!name) {
          continue;
        }
        if (name === thing || `${kind}:${name}` === thing || entry.id === thing || entry.exportName === thing) {
          return {
            source: "src/forge/_generated/agentContract.json",
            kind,
            name,
            ...(stringValue(entry.auth) ? { auth: stringValue(entry.auth) } : {}),
            ...(stringValue(entry.policy) ? { policy: stringValue(entry.policy) } : {}),
            ...(typeof entry.tenantScoped === "boolean" ? { tenantScoped: entry.tenantScoped } : {}),
            ...(typeof entry.needsApproval === "boolean" ? { needsApproval: entry.needsApproval } : {}),
            ...(stringValue(entry.risk) ? { risk: stringValue(entry.risk) } : {}),
            ...(stringValue(entry.file) ? { sourceFile: stringValue(entry.file) } : {}),
            ...(stringValue(entry.path) ? { sourceFile: stringValue(entry.path) } : {}),
          };
        }
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const runtimeKinds = {
  commands: "command",
  queries: "query",
  liveQueries: "liveQuery",
  actions: "action",
  workflows: "workflow",
} as const;

function runtimeEntryName(entry: Record<string, unknown>): string | undefined {
  return stringValue(entry.name)
    ?? stringValue(entry.exportName)
    ?? stringValue(entry.id)
    ?? stringValue(entry.entryName);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
