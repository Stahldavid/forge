import type { TraceRunKey } from "../agent-fabric/trace-contract.ts";
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
  freshness?: AgentMemoryFreshness;
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
  trace: AgentMemoryTraceContext;
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

export interface AgentMemoryFreshness {
  status: "current" | "pending" | "unavailable";
  pendingBytes: number;
  queuedEvents: number;
  inspectedEventsTruncated: boolean;
  lastQueuedAt?: string;
  latestMatchingEventAt?: string;
  error?: string;
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


/** Historical, bounded source context. No field grants permission to a new task. */
export interface AgentMemoryTraceContext {
  schema: "forge.agent-memory-trace-context.v1";
  status: "disabled" | "available" | "partial" | "unavailable" | "no-relevant-history";
  mode: "historical-context-only";
  authority: "none";
  approvalForNewTask: "not-evaluated";
  selection: {
    basis: "explicit-paths" | "workspace-observed-files" | "workspace-overview" | "unmapped-target";
    relevance: "path-overlap" | "unknown";
    paths: string[];
    causality: "not-inferred";
  };
  projection?: { generationId: string; extractorVersion: string; status: string };
  items: AgentMemoryTraceContextItem[];
  limits: { maxRuns: number; maxPaths: number; maxFacts: number; maxBytes: number; maxRpcCalls: number; timeBudgetMs: number };
  reads: { runsConsidered: number; factsRead: number; rpcCalls: number; bytesUsed: number; budgetExhausted: boolean };
  gaps: string[];
  truncated: boolean;
}
export interface AgentMemoryTraceContextItem {
  runKey: TraceRunKey;
  cut: { version: number; journalRef: string; stateRef: string };
  generationId: string;
  selection: { basis: "path-overlap" | "workspace-overview"; relevance: "path-overlap" | "unknown"; paths: string[] };
  completeness: "complete-at-cut" | "partial";
  sourceAvailability: "primary-source-unverified";
  sourceScope: "run-source-set" | "run-source-subset";
  sourceCompleteness: "complete" | "partial";
  sourcesTotal: number;
  sourcesOmitted: number;
  authority: "none";
  approvalForNewTask: "not-evaluated";
  execution: { observedStatus: string };
  origin: { status: string; refs: string[] };
  candidates: Array<{ candidateId: string; candidateDigest?: string; paths: string[] }>;
  evidence: Array<{ id: string; kind: string; validity: "owner-gated-at-cut" | "historical-or-unverified" | "superseded" | "unknown"; result?: string; refs: string[]; supersededBy?: string[] }>;
  git: { observation: string; contentMatch: string; evidence: Array<{ annotationRef?: string; candidateDigest?: string; commitOid?: string; observation: string; contentMatch: string; paths: string[]; superseded: boolean }> };
  corrections: Array<{ annotationRef: string; supersedesRef: string; reason?: string; replacement: { summary?: string; producer?: string }; superseded: boolean; authority: "none" }>;
  sources: Array<{ sourceKey: string; digest: string; version: number; journalRef: string; stateRef: string; factKind: string; factIdentity: string }>;
  gaps: string[];
}
