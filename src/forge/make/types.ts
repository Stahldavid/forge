import type { Diagnostic } from "../compiler/types/diagnostic.ts";

export type MakePrimitive =
  | "list"
  | "explain"
  | "table"
  | "field"
  | "policy"
  | "command"
  | "query"
  | "livequery"
  | "action"
  | "workflow"
  | "component"
  | "page"
  | "ui"
  | "resource"
  | "apply"
  | "rollback";

export type MakeFieldType =
  | "uuid"
  | "text"
  | "number"
  | "integer"
  | "boolean"
  | "timestamp"
  | "json"
  | "enum"
  | "ref";

export interface MakeFieldSpec {
  name: string;
  type: MakeFieldType;
  required: boolean;
  optional: boolean;
  default?: string;
  defaultNow?: boolean;
  enumValues?: string[];
  refTable?: string;
  unique?: boolean;
  indexed?: boolean;
}

export interface MakeIntent {
  kind: Exclude<MakePrimitive, "list" | "explain" | "apply" | "rollback">;
  name: string;
  table?: string;
  field?: MakeFieldSpec;
  fields: MakeFieldSpec[];
  tenantScoped: boolean;
  crud: boolean;
  liveQuery: boolean;
  react: boolean;
  tests: boolean;
  policy?: string;
  roles: string[];
  emit?: string;
  event?: string;
  trigger?: string;
  component?: string;
  route?: string;
  withAi: boolean;
  withCreateForm: boolean;
}

export interface PlannedFile {
  file: string;
  description: string;
  content: string;
  exists: boolean;
}

export interface PlannedPatch {
  file: string;
  kind: "append-section" | "replace-section" | "create-if-missing";
  description: string;
  beforeHash?: string;
  afterPreview: string;
}

export interface MakePlan {
  schemaVersion: "0.1.0";
  makeVersion: string;
  id: string;
  intent: MakeIntent;
  summary: string;
  filesToCreate: PlannedFile[];
  filesToModify: PlannedPatch[];
  filesToDelete: Array<{ file: string; description: string }>;
  generatedAfterApply: boolean;
  commandsToRun: string[];
  diagnostics: Diagnostic[];
  risk: {
    level: "low" | "medium" | "high";
    reasons: string[];
  };
  rollback: {
    trackedFiles: string[];
    instructions: string[];
  };
}

export interface MakeCommandOptions {
  primitive: MakePrimitive;
  name?: string;
  explainPrimitive?: MakePrimitive;
  workspaceRoot: string;
  json: boolean;
  dryRun: boolean;
  plan: boolean;
  apply: boolean;
  yes: boolean;
  force: boolean;
  noGenerate: boolean;
  noVerify: boolean;
  keepFailed: boolean;
  tenantScoped: boolean;
  fieldSpecs: string[];
  fieldsRaw?: string;
  type?: string;
  values?: string;
  defaultValue?: string;
  index: boolean;
  roles?: string;
  table?: string;
  policy?: string;
  emit?: string;
  event?: string;
  trigger?: string;
  component?: string;
  framework?: "vite" | "next";
  withAi: boolean;
  withCrud: boolean;
  withLiveQuery: boolean;
  withReact: boolean;
  withUi: boolean;
  withTests: boolean;
  withCreateForm: boolean;
}

export interface MakeResult {
  ok: boolean;
  plan?: MakePlan;
  primitives?: MakePrimitive[];
  explanation?: string;
  applied?: boolean;
  planPath?: string;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}
