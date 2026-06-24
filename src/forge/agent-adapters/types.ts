import type { Diagnostic } from "../compiler/types/diagnostic.ts";

export type AgentAdapterTarget = "generic" | "codex" | "cursor" | "claude" | "all" | string;

export type BuiltInAgentAdapterTarget = "generic" | "codex" | "cursor" | "claude";

export type AgentSubcommand =
  | "list-targets"
  | "export"
  | "check"
  | "doctor"
  | "onboard"
  | "print-context"
  | "clean"
  | "prepare"
  | "hooks"
  | "install"
  | "ingest"
  | "context"
  | "memory"
  | "timeline";

export interface AgentCommandOptions {
  subcommand: AgentSubcommand;
  workspaceRoot: string;
  json: boolean;
  target: AgentAdapterTarget;
  dryRun: boolean;
  force: boolean;
  preserveUserSections: boolean;
  skills: boolean;
  rules: boolean;
  eventName?: string;
  hookAction?: "smoke" | "status" | string;
  input?: unknown;
  entry?: string;
  change?: string;
  proof?: string;
  handoff?: boolean;
  current?: boolean;
  limit?: number;
  watch?: boolean;
  file?: string;
  pollIntervalMs?: number;
}

export interface AgentExportFile {
  path: string;
  content: string;
}

export interface AgentAdapterTargetManifest {
  name: BuiltInAgentAdapterTarget | string;
  files: string[];
  default?: boolean;
  optional?: boolean;
  adapterVersion: string;
  formatVersion: string;
}

export interface AgentAdapterManifest {
  schemaVersion: "0.1.0";
  generatorVersion: string;
  targets: AgentAdapterTargetManifest[];
  sourceHash: string;
}

export interface AgentContext {
  schemaVersion: "0.1.0";
  project: {
    name: string;
    framework: "forgeos";
    template?: string;
  };
  runtimeModel: Record<string, string>;
  commands: string[];
  queries: string[];
  liveQueries: string[];
  actions: string[];
  workflows: string[];
  tables: string[];
  policies: string[];
  secrets: string[];
  criticalCommands: {
    afterSourceChange: string[];
    beforeCommit: string[];
    targetedLoop: string[];
    repair: string[];
  };
  knownPitfalls: string[];
}

export interface AgentCommandsMap {
  setup: string[];
  dev: string[];
  generate: string[];
  check: string[];
  verify: string[];
  impact: string[];
  testPlan: string[];
  testRun: string[];
  repair: string[];
}

export interface AgentDoneCriteria {
  default: string[];
  frontendChange: string[];
  schemaChange: string[];
  packageChange: string[];
}

export interface AgentExportResult {
  ok: boolean;
  target: AgentAdapterTarget;
  filesWritten: string[];
  filesPlanned: string[];
  warnings: Diagnostic[];
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface AgentCheckResult {
  ok: boolean;
  stale: string[];
  missing: string[];
  warnings: Diagnostic[];
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface AgentTargetsResult {
  targets: Array<{ name: string; default?: boolean; optional?: boolean; custom?: boolean }>;
  exitCode: 0 | 1;
}

export interface AgentPrintContextResult {
  context: AgentContext | null;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export type AgentHookBridgeState = "ready" | "missing" | "not-supported" | "waiting-for-user-trust" | "memory-unavailable";
export type AgentHookApprovalStatus = "not-required" | "waiting-for-user-trust" | "trusted" | "memory-unavailable";
export type AgentHookReadinessLevel = "none" | "canary" | "trusted-native";

export interface AgentDoctorResult {
  ok: boolean;
  target: AgentAdapterTarget;
  summary: {
    adapter: "ready" | "missing" | "stale";
    hookBridge: AgentHookBridgeState;
    approvalRequired: boolean;
    approvalStatus: AgentHookApprovalStatus;
    recentEvents: number;
    queuedEvents?: number;
    usefulSignals: number;
    nativeSignals: number;
    canarySignals: number;
    lastEventAt?: string;
  };
  checks: Array<{ name: string; ok: boolean; message?: string; evidence?: unknown }>;
  nextActions: string[];
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface AgentPrepareResult {
  ok: boolean;
  target: AgentAdapterTarget;
  exportResult: AgentExportResult;
  checkResult: AgentCheckResult;
  installResult?: unknown;
  commands: {
    context: string;
    export: string;
    check: string;
    install?: string;
    hooksStatus?: string;
    hooksSmoke?: string;
    open?: string;
  };
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface AgentOnboardResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  target: AgentAdapterTarget;
  readyToEdit: boolean;
  summary: {
    adapter: "ready" | "missing" | "stale";
    hookBridge: AgentHookBridgeState;
    approvalRequired: boolean;
    approvalStatus: AgentHookApprovalStatus;
    memorySignals: number;
    nativeSignals: number;
    canarySignals: number;
    generatedFresh: boolean;
    generatedChanged: boolean;
    generatedChangedFiles: number;
    safeToEdit: boolean;
    changedFiles: number;
    primaryAction?: string;
  };
  steps: Array<{
    name: string;
    ok: boolean;
    message: string;
  }>;
  recommendedReadFiles: string[];
  commands: {
    changed: string;
    dev: string;
    context: string;
    verify: string;
    hooksStatus?: string;
    hooksSmoke?: string;
    open?: string;
  };
  nextActions: string[];
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface AgentHooksSmokeResult {
  ok: boolean;
  target: AgentAdapterTarget;
  installTarget?: string;
  smokeReady: boolean;
  trustedNativeReady: boolean;
  readinessLevel: AgentHookReadinessLevel;
  installed: boolean;
  bridgeWritable: boolean;
  deltaWritable: boolean;
  visibleInMemory: boolean;
  usefulSignals: number;
  nativeSignals: number;
  canarySignals: number;
  approvalRequired: boolean;
  approvalStatus: AgentHookApprovalStatus;
  lastSignal?: {
    kind: string;
    summary?: string;
    capturedAt: string;
    workspaceRoot?: string;
  };
  canary?: {
    marker: string;
    source: string;
    eventName: string;
    ingestedEventId?: string;
    memoryEventsChecked: number;
    visible: boolean;
  };
  hookRunnerProbe?: {
    ok: boolean;
    durationMs: number;
    exitCode: number | null;
    queued: boolean;
    stdinHangSafe: boolean;
    stdinHangDurationMs?: number;
    error?: string;
  };
  checks: Array<{ name: string; ok: boolean; message?: string }>;
  nextActions: string[];
  installResult?: unknown;
  ingestResult?: unknown;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface AgentHooksStatusResult {
  ok: boolean;
  target: AgentAdapterTarget;
  installTarget?: string;
  installed: boolean;
  bridgeWritable: boolean;
  deltaWritable: boolean;
  visibleInMemory: boolean;
  recentEvents: number;
  queuedEvents?: number;
  usefulSignals: number;
  nativeSignals: number;
  canarySignals: number;
  approvalRequired: boolean;
  approvalStatus: AgentHookApprovalStatus;
  lastSignal?: {
    kind: string;
    summary?: string;
    capturedAt: string;
    workspaceRoot?: string;
  };
  workspaceRoot?: string;
  ignoredOutOfWorkspaceEvents?: number;
  checks: Array<{ name: string; ok: boolean; message?: string; evidence?: unknown }>;
  nextActions: string[];
  installResult?: unknown;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface AgentTimelineItem {
  id: string;
  source: string;
  integration: string;
  trustLevel: string;
  kind: string;
  capturedAt: string;
  sessionId?: string;
  turnId?: string;
  summary?: string;
  toolName?: string;
  command?: string;
  status?: string;
  files: string[];
  entries: string[];
  proofs: string[];
  confidence: number;
}

export interface AgentTimelineResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  timeline: "agent";
  target: AgentAdapterTarget;
  sourceFilter?: string;
  summary: {
    events: number;
    sessions: number;
    files: number;
    entries: number;
    proofs: number;
    tools: number;
    latestEventAt?: string;
  };
  events: AgentTimelineItem[];
  files: string[];
  entries: string[];
  proofs: string[];
  sessions: string[];
  nextActions: string[];
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface CustomAdapterConfig {
  name: string;
  outputs: Array<{
    template: string;
    path: string;
  }>;
}
