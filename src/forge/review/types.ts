import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { ImpactedSystems, ImpactSource } from "../impact/types.ts";

export type ReviewSubcommand = "run" | "inspect" | "list" | "explain";
export type ReviewMode = "quick" | "standard" | "strict";
export type ReviewFailOn = "warning" | "error" | "blocking";
export type ReviewRiskLevel = "low" | "medium" | "high" | "critical";
export type ReviewFindingSeverity = "info" | "warning" | "error" | "blocking";
export type ReviewFindingCategory =
  | "runtime"
  | "data"
  | "policy"
  | "secrets"
  | "package"
  | "workflow"
  | "livequery"
  | "frontend"
  | "test"
  | "deploy"
  | "release"
  | "agent";

export interface ReviewCommandOptions {
  subcommand: ReviewSubcommand;
  workspaceRoot: string;
  json: boolean;
  md: boolean;
  sarif: boolean;
  write: boolean;
  changed: boolean;
  staged: boolean;
  base?: string;
  featureId?: string;
  refactorId?: string;
  upgradeId?: string;
  releaseId?: string;
  failOn?: ReviewFailOn;
  mode: ReviewMode;
  include: ReviewFindingCategory[];
  exclude: ReviewFindingCategory[];
  reviewId?: string;
  ruleId?: string;
}

export type ReviewSource =
  | { kind: "changed" }
  | { kind: "staged" }
  | { kind: "base"; base: string; head: string }
  | { kind: "feature"; featureId: string }
  | { kind: "refactor"; planId: string }
  | { kind: "upgrade"; planId: string }
  | { kind: "release"; releaseId: string };

export interface ReviewChanged {
  files: string[];
  tests: string[];
  sourceFiles: string[];
  generated: string[];
  packageFiles: string[];
  deployFiles: string[];
}

export interface ReviewSummary {
  title: string;
  bullets: string[];
}

export interface ReviewFinding {
  id: string;
  severity: ReviewFindingSeverity;
  category: ReviewFindingCategory;
  code: string;
  title: string;
  message: string;
  file?: string;
  span?: {
    start: number;
    end: number;
  };
  affected?: {
    commands?: string[];
    queries?: string[];
    liveQueries?: string[];
    tables?: string[];
    policies?: string[];
    components?: string[];
    workflows?: string[];
    packages?: string[];
  };
  suggestedCommands?: string[];
  autoRepair?: {
    available: boolean;
    command?: string;
    confidence?: "low" | "medium" | "high";
  };
  docs?: string[];
}

export interface ReviewRisk {
  level: ReviewRiskLevel;
  score: number;
  reasons: Array<{
    code: string;
    message: string;
    severity: "info" | "warning" | "error";
  }>;
  blockers: string[];
}

export interface ReviewCheckResult {
  name: string;
  ok: boolean;
  command?: string;
  message?: string;
}

export interface ReviewChecklistItem {
  id: string;
  text: string;
  required: boolean;
  category: ReviewFindingCategory;
}

export interface ReviewReport {
  schemaVersion: "0.1.0";
  reviewVersion: string;
  id: string;
  source: ReviewSource;
  summary: ReviewSummary;
  risk: ReviewRisk;
  findings: ReviewFinding[];
  changed: ReviewChanged;
  impacted: ImpactedSystems;
  checks: ReviewCheckResult[];
  recommendedCommands: string[];
  humanChecklist: ReviewChecklistItem[];
  agentInstructions: string[];
  generatedArtifacts: {
    paths: string[];
    stale: string[];
  };
  createdAt?: string;
}

export interface ReviewWriteResult {
  dir: string;
  files: string[];
}

export interface ReviewResult {
  ok: boolean;
  report?: ReviewReport;
  reports?: Array<{ id: string; dir: string }>;
  explanation?: string;
  writeResult?: ReviewWriteResult;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface ReviewRuleDoc {
  id: string;
  category: ReviewFindingCategory;
  title: string;
  description: string;
  typicalFix: string[];
  relatedCommands: string[];
}

export interface ReviewContext {
  workspaceRoot: string;
  source: ReviewSource;
  impactSource: ImpactSource;
  changed: ReviewChanged;
  impacted: ImpactedSystems;
  fileTexts: Map<string, string>;
  generated: {
    actionSubscriptions: {
      byEvent?: Record<string, Array<{ actionName?: string }>>;
      subscriptions?: Array<{ eventType?: string; actionName?: string }>;
    };
    workflowSubscriptions: {
      byEvent?: Record<string, Array<{ workflowName?: string }>>;
      subscriptions?: Array<{ eventType?: string; workflowName?: string }>;
    };
    policyRegistry: {
      policies?: Array<{ name: string; roles?: string[] }>;
      commandAuth?: Array<{ commandName?: string; policy?: string }>;
      queryAuth?: Array<{ queryName?: string; policy?: string }>;
    };
    secretRegistry: {
      secrets?: Array<{ name: string; envVar?: string; required?: boolean }>;
    };
    agentContract: unknown | null;
  };
  envExample: string;
}
