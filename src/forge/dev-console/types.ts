import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { ImpactRiskLevel } from "../impact/types.ts";
import type { CategorizedFileSummary, DiffPlan } from "../workspace/change-summary.ts";

export type DevConsolePhaseName =
  | "generated"
  | "check"
  | "frontend"
  | "doctor"
  | "impact"
  | "last-test-run"
  | "last-ui-run";

export interface DevConsolePhase {
  name: DevConsolePhaseName;
  ok: boolean;
  status: "ok" | "failed" | "warning" | "skipped";
  message?: string;
  diagnostics: Diagnostic[];
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface DevConsoleNextAction {
  command: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface DevConsoleSummary {
  project: {
    root: string;
  };
  health: {
    ok: boolean;
    errors: number;
    warnings: number;
    skipped: number;
  };
  urls: {
    api: string;
    web?: string;
    suggestedPreview?: string;
  };
  preview: {
    studioUrl?: string;
    targetAppUrl: string;
    targetAppPort: number;
    isStudioSelfPreview: boolean;
    note: string;
  };
  generated: DevConsoleGeneratedSummary;
  frontend: FrontendSummary;
  capabilities: {
    covered: number;
    backendOnly: number;
    frontendOnly: number;
    warnings: number;
  };
  agentContext: DevConsoleAgentContext;
  primaryAction?: DevConsoleNextAction;
}

export interface DevConsoleCycle {
  schemaVersion: "0.1.0";
  ok: boolean;
  mode: "once" | "startup" | "watch";
  summary: DevConsoleSummary;
  phases: DevConsolePhase[];
  diagnostics: Diagnostic[];
  nextActions: DevConsoleNextAction[];
  exitCode: 0 | 1;
}

export interface DevConsoleOptions {
  workspaceRoot: string;
  mode: DevConsoleCycle["mode"];
  generatedMode?: "write" | "check";
  strictSecrets?: boolean;
  includeImpact?: boolean;
  apiUrl?: string;
  webUrl?: string;
}

export interface LastTestRunSummary {
  id?: string;
  ok: boolean;
  failed: string[];
  durationMs?: number;
}

export interface LastUiRunSummary {
  id?: string;
  ok: boolean;
  failedScenarios: string[];
}

export interface ImpactSummary {
  changedFiles: number;
  sampleChangedFiles: string[];
  hiddenChangedFiles: number;
  changeSummary: CategorizedFileSummary;
  risk: ImpactRiskLevel;
  recommendedChecks: string[];
  fullCommand: string;
}

export interface DevConsoleGeneratedSummary {
  ok: boolean;
  state: "fresh" | "regenerated" | "stale-risk";
  changedFiles: number;
  sampleChanged: string[];
  hiddenChanged: number;
  message: string;
  command: string;
  checkCommand: string;
}

export type DevConsoleDiffPlan = DiffPlan;

export interface DevConsoleAgentContext {
  safeToEdit: boolean;
  generatedFresh: boolean;
  generatedChanged: boolean;
  generatedChangedFiles: number;
  frontendReady: boolean;
  changedFiles: number;
  changeSummary?: CategorizedFileSummary;
  diffPlan?: DevConsoleDiffPlan;
  blockingIssues: string[];
  recommendedReadFiles: string[];
  recommendedCommands: string[];
  useFullCommands: string[];
}

export interface FrontendSummary {
  present: boolean;
  framework: string;
  routes: string[];
  bindings: string[];
  bridgeFiles: string[];
  devUrl?: string;
  apiUrl?: string;
  apiUrlEnv?: string;
}
