import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { ForgeKind } from "../compiler/types/app-graph.ts";
import type { TestConfidence, TestCost, TestKind } from "../compiler/types/test-graph.ts";
import type { CategorizedFileSummary } from "../workspace/change-summary.ts";

export const CAIR_SCHEMA_VERSION = "0.5.0";

export type CairSubcommand = "snapshot" | "query" | "action";
export type CairOutputFormat = "text" | "json";

export interface CairCommandOptions {
  subcommand: CairSubcommand;
  workspaceRoot: string;
  json: boolean;
  format: CairOutputFormat;
  query?: string;
  action?: string;
  inputPath?: string;
  dryRun?: boolean;
  plan?: boolean;
  allowGenerated?: boolean;
}

export interface CairProjectRef {
  name: string;
  version: string;
  type: string;
}

export interface CairModuleRef {
  id: string;
  file: string;
  packageImports: string[];
  localImportCount: number;
  localImports: string[];
  contexts: string[];
}

export interface CairSymbolRef {
  id: string;
  sourceId: string;
  kind: ForgeKind;
  name: string;
  qualifiedName: string;
  moduleId: string | null;
  file: string;
  span: { start: number; end: number };
  hash: string;
}

export interface CairPackageRef {
  id: string;
  name: string;
  version: string;
  entrypoints: number;
  exports: number;
  runtime: string | null;
}

export interface CairApiRef {
  id: string;
  packageId: string;
  packageName: string;
  entrypoint: string;
  name: string;
  kind: string;
  signature: string;
}

export interface CairTestRef {
  id: string;
  file: string;
  kind: TestKind;
  cost: TestCost;
  confidence: TestConfidence;
  covers: {
    commands: string[];
    queries: string[];
    liveQueries: string[];
    actions: string[];
    workflows: string[];
    tables: string[];
    policies: string[];
    components: string[];
    packages: string[];
  };
}

export interface CairRuleRef {
  id: string;
  name: string;
  description: string;
}

export interface CairLexicon {
  modules: CairModuleRef[];
  symbols: CairSymbolRef[];
  packages: CairPackageRef[];
  apis: CairApiRef[];
  tests: CairTestRef[];
}

export interface CairSnapshotLimits {
  modules: number;
  symbols: number;
  packages: number;
  apis: number;
  tests: number;
}

export interface CairSnapshot {
  schemaVersion: typeof CAIR_SCHEMA_VERSION;
  kind: "cair.snapshot";
  snapshotId: string;
  project: CairProjectRef;
  summary: {
    modules: number;
    symbols: number;
    edges: number;
    packages: number;
    apis: number;
    tests: number;
    diagnostics: number;
  };
  limits: CairSnapshotLimits;
  truncated: {
    modules: number;
    symbols: number;
    packages: number;
    apis: number;
    tests: number;
  };
  rules: CairRuleRef[];
  lexicon: CairLexicon;
  diagnostics: Diagnostic[];
  nextActions: string[];
}

export interface CairObservation {
  code: string;
  text: string;
  data?: Record<string, unknown>;
}

export interface CairQueryResult {
  ok: boolean;
  query: string;
  observations: CairObservation[];
  diagnostics: Diagnostic[];
}

export type CairActionVerb =
  | "CREATE.FILE"
  | "CREATE.SYMBOL"
  | "PATCH"
  | "ADD.EXPORT"
  | "ADD.IMPORT"
  | "APPLY"
  | "ROLLBACK"
  | "RENAME.SYMBOL"
  | "MOVE.SYMBOL"
  | "UPDATE.SIGNATURE"
  | "ADD.PARAM"
  | "UPDATE.CALLSITES"
  | "ORGANIZE.IMPORTS"
  | "FORMAT"
  | "FIND.PATTERN"
  | "REWRITE.PATTERN"
  | "MAKE.COMMAND"
  | "MAKE.QUERY"
  | "MAKE.ACTION"
  | "MAKE.TABLE"
  | "ADD.TEST"
  | "WIRE.EXPORT"
  | "VERIFY";

export interface CairActionScriptHeader {
  schemaVersion?: string;
  snapshot?: string;
}

export interface CairParsedAction {
  raw: string;
  phase: "A" | "V";
  verb: CairActionVerb;
  args: Record<string, string>;
  body?: string;
}

export interface CairFileChange {
  path: string;
  operation: "create" | "patch" | "append" | "insert" | "noop";
  beforeHash?: string;
  afterHash?: string;
  bytesBefore?: number;
  bytesAfter?: number;
  beforeContent?: string;
  afterContent?: string;
}

export interface CairActionStepResult {
  ok: boolean;
  action: CairParsedAction;
  dryRun: boolean;
  applied: boolean;
  observations: CairObservation[];
  diagnostics: Diagnostic[];
  changes: CairFileChange[];
  journalPath?: string;
  planPath?: string;
  planId?: string;
}

export interface CairActionResult {
  ok: boolean;
  dryRun: boolean;
  plan: boolean;
  header?: CairActionScriptHeader;
  actionCount: number;
  steps: CairActionStepResult[];
  observations: CairObservation[];
  diagnostics: Diagnostic[];
  journalPaths: string[];
  planPaths: string[];
}

export interface CairChangedObservation {
  available: boolean;
  branch?: string;
  commit?: string;
  changed: CategorizedFileSummary;
  staged: CategorizedFileSummary;
  unstaged: CategorizedFileSummary;
  untracked: CategorizedFileSummary;
  error?: string;
}

export interface CairCommandResult {
  ok: boolean;
  subcommand: CairSubcommand;
  snapshot: CairSnapshot;
  query?: CairQueryResult;
  action?: CairActionResult;
  observations: CairObservation[];
  diagnostics: Diagnostic[];
  nextActions: string[];
  exitCode: 0 | 1;
}
