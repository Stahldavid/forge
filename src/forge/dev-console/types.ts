import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { ImpactRiskLevel } from "../impact/types.ts";

export type DevConsolePhaseName =
  | "generated"
  | "check"
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

export interface DevConsoleCycle {
  schemaVersion: "0.1.0";
  ok: boolean;
  mode: "once" | "startup" | "watch";
  phases: DevConsolePhase[];
  diagnostics: Diagnostic[];
  nextActions: DevConsoleNextAction[];
  exitCode: 0 | 1;
}

export interface DevConsoleOptions {
  workspaceRoot: string;
  mode: DevConsoleCycle["mode"];
  strictSecrets?: boolean;
  includeImpact?: boolean;
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
  changedFiles: string[];
  risk: ImpactRiskLevel;
  recommendedChecks: string[];
}
