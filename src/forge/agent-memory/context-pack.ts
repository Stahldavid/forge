import { DeltaStore } from "../delta/store.ts";
import type { AgentMemoryContextPack, AgentMemoryEventRecord } from "./types.ts";

export async function buildAgentMemoryContext(input: {
  workspaceRoot: string;
  entry?: string;
  limit?: number;
}): Promise<AgentMemoryContextPack> {
  const store = await DeltaStore.open(input.workspaceRoot);
  try {
    const target = input.entry;
    const events = await store.listAgentMemoryEvents({ target, limit: input.limit ?? 50 });
    const timeline = target ? await store.semanticTimeline({ target, limit: input.limit ?? 50 }) : undefined;
    const current = target ? timeline?.currentState ?? {} : await currentSessionState(store);
    return {
      ok: true,
      scope: target ? "entry" : "current",
      entry: target,
      currentState: current,
      agentMemory: {
        goals: events
          .filter((event) => event.normalizedKind === "agent.prompt.submitted")
          .map((event) => ({
            source: event.sourceName,
            summary: event.summary ?? "Prompt submitted",
            confidence: event.confidence,
          })),
        toolCalls: toolCalls(events),
        files: uniqueStrings(events.flatMap((event) => bindings(event).files)),
        entries: uniqueStrings(events.flatMap((event) => bindings(event).entries)),
        approvals: events
          .filter((event) => event.normalizedKind.startsWith("approval."))
          .map((event) => ({
            source: event.sourceName,
            status: event.normalizedKind.replace(/^approval\./, ""),
            summary: event.summary,
          })),
        proofs: uniqueStrings(events.flatMap((event) => bindings(event).proofs))
          .map((kind) => ({ kind })),
        events,
        openQuestions: timeline?.openQuestions ?? [],
      },
      exitCode: 0,
    };
  } finally {
    await store.close();
  }
}

async function currentSessionState(store: DeltaStore): Promise<Record<string, unknown>> {
  const session = await store.currentWorkSession();
  return session
    ? {
        sessionId: session.id,
        title: session.title,
        inferredIntent: session.inferredIntent,
        confidence: session.confidence,
        status: session.status,
      }
    : {};
}

function toolCalls(events: AgentMemoryEventRecord[]): AgentMemoryContextPack["agentMemory"]["toolCalls"] {
  return events
    .filter((event) => event.normalizedKind.startsWith("agent.tool"))
    .map((event) => {
      const eventBindings = bindings(event);
      return {
        source: event.sourceName,
        tool: eventBindings.toolName ?? "unknown",
        status: eventBindings.status,
        summary: event.summary,
      };
    });
}

function bindings(event: AgentMemoryEventRecord): {
  toolName?: string;
  status?: string;
  files: string[];
  entries: string[];
  proofs: string[];
} {
  const raw = event.data.bindings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { files: [], entries: [], proofs: [] };
  }
  const record = raw as Record<string, unknown>;
  return {
    toolName: typeof record.toolName === "string" ? record.toolName : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    files: arrayOfStrings(record.files),
    entries: arrayOfStrings(record.entries),
    proofs: arrayOfStrings(record.proofs),
  };
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}
