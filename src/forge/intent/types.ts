import type { Diagnostic } from "../compiler/types/diagnostic.ts";

export type ForgeIntentKind =
  | "add-feature"
  | "connect-ui"
  | "explain"
  | "fix"
  | "inspect"
  | "ship"
  | "verify";

export type ForgeIntentConfidence = "high" | "medium" | "low";
export type ForgeIntentRiskLevel = "low" | "medium" | "high";

export interface ForgeIntentCommand {
  command: string;
  purpose: string;
  when: "now" | "after-review" | "after-editing" | "before-handoff";
}

export interface ForgeIntentPlanStep {
  title: string;
  why: string;
  commands: string[];
  filesToInspect: string[];
  successCriteria: string[];
}

export interface ForgeIntentRisk {
  level: ForgeIntentRiskLevel;
  reason: string;
  mitigation: string;
}

export interface ForgeIntentContextSummary {
  projectName?: string;
  frontendPresent: boolean;
  frontendFramework: string;
  routes: string[];
  commands: string[];
  queries: string[];
  liveQueries: string[];
}

export interface ForgeIntentResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  input: {
    objective: string;
    tokens: string[];
  };
  intent: {
    kind: ForgeIntentKind;
    label: string;
    confidence: ForgeIntentConfidence;
  };
  summary: string;
  context: ForgeIntentContextSummary;
  plan: ForgeIntentPlanStep[];
  commands: ForgeIntentCommand[];
  filesToInspect: string[];
  filesToChange: string[];
  risks: ForgeIntentRisk[];
  diagnostics: Diagnostic[];
  nextAction: ForgeIntentCommand | null;
  exitCode: 0 | 1;
}

export interface ForgeDoOptions {
  workspaceRoot: string;
  objective: string;
  json: boolean;
}
