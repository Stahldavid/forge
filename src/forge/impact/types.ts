import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { TestCost, TestGraphEntry } from "../compiler/types/test-graph.ts";

export type ImpactSourceMode = "changed" | "staged" | "since" | "feature" | "refactor" | "upgrade";
export type ImpactRiskLevel = "low" | "medium" | "high";

export interface ImpactSource {
  mode: ImpactSourceMode;
  base?: string;
  id?: string;
}

export interface ImpactedSystems {
  data: {
    tables: string[];
    fields: string[];
  };
  runtime: {
    commands: string[];
    queries: string[];
    liveQueries: string[];
    actions: string[];
    workflows: string[];
  };
  frontend: {
    components: string[];
    pages: string[];
  };
  policies: string[];
  packages: string[];
  generatedArtifacts: string[];
  deploy: string[];
}

export interface ImpactRisk {
  level: ImpactRiskLevel;
  reasons: string[];
}

export interface ImpactReport {
  ok: boolean;
  source: ImpactSource;
  changedFiles: string[];
  authoredChangedFiles?: number;
  generatedChangedFiles?: number;
  derivedOnly?: boolean;
  impacted: ImpactedSystems;
  risk: ImpactRisk;
  recommendedChecks: string[];
  finalVerification: string[];
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface TestPlanCheck {
  kind: "forge" | "script";
  command: string;
  cost: TestCost;
  reason: string;
}

export interface TargetedTest {
  file: string;
  command: string;
  reason: string;
  cost: TestCost;
  confidence: TestGraphEntry["confidence"];
  lastDurationMs?: number;
  lastRunOk?: boolean;
}

export interface ImpactTestPlan {
  schemaVersion: "0.1.0";
  source: ImpactSource;
  changedFiles: string[];
  authoredChangedFiles?: number;
  generatedChangedFiles?: number;
  derivedOnly?: boolean;
  impacted: ImpactedSystems;
  risk: ImpactRisk;
  requiredChecks: TestPlanCheck[];
  tests: TargetedTest[];
  optionalChecks: TestPlanCheck[];
  finalVerification: string[];
}

export interface TestRunStep {
  command: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  timedOut?: boolean;
  failureKind?: string;
  stdout?: string;
  stderr?: string;
}

export interface TestRunRecord {
  schemaVersion: "0.1.0";
  id: string;
  changedHash: string;
  planHash: string;
  source: ImpactSource;
  commands: string[];
  timeoutMs: number;
  results: TestRunStep[];
  failed: string[];
  durationMs: number;
}

export interface ImpactCommandOptions {
  workspaceRoot: string;
  json: boolean;
  write: boolean;
  changed: boolean;
  staged: boolean;
  since?: string;
  featureId?: string;
  refactorId?: string;
  upgradeId?: string;
  includeGenerated: boolean;
  excludeTests: boolean;
  riskThreshold?: ImpactRiskLevel;
}

export type TestSubcommand = "plan" | "run" | "explain" | "authz";

export interface AuthzProofCheck {
  name: string;
  ok: boolean;
  message: string;
  evidence?: unknown;
}

export interface AuthzTestProof {
  schemaVersion: "0.1.0";
  tenant: string;
  otherTenant: string;
  checks: AuthzProofCheck[];
  summary: {
    ok: boolean;
    tenantScopedTables: number;
    protectedCommands: number;
    protectedQueries: number;
    capabilityPolicyBindings: number;
  };
  limitations: string[];
  nextActions: string[];
}

export interface TestCommandOptions {
  subcommand: TestSubcommand;
  workspaceRoot: string;
  json: boolean;
  write: boolean;
  changed: boolean;
  staged: boolean;
  since?: string;
  featureId?: string;
  refactorId?: string;
  upgradeId?: string;
  planPath?: string;
  testFile?: string;
  maxCost: TestCost;
  includeDocker: boolean;
  includeBrowser: boolean;
  bail: boolean;
  report?: string;
  timeoutMs?: number;
  tenant?: string;
  otherTenant?: string;
}

export interface ImpactResult {
  ok: boolean;
  report?: ImpactReport;
  plan?: ImpactTestPlan;
  test?: TestGraphEntry;
  run?: TestRunRecord;
  authz?: AuthzTestProof;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}
