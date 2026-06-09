import type { Diagnostic } from "./diagnostic.ts";
import type { JsonValue } from "./json.ts";
import type { RuntimeContext } from "./runtime.ts";

export type ForgeKind =
  | "schema.table"
  | "query"
  | "liveQuery"
  | "command"
  | "action"
  | "endpoint"
  | "policy"
  | "workflow"
  | "agent"
  | "telemetryEvent";

export interface ForgeSymbol {
  id: string;
  kind: ForgeKind;
  name: string;
  qualifiedName: string;
  file: string;
  span: { start: number; end: number };
  contentHash: string;
  meta: Record<string, JsonValue>;
}

export type ForgeEdgeKind = "references" | "registers" | "guards" | "emits";

export interface ForgeEdge {
  from: string;
  to: string;
  kind: ForgeEdgeKind;
}

export type ImportKind = "static" | "dynamic" | "require";

export interface PackageImport {
  specifier: string;
  packageName: string;
  subpath: string;
  span: { start: number; end: number };
  importKind: ImportKind;
}

export interface LocalImport {
  toModuleId: string;
  span: { start: number; end: number };
}

export interface ModuleNode {
  id: string;
  file: string;
  directPackageImports: PackageImport[];
  localImports: LocalImport[];
  declaredContexts: RuntimeContext[];
  effectiveContexts: RuntimeContext[];
}

export interface ModuleGraph {
  nodes: ModuleNode[];
}

export interface AppGraph {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  symbols: ForgeSymbol[];
  edges: ForgeEdge[];
  moduleGraph: ModuleGraph;
  diagnostics: Diagnostic[];
}

export interface SourceFile {
  path: string;
  contentHash: string;
  text: string;
}
