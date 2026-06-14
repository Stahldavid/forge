import type { Diagnostic } from "./diagnostic.ts";
import type { SandboxBackend } from "./runtime.ts";

export interface GenerateOptions {
  workspaceRoot: string;
  check: boolean;
  dryRun: boolean;
  json: boolean;
  concurrency: number;
}

export interface GenerateResult {
  changed: string[];
  unchanged: string[];
  warnings: Diagnostic[];
  errors: Diagnostic[];
  cache?: {
    strategy: "generated-check";
    result: "hit" | "miss" | "skipped";
    reason?: string;
  };
  exitCode: 0 | 1;
  failureKind?: string;
}

export interface ForgeAddResult extends GenerateResult {
  alias?: string;
}

export interface InspectResult {
  target: InspectTarget;
  data: unknown;
  warnings: Diagnostic[];
  errors: Diagnostic[];
  exitCode: 0 | 1;
  failureKind?: string;
}

export interface CliCommonOptions {
  json: boolean;
  dryRun: boolean;
}

export interface AddOptions extends CliCommonOptions {
  runtimeInspect: boolean;
  sandboxBackend: SandboxBackend;
  allowScripts: boolean;
}

export type InspectTarget =
  | "app"
  | "packages"
  | "capabilities"
  | "runtime-matrix"
  | "data"
  | "runtime"
  | "dev"
  | "subscriptions"
  | "workflows"
  | "telemetry"
  | "policies"
  | "secrets"
  | "env"
  | "ai"
  | "queries"
  | "api"
  | "client"
  | "frontend"
  | "auth"
  | "rls"
  | "db-security"
  | "release"
  | "artifacts"
  | "sourcemaps"
  | "live-production"
  | "live-protocol"
  | "live-transport"
  | "make"
  | "test-graph"
  | "test-plans"
  | "agent-contract"
  | "agent-adapters"
  | "capability-map"
  | "framework"
  | "ui"
  | "ui-scenarios"
  | "ui-routes"
  | "all"
  | "rules"
  | "map";

export interface RunOptions extends CliCommonOptions {
  name?: string;
  list: boolean;
  mock: boolean;
  workspaceRoot: string;
}

export interface RunResult {
  exitCode: 0 | 1;
  failureKind?: string;
}

export interface PmAddOptions {
  ignoreScripts: boolean;
  cwd: string;
}

export interface PmAddResult {
  resolvedVersion: string;
  integrity?: string;
  lockfileChanged: boolean;
}

export interface SandboxLimits {
  backend: SandboxBackend;
  timeoutMs: number;
  memoryMb: number;
  network: false;
  filesystem: "read-only";
  allowPostinstall: false;
}

export interface VerifyStep {
  name: string;
  ok: boolean;
  skipped?: boolean;
  skipReason?: string;
  exitCode?: number;
  command?: string;
  durationMs?: number;
  timedOut?: boolean;
}

export interface VerifyOptions {
  workspaceRoot: string;
  json: boolean;
  skipTests: boolean;
  skipTypecheck: boolean;
  skipEslint: boolean;
  strict: boolean;
  changed?: boolean;
  fast?: boolean;
  smoke?: boolean;
  standard?: boolean;
  scriptTimeoutMs?: number;
}

export type VerifyProfile = "default" | "smoke" | "standard" | "strict" | "changed";

export interface VerifyResult {
  ok: boolean;
  profile?: VerifyProfile;
  steps: VerifyStep[];
  diagnostics: Diagnostic[];
  durationMs?: number;
  exitCode: 0 | 1;
}
