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

export interface AgentMemoryContextPack {
  ok: true;
  scope: "current" | "entry";
  entry?: string;
  currentState: Record<string, unknown>;
  agentMemory: {
    goals: Array<{ source: string; summary: string; confidence: number }>;
    toolCalls: Array<{ source: string; tool: string; status?: string; summary?: string }>;
    files: string[];
    entries: string[];
    approvals: Array<{ source: string; status: string; summary?: string }>;
    proofs: Array<{ kind: string; result?: string }>;
    events: AgentMemoryEventRecord[];
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
  exitCode: 0 | 1;
  error?: string;
}
