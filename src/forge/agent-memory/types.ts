import type { Diagnostic } from "../compiler/types/diagnostic.ts";

export const AGENT_EVENT_SCHEMA = "forge.agent-event.v1" as const;

export type AgentMemorySourceName = "claude-code" | "codex" | "cursor" | "generic";
export type AgentMemoryIntegrationKind = "native-hook" | "mcp" | "cli-wrapper" | "file-watcher" | "git-hook" | "manual-import";
export type AgentMemoryTrustLevel =
  | "direct-hook"
  | "mcp-tool"
  | "forge-command"
  | "file-watcher"
  | "git-observer"
  | "manual-import"
  | "inferred";

export interface AgentEventEnvelope {
  schema: typeof AGENT_EVENT_SCHEMA;
  source: {
    agent: AgentMemorySourceName | string;
    integration: AgentMemoryIntegrationKind | string;
    version: string;
  };
  workspace: {
    root: string;
    gitBranch?: string;
    gitHead?: string;
  };
  session: {
    externalSessionId?: string;
    forgeSessionId?: string;
    turnId?: string;
  };
  event: {
    kind: string;
    timestamp: string;
  };
  actor: {
    kind: "agent" | "human" | "forge" | "unknown";
    name: string;
    model?: string;
  };
  payload: Record<string, unknown>;
  privacy: {
    rawPromptStored: false;
    rawCompletionStored: false;
    rawToolArgsStored: false;
    transcriptImported: false;
    redacted: true;
    sensitiveFieldsRemoved: string[];
  };
  capture: {
    trustLevel: AgentMemoryTrustLevel;
    confidence: number;
  };
}

export interface AgentMemoryEventRecord {
  id: string;
  externalEventId: string;
  sourceName: string;
  integrationKind: string;
  trustLevel: string;
  externalSessionId?: string;
  externalTurnId?: string;
  eventKind: string;
  normalizedKind: string;
  summary?: string;
  confidence: number;
  capturedAt: string;
  operationId?: string;
  data: Record<string, unknown>;
}

export interface AgentMemoryContextEvent {
  id: string;
  source: string;
  integration: string;
  trustLevel: string;
  kind: string;
  capturedAt: string;
  summary?: string;
  sessionId?: string;
  turnId?: string;
  tool?: string;
  command?: string;
  status?: string;
  files: string[];
  entries: string[];
  proofs: string[];
  confidence: number;
}

export interface AgentMemoryContextPack {
  ok: true;
  scope: "current" | "entry" | "change" | "proof" | "handoff";
  scopeTarget: {
    kind: "current-session" | "entry" | "change" | "proof" | "handoff";
    value?: string;
    semanticTarget?: string;
    currentSessionId?: string;
  };
  entry?: string;
  change?: string;
  proof?: string;
  currentState: Record<string, unknown>;
  recommendedCommands: string[];
  agentMemory: {
    summary: {
      events: number;
      goals: number;
      toolCalls: number;
      files: number;
      entries: number;
      approvals: number;
      proofs: number;
      openQuestions: number;
      sources: string[];
      tools: string[];
      latestEventAt?: string;
    };
    goals: Array<{ source: string; summary: string; confidence: number }>;
    toolCalls: Array<{ source: string; tool: string; status?: string; summary?: string }>;
    files: string[];
    entries: string[];
    approvals: Array<{ source: string; status: string; summary?: string }>;
    proofs: Array<{ kind: string; result?: string }>;
    events: AgentMemoryContextEvent[];
    openQuestions: string[];
  };
  exitCode: 0;
}

export interface AgentInstallResult {
  ok: boolean;
  target: string;
  filesWritten: string[];
  filesPlanned: string[];
  privacy: {
    rawPrompts: "off";
    rawCompletions: "off";
    rawToolArgs: "off";
    transcriptImport: "off";
    cloudSync: "off";
  };
  warnings: string[];
  exitCode: 0 | 1;
}

export interface AgentIngestResult {
  ok: boolean;
  event?: AgentMemoryEventRecord;
  envelope?: AgentEventEnvelope;
  fallback?: {
    kind: "agent-events-ndjson";
    path: string;
    reason: "pglite-active";
  };
  busy?: AgentMemoryUnavailableResult["busy"];
  exitCode: 0 | 1;
  error?: string;
  diagnostics?: Diagnostic[];
  nextActions?: string[];
}

export interface AgentIngestWatchResult {
  ok: boolean;
  watch: boolean;
  source: string;
  file?: string;
  dryRun?: boolean;
  eventsIngested: number;
  errors: string[];
  bytesRead?: number;
  pendingBytes?: number;
  checkpointFile?: string;
  compacted?: boolean;
  historyFile?: string;
  busy?: AgentMemoryUnavailableResult["busy"];
  pendingDueToBusy?: boolean;
  busyRetries?: number;
  nextActions: string[];
  exitCode: 0 | 1;
}

export interface AgentMemoryUnavailableResult {
  ok: false;
  error: string;
  events?: AgentMemoryEventRecord[];
  busy?: {
    code: "FORGE_DELTA_BUSY";
    lockPath: string;
    relativeLockPath: string;
    pid?: number;
    processAlive: boolean;
    createdAt?: string;
    ageMs?: number;
    cwd?: string;
    command?: string;
    holderKnown: boolean;
  };
  diagnostics: Diagnostic[];
  nextActions: string[];
  exitCode: 1;
}
