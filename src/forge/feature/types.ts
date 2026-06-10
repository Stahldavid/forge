import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { MakeCommandOptions, MakeFieldSpec, MakeIntent, MakePlan, PlannedFile, PlannedPatch } from "../make/types.ts";

export type FeatureAction =
  | "validate"
  | "plan"
  | "diff"
  | "apply"
  | "list"
  | "inspect"
  | "rollback"
  | "examples";

export type FeatureMode = "create" | "modify";
export type FeatureRiskLevel = "low" | "medium" | "high";

export interface BlueprintField {
  name: string;
  type: MakeFieldSpec["type"];
  required?: boolean;
  optional?: boolean;
  default?: unknown;
  defaultNow?: boolean;
  values?: string[];
  refTable?: string;
  unique?: boolean;
  indexed?: boolean;
  label?: string;
  description?: string;
}

export interface ResourceBlueprint {
  name: string;
  singularName?: string;
  tenantScoped?: boolean;
  fields: BlueprintField[];
  policies?: Partial<Record<"read" | "create" | "update" | "delete", string[]>>;
  commands?: Partial<Record<"create" | "update" | "delete", boolean>>;
  queries?: Partial<Record<"list" | "get", boolean>>;
  liveQueries?: Partial<Record<"list", boolean>>;
  actions?: Array<{ name: string; event: string }>;
  workflows?: Array<{ name: string; trigger: string; withAi?: boolean }>;
  frontend?: {
    react?: boolean;
    page?: string;
    components?: string[];
  };
  crud?: boolean;
  liveQuery?: boolean;
  react?: boolean;
  tests?: boolean | { smoke?: boolean };
}

export type FeatureChange =
  | { kind: "addField"; table: string; field: BlueprintField }
  | { kind: "addPolicy"; name: string; roles: string[] }
  | { kind: "addCommand"; name: string; table: string; policy?: string; emits?: string }
  | { kind: "addQuery"; name: string; table: string; policy?: string }
  | { kind: "addLiveQuery"; name: string; table: string; policy?: string; where?: Record<string, unknown> }
  | { kind: "addAction"; name: string; table?: string; event: string }
  | { kind: "addWorkflow"; name: string; table?: string; trigger: string; withAi?: boolean }
  | { kind: "addComponent"; name: string; table: string; fields?: string[] }
  | { kind: "updateFrontend"; table: string; page?: string; component?: string };

export interface FeatureBlueprint {
  schemaVersion: string;
  name: string;
  description?: string;
  mode?: FeatureMode;
  resources?: ResourceBlueprint[];
  changes?: FeatureChange[];
  frontend?: Record<string, unknown>;
  tests?: Record<string, unknown>;
  metadata?: {
    owner?: string;
    risk?: FeatureRiskLevel;
    tags?: string[];
  };
}

export interface FeatureImpact {
  data: {
    tablesAdded: string[];
    tablesModified: string[];
    fieldsAdded: string[];
  };
  runtime: {
    commandsAdded: string[];
    queriesAdded: string[];
    liveQueriesAdded: string[];
    actionsAdded: string[];
    workflowsAdded: string[];
  };
  frontend: {
    pagesAdded: string[];
    componentsAdded: string[];
  };
  policies: {
    policiesAdded: string[];
    policiesModified: string[];
  };
  tests: {
    testsAdded: string[];
  };
}

export interface FeatureRisk {
  level: FeatureRiskLevel;
  reasons: string[];
}

export interface FeaturePlan {
  schemaVersion: "0.1.0";
  plannerVersion: string;
  id: string;
  blueprintName: string;
  blueprintHash: string;
  summary: string;
  makeIntents: MakeIntent[];
  makeOptions: MakeCommandOptions[];
  makePlans: MakePlan[];
  filesToCreate: PlannedFile[];
  filesToModify: PlannedPatch[];
  filesToDelete: Array<{ file: string; description: string }>;
  impact: FeatureImpact;
  risk: FeatureRisk;
  commandsToRun: string[];
  diagnostics: Diagnostic[];
  rollback: {
    trackedFiles: string[];
    instructions: string[];
  };
}

export interface FeatureApplyRecord {
  schemaVersion: "0.1.0";
  featureId: string;
  blueprintName: string;
  blueprintHash: string;
  status: "applied" | "rolled-back";
  filesCreated: string[];
  filesModified: string[];
  commandsRun: string[];
  result: {
    ok: boolean;
  };
}

export interface FeatureCommandOptions {
  action: FeatureAction;
  blueprintPath?: string;
  featureId?: string;
  exampleName?: string;
  writePath?: string;
  workspaceRoot: string;
  json: boolean;
  dryRun: boolean;
  yes: boolean;
  noGenerate: boolean;
  noVerify: boolean;
  keepFailed: boolean;
  update: boolean;
  allowHighRisk: boolean;
}

export interface FeatureResult {
  ok: boolean;
  plan?: FeaturePlan;
  blueprint?: FeatureBlueprint;
  record?: FeatureApplyRecord;
  records?: FeatureApplyRecord[];
  examples?: string[];
  diff?: string;
  explanation?: string;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}
