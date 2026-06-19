import { normalizePath } from "../compiler/primitives/paths.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { readDeltaGitSnapshot } from "../delta/git-observer.ts";
import { redactDeltaPayload } from "../delta/redaction.ts";
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
  const derived = deriveSafeHookMetadata(input.raw, rawEventName);
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
    payload: {
      ...redacted.value,
      ...derived,
    },
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
  const commandSummary = stringField(envelope.payload, "commandSummary");
  const resultStatus = stringField(envelope.payload, "resultStatus");
  const promptSummary = stringField(envelope.payload, "promptSummary") ?? stringField(envelope.payload, "userPromptSummary");
  if (envelope.event.kind === "agent.prompt.submitted" && promptSummary) {
    return promptSummary;
  }
  if (envelope.event.kind === "approval.requested") {
    return `${envelope.source.agent} requested approval${tool ? ` for ${tool}` : ""}${commandSummary ? `: ${commandSummary}` : ""}`;
  }
  if (tool) {
    const status = resultStatus ?? statusFromKind(envelope.event.kind);
    return `${envelope.source.agent} ${tool}${status ? ` ${status}` : ""}${commandSummary ? `: ${commandSummary}` : ""}`;
  }
  if (commandSummary ?? command) {
    return `${envelope.source.agent} ran ${commandSummary ?? command}`;
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
    command: stringField(payload, "command") ?? stringField(payload, "commandSummary"),
    exitCode: numberField(payload, "exitCode") ?? numberField(payload, "exit_code"),
    files: uniqueStrings([
      ...arrayOfStrings(payload.files),
      ...arrayOfStrings(payload.paths),
      ...arrayOfStrings(payload.affectedFiles),
      stringField(payload, "file_path"),
      stringField(payload, "filePath"),
      stringField(payload, "path"),
    ].map((value) => value ? normalizePath(value) : value)),
    entries: uniqueStrings([
      ...arrayOfStrings(payload.entries),
      stringField(payload, "entryName"),
      stringField(payload, "entry_name"),
      stringField(payload, "runtimeEntry"),
      stringField(payload, "runtime_entry"),
    ]),
    proofs: uniqueStrings([
      ...arrayOfStrings(payload.proofs),
      stringField(payload, "proofKind"),
      stringField(payload, "proof_kind"),
    ]),
    status: statusFromKind(envelope.event.kind),
  };
}

function deriveSafeHookMetadata(raw: Record<string, unknown>, eventName: string): Record<string, unknown> {
  const derived: Record<string, unknown> = {};
  const toolName = stringField(raw, "tool_name") ?? stringField(raw, "toolName") ?? stringField(raw, "tool");
  const toolUseId = stringField(raw, "tool_use_id") ?? stringField(raw, "toolUseId");
  const permissionMode = stringField(raw, "permission_mode") ?? stringField(raw, "permissionMode");
  const cwd = stringField(raw, "cwd");
  const trigger = stringField(raw, "trigger");
  const agentId = stringField(raw, "agent_id") ?? stringField(raw, "agentId");
  const agentType = stringField(raw, "agent_type") ?? stringField(raw, "agentType");
  if (toolName) {
    derived.toolName = toolName;
  }
  if (toolUseId) {
    derived.toolUseId = toolUseId;
  }
  if (permissionMode) {
    derived.permissionMode = permissionMode;
  }
  if (cwd) {
    derived.cwd = normalizePath(cwd);
  }
  if (trigger) {
    derived.trigger = trigger;
  }
  if (agentId) {
    derived.agentId = agentId;
  }
  if (agentType) {
    derived.agentType = agentType;
  }

  const toolInput = objectField(raw, "tool_input") ?? objectField(raw, "toolInput");
  const toolResponse = objectField(raw, "tool_response") ?? objectField(raw, "toolResponse");
  const command = stringField(toolInput, "command") ?? stringField(raw, "command");
  if (command) {
    derived.commandHash = hashStable(command);
    derived.commandStored = false;
    derived.commandSummary = summarizeCommand(command);
    derived.commandKind = classifyCommand(toolName, command);
  }
  const description = stringField(toolInput, "description");
  if (description) {
    derived.approvalDescriptionSummary = safeSummary(description, 180);
  }
  const exitCode = numberField(toolResponse, "exitCode") ?? numberField(toolResponse, "exit_code") ?? numberField(raw, "exitCode") ?? numberField(raw, "exit_code");
  if (exitCode !== undefined) {
    derived.exitCode = exitCode;
    derived.resultStatus = exitCode === 0 ? "success" : "failed";
  } else {
    const status = stringField(toolResponse, "status") ?? stringField(raw, "status");
    if (status) {
      derived.resultStatus = status;
    }
  }
  const responseSummary = summarizeToolResponse(toolResponse);
  if (responseSummary) {
    derived.responseSummary = responseSummary;
  }
  if (toolResponse) {
    derived.responseHash = hashStable(JSON.stringify(toolResponse));
    derived.responseStored = false;
  }

  const files = uniqueStrings([
    ...extractPaths(toolInput),
    ...extractPaths(toolResponse),
    ...extractPaths(raw),
    ...extractPathsFromCommand(command),
  ].map((value) => normalizePath(value)));
  if (files.length > 0) {
    derived.files = files;
    derived.affectedFiles = files;
  }
  const entries = uniqueStrings([
    ...extractNamedValues(toolInput, ["entry", "entryName", "entry_name", "runtimeEntry", "runtime_entry"]),
    ...extractNamedValues(raw, ["entry", "entryName", "entry_name", "runtimeEntry", "runtime_entry"]),
    ...extractEntriesFromCommand(command),
  ]);
  if (entries.length > 0) {
    derived.entries = entries;
  }
  if (eventName === "Stop" || eventName === "SubagentStop") {
    const lastMessage = stringField(raw, "last_assistant_message") ?? stringField(raw, "lastAssistantMessage");
    if (lastMessage) {
      derived.lastAssistantMessageHash = hashStable(lastMessage);
      derived.lastAssistantMessageStored = false;
      derived.lastAssistantMessageSummary = safeSummary(lastMessage, 220);
    }
  }
  return derived;
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

function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const field = value[key];
  return field && typeof field === "object" && !Array.isArray(field) ? field as Record<string, unknown> : undefined;
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function numberField(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function summarizeCommand(command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim();
  const singleLine = normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
  return safeSummary(singleLine, 220);
}

function safeSummary(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const clipped = normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...` : normalized;
  const redacted = redactDeltaPayload({ summary: scrubSecretTokens(clipped) }).value.summary;
  return typeof redacted === "string" ? redacted : clipped;
}

function scrubSecretTokens(value: string): string {
  return value
    .replace(/\bsk[-_][A-Za-z0-9_\-.]{8,}\b/g, "[REDACTED]")
    .replace(/\bnpm_[A-Za-z0-9]{16,}\b/g, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, "[REDACTED]")
    .replace(/\b(?:xox[baprs]-)[A-Za-z0-9-]{16,}\b/g, "[REDACTED]");
}

function classifyCommand(toolName: string | undefined, command: string): string {
  if (toolName === "apply_patch") {
    return "patch";
  }
  if (toolName?.startsWith("mcp__")) {
    return "mcp";
  }
  if (/\b(git|npm|pnpm|bun|yarn|node|forge|gh|python|pytest|mvn|gradle)\b/.test(command)) {
    return "shell";
  }
  return toolName ?? "command";
}

function summarizeToolResponse(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const candidate = stringField(value, "summary") ??
    stringField(value, "message") ??
    stringField(value, "stderr") ??
    stringField(value, "stdout") ??
    stringField(value, "output") ??
    stringField(value, "result");
  return candidate ? safeSummary(candidate, 220) : undefined;
}

function extractPaths(value: unknown): string[] {
  const paths: string[] = [];
  visit(value, (key, child) => {
    if (typeof child === "string" && isPathLikeKey(key) && looksLikePath(child)) {
      paths.push(child);
    }
    if (Array.isArray(child) && isPathListKey(key)) {
      for (const item of child) {
        if (typeof item === "string" && looksLikePath(item)) {
          paths.push(item);
        }
      }
    }
  });
  return paths;
}

function extractNamedValues(value: unknown, keys: string[]): string[] {
  const wanted = new Set(keys);
  const values: string[] = [];
  visit(value, (key, child) => {
    if (wanted.has(key) && typeof child === "string" && child.length > 0) {
      values.push(child);
    }
  });
  return values;
}

function extractPathsFromCommand(command: string | undefined): string[] {
  if (!command) {
    return [];
  }
  const paths: string[] = [];
  const patchPattern = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  for (const match of command.matchAll(patchPattern)) {
    if (match[1]) {
      paths.push(match[1].trim());
    }
  }
  const literalPathPattern = /(?:-LiteralPath|-Path)\s+["']?([^"'\s]+)["']?/g;
  for (const match of command.matchAll(literalPathPattern)) {
    if (match[1] && looksLikePath(match[1])) {
      paths.push(match[1]);
    }
  }
  return paths;
}

function extractEntriesFromCommand(command: string | undefined): string[] {
  if (!command) {
    return [];
  }
  const entries: string[] = [];
  const forgeEntryPattern = /\b(?:run|query|explain|timeline)\s+([a-zA-Z0-9_.:-]+)/g;
  for (const match of command.matchAll(forgeEntryPattern)) {
    const value = match[1];
    if (value && value.includes(".")) {
      entries.push(value);
    }
  }
  return entries;
}

function visit(value: unknown, callback: (key: string, value: unknown) => void, depth = 0): void {
  if (!value || typeof value !== "object" || depth > 4) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) {
      visit(item, callback, depth + 1);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    callback(key, child);
    visit(child, callback, depth + 1);
  }
}

function isPathLikeKey(key: string): boolean {
  return /^(file|filePath|file_path|path|uri|absolutePath|relativePath)$/i.test(key);
}

function isPathListKey(key: string): boolean {
  return /^(files|paths|changedFiles|affectedFiles|artifact_paths|artifactPaths)$/i.test(key);
}

function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|sql|css|html|yml|yaml|toml|lock|java|go|py|ps1)$/i.test(value);
}
