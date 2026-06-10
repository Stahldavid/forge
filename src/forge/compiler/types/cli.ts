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
  standard?: boolean;
}

export interface VerifyResult {
  ok: boolean;
  steps: VerifyStep[];
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}
