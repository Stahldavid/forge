import type { Diagnostic } from "../compiler/types/diagnostic.ts";

export type AgentAdapterTarget = "generic" | "codex" | "cursor" | "claude" | "all" | string;

export type BuiltInAgentAdapterTarget = "generic" | "codex" | "cursor" | "claude";

export type AgentSubcommand =
  | "list-targets"
  | "export"
  | "check"
  | "doctor"
  | "print-context"
  | "clean"
  | "install"
  | "ingest"
  | "context"
  | "memory";

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
  input?: unknown;
  entry?: string;
  current?: boolean;
  limit?: number;
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

export interface AgentDoctorResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message?: string }>;
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
