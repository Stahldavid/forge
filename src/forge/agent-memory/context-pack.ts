import { DeltaStore } from "../delta/store.ts";
import type { AgentMemoryContextEvent, AgentMemoryContextPack, AgentMemoryEventRecord } from "./types.ts";

export async function buildAgentMemoryContext(input: {
  workspaceRoot: string;
  entry?: string;
  limit?: number;
}): Promise<AgentMemoryContextPack> {
  const store = await DeltaStore.open(input.workspaceRoot, { access: "read" });
  try {
    const target = input.entry;
    const events = await store.listAgentMemoryEvents({ target, limit: input.limit ?? 50 });
    const timeline = target ? await store.semanticTimeline({ target, limit: input.limit ?? 50 }) : undefined;
    const current = target ? timeline?.currentState ?? {} : await currentSessionState(store);
    const goals = events
      .filter((event) => event.normalizedKind === "agent.prompt.submitted")
      .map((event) => ({
        source: event.sourceName,
        summary: event.summary ?? "Prompt submitted",
        confidence: event.confidence,
      }));
    const calls = toolCalls(events);
    const files = uniqueStrings(events.flatMap((event) => bindings(event).files));
    const entries = uniqueStrings(events.flatMap((event) => bindings(event).entries));
    const approvals = events
      .filter((event) => event.normalizedKind.startsWith("approval."))
      .map((event) => ({
        source: event.sourceName,
        status: event.normalizedKind.replace(/^approval\./, ""),
        summary: event.summary,
      }));
    const proofs = uniqueStrings(events.flatMap((event) => bindings(event).proofs))
      .map((kind) => ({ kind }));
    const contextEventItems = contextEvents(events);
    const openQuestions = timeline?.openQuestions ?? [];
    return {
      ok: true,
      scope: target ? "entry" : "current",
      entry: target,
      currentState: current,
      agentMemory: {
        summary: {
          events: contextEventItems.length,
          goals: goals.length,
          toolCalls: calls.length,
          files: files.length,
          entries: entries.length,
          approvals: approvals.length,
          proofs: proofs.length,
          openQuestions: openQuestions.length,
          sources: uniqueStrings(contextEventItems.map((event) => event.source)),
          tools: uniqueStrings(calls.map((call) => call.tool)),
          ...(contextEventItems.at(-1)?.capturedAt ? { latestEventAt: contextEventItems.at(-1)!.capturedAt } : {}),
        },
        goals,
        toolCalls: calls,
        files,
        entries,
        approvals,
        proofs,
        events: contextEventItems,
        openQuestions,
      },
      exitCode: 0,
    };
  } finally {
    await store.close();
  }
}

function contextEvents(events: AgentMemoryEventRecord[]): AgentMemoryContextEvent[] {
  return events.map((event) => {
    const eventBindings = bindings(event);
    return {
      id: event.id,
      source: event.sourceName,
      integration: event.integrationKind,
      trustLevel: event.trustLevel,
      kind: event.normalizedKind,
      capturedAt: event.capturedAt,
      ...(event.summary ? { summary: event.summary } : {}),
      ...(event.externalSessionId ? { sessionId: event.externalSessionId } : {}),
      ...(event.externalTurnId ? { turnId: event.externalTurnId } : {}),
      ...(eventBindings.toolName ? { tool: eventBindings.toolName } : {}),
      ...(eventBindings.command ? { command: eventBindings.command } : {}),
      ...(eventBindings.status ? { status: eventBindings.status } : {}),
      files: eventBindings.files,
      entries: eventBindings.entries,
      proofs: eventBindings.proofs,
      confidence: event.confidence,
    };
  });
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
  command?: string;
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
    command: typeof record.command === "string" ? record.command : undefined,
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
