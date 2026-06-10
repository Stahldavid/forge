import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { PlannedFile, PlannedPatch } from "../make/types.ts";

export type RepairSubcommand =
  | "diagnose"
  | "explain"
  | "plan"
  | "apply"
  | "run"
  | "list"
  | "inspect"
  | "rollback";

export type FailureKind =
  | "generated-drift"
  | "runtime-guard"
  | "policy-auth"
  | "tenant-isolation"
  | "rls"
  | "query-readonly"
  | "livequery-reactivity"
  | "db-migration"
  | "workflow"
  | "outbox"
  | "telemetry"
  | "secrets"
  | "ai"
  | "package-upgrade"
  | "frontend-client"
  | "release-deploy"
  | "typecheck"
  | "test-failure"
  | "unknown";

export type RepairConfidence = "low" | "medium" | "high";
export type RepairRiskLevel = "low" | "medium" | "high";

export interface RepairSource {
  kind:
    | "test-run"
    | "trace"
    | "workflow-run"
    | "outbox-delivery"
    | "diagnostic"
    | "manual";
  id?: string;
  file?: string;
}

export interface RepairAffected {
  files: string[];
  commands: string[];
  queries: string[];
  liveQueries: string[];
  actions: string[];
  workflows: string[];
  tables: string[];
  policies: string[];
  components: string[];
  packages: string[];
}

export interface SuggestedRepair {
  id: string;
  kind: "run-command" | "refactor" | "make" | "patch" | "manual";
  title: string;
  description: string;
  command?: string;
  patchPreview?: PlannedPatch[];
  confidence: RepairConfidence;
  risk: {
    level: RepairRiskLevel;
    reasons: string[];
  };
  requiresConfirmation: boolean;
}

export interface RepairDiagnosis {
  schemaVersion: "0.1.0";
  repairVersion: string;
  id: string;
  failureKind: FailureKind;
  source: RepairSource;
  diagnostics: Diagnostic[];
  summary: string;
  likelyCause: string;
  affected: RepairAffected;
  suggestedRepairs: SuggestedRepair[];
  recommendedChecks: string[];
  confidence: RepairConfidence;
}

export interface RepairPlan {
  schemaVersion: "0.1.0";
  repairVersion: string;
  id: string;
  diagnosis: RepairDiagnosis;
  selectedRepair?: string;
  filesToModify: PlannedPatch[];
  filesToCreate: PlannedFile[];
  filesToDelete: Array<{ file: string; description: string }>;
  commandsToRun: string[];
  verificationPlan: {
    targeted: string[];
    final: string[];
  };
  rollback: {
    snapshotFile: string;
    files: string[];
    instructions: string[];
  };
  diagnostics: Diagnostic[];
}

export interface RepairApplyRecord {
  schemaVersion: "0.1.0";
  id: string;
  repairId: string;
  status: "applied" | "rolled-back" | "failed";
  commandsRun: string[];
  results: Array<{
    command: string;
    ok: boolean;
    exitCode: number;
    stdout?: string;
    stderr?: string;
  }>;
}

export interface FailureInput {
  source: RepairSource;
  diagnostics: Diagnostic[];
  failedCommands: string[];
  stdout: string;
  stderr: string;
}

export interface RepairRule {
  id: string;
  matches(input: FailureInput): boolean;
  diagnose(input: FailureInput): RepairDiagnosis;
}

export interface RepairCommandOptions {
  subcommand: RepairSubcommand;
  workspaceRoot: string;
  json: boolean;
  fromLastTestRun: boolean;
  from?: string;
  traceId?: string;
  workflowRunId?: string;
  outboxDeliveryId?: string;
  diagnosticCode?: string;
  repairId?: string;
  selectedRepair?: string;
  write: boolean;
  yes: boolean;
  keepFailed: boolean;
  allowMediumConfidence: boolean;
  maxAttempts: number;
  commitFriendly: boolean;
}

export interface RepairResult {
  ok: boolean;
  diagnosis?: RepairDiagnosis;
  plan?: RepairPlan;
  plans?: RepairPlan[];
  record?: RepairApplyRecord;
  explanation?: string;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}
