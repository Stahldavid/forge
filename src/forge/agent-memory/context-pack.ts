import { DeltaStore } from "../delta/store.ts";
import type { AgentMemoryContextEvent, AgentMemoryContextPack, AgentMemoryEventRecord } from "./types.ts";

export async function buildAgentMemoryContext(input: {
  workspaceRoot: string;
  entry?: string;
  change?: string;
  proof?: string;
  handoff?: boolean;
  limit?: number;
}): Promise<AgentMemoryContextPack> {
  const store = await DeltaStore.open(input.workspaceRoot, { access: "read" });
  try {
    const scope = contextScope(input);
    const target = contextTarget(input, scope);
    const currentSession = await store.currentWorkSession();
    const sessionId = scope === "change" && (input.change === "current" || !input.change)
      ? currentSession?.id
      : undefined;
    const events = await store.listAgentMemoryEvents({ target: eventTarget(input, scope), limit: input.limit ?? 50 });
    const timeline = target || sessionId
      ? await store.semanticTimeline({ target, workSessionId: sessionId, limit: input.limit ?? 50 })
      : undefined;
    const current = timeline?.currentState && Object.keys(timeline.currentState).length > 0
      ? timeline.currentState
      : await currentSessionState(store, currentSession);
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
      scope,
      scopeTarget: contextScopeTarget(input, scope, target, currentSession?.id),
      entry: input.entry,
      change: input.change,
      proof: input.proof,
      currentState: current,
      recommendedCommands: recommendedCommands(scope, input, currentSession?.id),
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

function contextScope(input: {
  entry?: string;
  change?: string;
  proof?: string;
  handoff?: boolean;
}): AgentMemoryContextPack["scope"] {
  if (input.handoff) {
    return "handoff";
  }
  if (input.proof) {
    return "proof";
  }
  if (input.change) {
    return "change";
  }
  return input.entry ? "entry" : "current";
}

function contextTarget(
  input: { entry?: string; change?: string; proof?: string },
  scope: AgentMemoryContextPack["scope"],
): string | undefined {
  if (scope === "entry") {
    return input.entry;
  }
  if (scope === "proof") {
    return input.proof?.includes(":") ? input.proof : `proof:${input.proof}`;
  }
  if (scope === "change" && input.change && input.change !== "current") {
    return input.change.includes(":") ? input.change : `session:${input.change}`;
  }
  return undefined;
}

function contextScopeTarget(
  input: { entry?: string; change?: string; proof?: string; handoff?: boolean },
  scope: AgentMemoryContextPack["scope"],
  semanticTarget: string | undefined,
  currentSessionId: string | undefined,
): AgentMemoryContextPack["scopeTarget"] {
  if (scope === "entry") {
    return { kind: "entry", value: input.entry, semanticTarget };
  }
  if (scope === "proof") {
    return { kind: "proof", value: input.proof, semanticTarget };
  }
  if (scope === "change") {
    const value = input.change ?? "current";
    return {
      kind: "change",
      value,
      ...(semanticTarget ? { semanticTarget } : {}),
      ...(value === "current" && currentSessionId ? { currentSessionId } : {}),
    };
  }
  if (scope === "handoff") {
    return { kind: "handoff", value: "handoff", currentSessionId };
  }
  return { kind: "current-session", value: "current", currentSessionId };
}

function eventTarget(
  input: { entry?: string; change?: string; proof?: string },
  scope: AgentMemoryContextPack["scope"],
): string | undefined {
  if (scope === "entry") {
    return input.entry;
  }
  if (scope === "proof") {
    return input.proof;
  }
  if (scope === "change" && input.change !== "current") {
    return input.change;
  }
  return undefined;
}

function recommendedCommands(
  scope: AgentMemoryContextPack["scope"],
  input: { entry?: string; change?: string; proof?: string },
  currentSessionId: string | undefined,
): string[] {
  const commands = [
    "forge agent timeline --json",
    "forge delta status --verbose --json",
  ];
  if (scope === "entry" && input.entry) {
    commands.push(`forge timeline ${input.entry} --json`);
    commands.push(`forge explain ${input.entry} --json`);
  }
  if (scope === "proof" && input.proof) {
    commands.push(`forge timeline proof:${input.proof.replace(/^proof:/u, "")} --json`);
  }
  if (scope === "change") {
    commands.push(`forge timeline --session ${input.change === "current" || !input.change ? "current" : input.change} --json`);
    commands.push("forge changed --json");
  }
  if (scope === "handoff") {
    commands.push("forge handoff --json");
    commands.push(`forge timeline --session ${currentSessionId ?? "current"} --json`);
    commands.push("forge changed --json");
  }
  return [...new Set(commands)];
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

async function currentSessionState(store: DeltaStore, currentSession?: Awaited<ReturnType<DeltaStore["currentWorkSession"]>>): Promise<Record<string, unknown>> {
  const session = currentSession ?? await store.currentWorkSession();
  return session
    ? {
        sessionId: session.id,
        title: session.title,
        inferredIntent: session.inferredIntent,
        confidence: session.confidence,
        status: session.status,
        reasons: session.reasons.slice(0, 5).map((reason) => ({
          signal: reason.signal,
          weight: reason.weight,
          ...(reason.value ? { value: reason.value } : {}),
        })),
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
