import { normalizePath } from "../compiler/primitives/paths.ts";
import { readDeltaGitSnapshot } from "../delta/git-observer.ts";
import { redactAgentPayload } from "./redaction.ts";
import {
  AGENT_EVENT_SCHEMA,
  type AgentEventEnvelope,
  type AgentMemoryIntegrationKind,
  type AgentMemorySourceName,
  type AgentMemoryTrustLevel,
} from "./types.ts";

export interface NormalizeAgentEventInput {
  workspaceRoot: string;
  source: AgentMemorySourceName | string;
  eventName?: string;
  integration?: AgentMemoryIntegrationKind | string;
  raw: Record<string, unknown>;
  now?: string;
}

export function normalizeAgentEvent(input: NormalizeAgentEventInput): AgentEventEnvelope {
  const source = normalizeSource(input.source);
  const rawEventName = input.eventName ?? stringField(input.raw, "hook_event_name") ?? stringField(input.raw, "event") ?? "unknown";
  const normalizedKind = normalizeEventKind(source, rawEventName, input.raw);
  const redacted = redactAgentPayload(input.raw);
  const git = readDeltaGitSnapshot(input.workspaceRoot);
  const actorName = source === "claude-code"
    ? "Claude Code"
    : source === "codex"
      ? "Codex"
      : source === "cursor"
        ? "Cursor"
        : "External Agent";
  return {
    schema: AGENT_EVENT_SCHEMA,
    source: {
      agent: source,
      integration: input.integration ?? defaultIntegrationForSource(source),
      version: stringField(input.raw, "version") ?? "unknown",
    },
    workspace: {
      root: normalizePath(input.workspaceRoot),
      gitBranch: git.branch,
      gitHead: git.head,
    },
    session: {
      externalSessionId: stringField(input.raw, "session_id") ?? stringField(input.raw, "sessionId") ?? stringField(input.raw, "conversation_id"),
      forgeSessionId: stringField(input.raw, "forgeSessionId"),
      turnId: stringField(input.raw, "turn_id") ?? stringField(input.raw, "turnId"),
    },
    event: {
      kind: normalizedKind,
      timestamp: stringField(input.raw, "timestamp") ?? input.now ?? new Date().toISOString(),
    },
    actor: {
      kind: "agent",
      name: stringField(input.raw, "actor") ?? actorName,
      model: stringField(input.raw, "model"),
    },
    payload: redacted.value,
    privacy: {
      rawPromptStored: false,
      rawCompletionStored: false,
      rawToolArgsStored: false,
      transcriptImported: false,
      redacted: true,
      sensitiveFieldsRemoved: redacted.sensitiveFieldsRemoved,
    },
    capture: {
      trustLevel: trustLevelForIntegration(input.integration ?? defaultIntegrationForSource(source)),
      confidence: confidenceForSource(source, input.integration ?? defaultIntegrationForSource(source)),
    },
  };
}

export function summarizeAgentEvent(envelope: AgentEventEnvelope): string {
  const tool = stringField(envelope.payload, "toolName") ??
    stringField(envelope.payload, "tool_name") ??
    stringField(envelope.payload, "tool");
  const command = stringField(envelope.payload, "command");
  const promptSummary = stringField(envelope.payload, "promptSummary") ?? stringField(envelope.payload, "userPromptSummary");
  if (envelope.event.kind === "agent.prompt.submitted" && promptSummary) {
    return promptSummary;
  }
  if (tool) {
    return `${envelope.source.agent} ${tool} ${statusFromKind(envelope.event.kind)}`;
  }
  if (command) {
    return `${envelope.source.agent} ran ${command}`;
  }
  return `${envelope.source.agent} ${envelope.event.kind}`;
}

export function extractAgentEventBindings(envelope: AgentEventEnvelope): {
  toolName?: string;
  command?: string;
  exitCode?: number;
  files: string[];
  entries: string[];
  proofs: string[];
  status?: string;
} {
  const payload = envelope.payload;
  return {
    toolName: stringField(payload, "toolName") ?? stringField(payload, "tool_name") ?? stringField(payload, "tool"),
    command: stringField(payload, "command"),
    exitCode: numberField(payload, "exitCode") ?? numberField(payload, "exit_code"),
    files: uniqueStrings([
      ...arrayOfStrings(payload.files),
      ...arrayOfStrings(payload.paths),
      stringField(payload, "file_path"),
      stringField(payload, "filePath"),
      stringField(payload, "path"),
    ].map((value) => value ? normalizePath(value) : value)),
    entries: uniqueStrings([
      ...arrayOfStrings(payload.entries),
      stringField(payload, "entryName"),
      stringField(payload, "entry_name"),
      stringField(payload, "runtimeEntry"),
    ]),
    proofs: uniqueStrings([
      ...arrayOfStrings(payload.proofs),
      stringField(payload, "proofKind"),
      stringField(payload, "proof_kind"),
    ]),
    status: statusFromKind(envelope.event.kind),
  };
}

function normalizeSource(source: string): AgentMemorySourceName | string {
  if (source === "claude" || source === "claude-code") {
    return "claude-code";
  }
  if (source === "codex" || source === "cursor") {
    return source;
  }
  return source || "generic";
}

function defaultIntegrationForSource(source: string): AgentMemoryIntegrationKind {
  return source === "cursor" ? "mcp" : "native-hook";
}

function trustLevelForIntegration(integration: string): AgentMemoryTrustLevel {
  if (integration === "native-hook") {
    return "direct-hook";
  }
  if (integration === "mcp") {
    return "mcp-tool";
  }
  if (integration === "cli-wrapper") {
    return "forge-command";
  }
  if (integration === "file-watcher") {
    return "file-watcher";
  }
  if (integration === "git-hook") {
    return "git-observer";
  }
  return "manual-import";
}

function confidenceForSource(source: string, integration: string): number {
  if (integration === "native-hook") {
    return source === "generic" ? 0.78 : 0.94;
  }
  if (integration === "mcp") {
    return 0.9;
  }
  if (integration === "cli-wrapper") {
    return 0.84;
  }
  return 0.68;
}

function normalizeEventKind(source: string, eventName: string, raw: Record<string, unknown>): string {
  const canonical = eventName.replace(/\s+/g, "");
  switch (canonical) {
    case "SessionStart":
      return "agent.session.started";
    case "SessionEnd":
      return "agent.session.ended";
    case "UserPromptSubmit":
      return "agent.prompt.submitted";
    case "PreToolUse":
      return "agent.tool.requested";
    case "PermissionRequest":
      return "approval.requested";
    case "PermissionDenied":
      return "approval.denied";
    case "PostToolUseFailure":
      return "agent.tool.failed";
    case "PostToolUse":
      return "agent.tool.completed";
    case "SubagentStart":
      return "agent.subagent.started";
    case "SubagentStop":
      return "agent.subagent.ended";
    case "PreCompact":
      return "agent.memory.compaction.requested";
    case "PostCompact":
      return "agent.memory.compaction.completed";
    case "FileChanged":
      return "agent.file.changed";
    case "Stop":
      return source === "codex" ? "agent.turn.stopped" : "agent.turn.completed";
    default: {
      const tool = stringField(raw, "toolName") ?? stringField(raw, "tool_name");
      if (tool && (canonical === "tool.call" || canonical === "tool_call" || canonical === "unknown")) {
        return "agent.tool.called";
      }
      return canonical.includes(".") ? canonical : `agent.${canonical || "event"}`;
    }
  }
}

function statusFromKind(kind: string): string | undefined {
  if (kind.endsWith(".completed") || kind === "agent.tool.called") {
    return "completed";
  }
  if (kind.endsWith(".failed")) {
    return "failed";
  }
  if (kind.endsWith(".requested")) {
    return "requested";
  }
  if (kind.endsWith(".denied")) {
    return "denied";
  }
  return undefined;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}
