import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { PlannedFile, PlannedPatch } from "../make/types.ts";

export type RefactorAction =
  | "plan"
  | "apply"
  | "diff"
  | "rollback"
  | "list"
  | "rename"
  | "move"
  | "extract-action"
  | "replace-process-env"
  | "replace-import";

export type RenameTarget =
  | "table"
  | "field"
  | "policy"
  | "command"
  | "query"
  | "livequery"
  | "action"
  | "workflow"
  | "event";

export type RefactorRiskLevel = "low" | "medium" | "high";

export type RefactorIntent =
  | {
      kind: "renameField";
      table: string;
      from: { field: string };
      to: { field: string };
      updateFrontend: boolean;
      updateTests: boolean;
      updateBlueprints: boolean;
    }
  | {
      kind: "renameTable";
      from: { table: string };
      to: { table: string };
      updateRefs: boolean;
      updateRuntimeEntries: boolean;
      updateFrontend: boolean;
      updatePolicies: boolean;
    }
  | {
      kind: "renamePolicy";
      from: string;
      to: string;
    }
  | {
      kind: "renameRuntimeEntry";
      entryKind: "command" | "query" | "liveQuery" | "action" | "workflow";
      from: string;
      to: string;
      updateApi: boolean;
      updateClient: boolean;
      updateTests: boolean;
      updateFrontend: boolean;
    }
  | {
      kind: "renameEvent";
      from: string;
      to: string;
    }
  | {
      kind: "moveComponent";
      name: string;
      toPath: string;
    }
  | {
      kind: "extractAction";
      command: string;
      packageName: string;
      eventName: string;
      actionName: string;
      removeForbiddenImport: boolean;
      createEventPayload: boolean;
      createAction: boolean;
    }
  | {
      kind: "replaceProcessEnv";
      name: string;
      replacement: "ctx.secrets";
    }
  | {
      kind: "replaceImport";
      from: string;
      to: string;
    };

export interface RefactorImpact {
  data: {
    tables: string[];
    fields: string[];
    refs: string[];
    indexes: string[];
    rlsPolicies: string[];
  };
  runtime: {
    commands: string[];
    queries: string[];
    liveQueries: string[];
    actions: string[];
    workflows: string[];
    endpoints: string[];
  };
  frontend: {
    components: string[];
    pages: string[];
    hooks: string[];
  };
  policies: string[];
  tests: string[];
  blueprints: string[];
  generatedArtifacts: string[];
}

export interface RefactorMigrationPlan {
  strategy: "rename-column" | "rename-table" | "manual";
  sql: string[];
}

export interface RefactorPlan {
  schemaVersion: "0.1.0";
  refactorVersion: string;
  id: string;
  intent: RefactorIntent;
  summary: string;
  impact: RefactorImpact;
  filesToModify: PlannedPatch[];
  filesToCreate: PlannedFile[];
  filesToDelete: Array<{ file: string; description: string }>;
  generatedImpacts: string[];
  migrationPlan?: RefactorMigrationPlan;
  risk: {
    level: RefactorRiskLevel;
    reasons: string[];
  };
  commandsToRun: string[];
  diagnostics: Diagnostic[];
  rollback: {
    trackedFiles: string[];
    instructions: string[];
  };
}

export interface RefactorCommandOptions {
  action: RefactorAction;
  renameTarget?: RenameTarget;
  from?: string;
  to?: string;
  planId?: string;
  componentName?: string;
  packageName?: string;
  eventName?: string;
  actionName?: string;
  workspaceRoot: string;
  json: boolean;
  dryRun: boolean;
  plan: boolean;
  yes: boolean;
  force: boolean;
  allowHighRisk: boolean;
  noGenerate: boolean;
  noVerify: boolean;
  keepFailed: boolean;
}

export interface RefactorRecord {
  schemaVersion: "0.1.0";
  id: string;
  status: "applied" | "rolled-back";
  summary: string;
  filesModified: string[];
  filesCreated: string[];
  result: { ok: boolean };
}

export interface RefactorResult {
  ok: boolean;
  plan?: RefactorPlan;
  record?: RefactorRecord;
  records?: RefactorRecord[];
  diff?: string;
  explanation?: string;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}
