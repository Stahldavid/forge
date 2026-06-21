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
  mode?: "integration" | "package";
  targetKind?: "forge-integration" | "npm-package";
  target?: string;
  packageTarget?: "root" | "frontend" | "backend" | "workspace";
  packageTargetReason?: string;
  explanation?: string;
  recipeVersion?: string;
  recipePackages?: string[];
  requiredSecrets?: string[];
  optionalSecrets?: string[];
  packageSpec?: string;
  packageName?: string;
  packageManager?: string;
  installCommand?: string[];
  nativeInstallCommand?: string[];
  avoidedManualCommand?: string;
  installCwd?: string;
  installWorkspace?: string;
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
  mode?: "auto" | "integration" | "package";
  installWorkspace?: string;
  packageTarget?: "frontend" | "backend";
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
  | "external"
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
  | "agent-tools"
  | "agent-adapters"
  | "capability-map"
  | "summary"
  | "schema"
  | "drift"
  | "handoff"
  | "framework"
  | "imported"
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
  workspace?: string;
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
  failureKind?: string;
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
  testJobs?: number;
  typechecker?: "tsc" | "tsgo" | "auto";
  fullTests?: boolean;
  testPlan?: boolean;
}

export type VerifyProfile = "default" | "smoke" | "standard" | "strict" | "changed";

export type VerifyTestGraphLane = "parallel" | "isolated" | "serial";
export type VerifyTestGraphLaneMode = "overlap" | "sequential";

export type VerifyTestGraphDurationSource = "profile" | "fallback";

export interface VerifyTestGraphPlanChunk {
  index: number;
  lane: VerifyTestGraphLane;
  files: string[];
  estimatedMs: number;
  durationSource: VerifyTestGraphDurationSource;
}

export interface VerifyTestGraphPlan {
  schemaVersion: "0.1.0";
  fileCount: number;
  chunkCount: number;
  totalJobs: number;
  laneMode: VerifyTestGraphLaneMode;
  jobs: number;
  isolatedJobs: number;
  lanes: Record<VerifyTestGraphLane, {
    fileCount: number;
    chunkCount: number;
    estimatedMs: number;
  }>;
  chunks: VerifyTestGraphPlanChunk[];
  criticalPathEstimateMs: number;
  profilePath: string;
  profileFound: boolean;
  slowestFiles: Array<{
    file: string;
    lane: VerifyTestGraphLane;
    estimatedMs: number;
    source: VerifyTestGraphDurationSource;
  }>;
  recommendations: string[];
}

export interface VerifyResult {
  ok: boolean;
  profile?: VerifyProfile;
  steps: VerifyStep[];
  diagnostics: Diagnostic[];
  testGraphPlan?: VerifyTestGraphPlan;
  durationMs?: number;
  exitCode: 0 | 1;
}
