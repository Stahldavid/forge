import type { CapabilitySet } from "./capability.ts";
import type { RuntimeExportShape } from "./sandbox.ts";
import type {
  PackageManager,
  ResolutionMode,
  RuntimeContext,
  SandboxBackend,
} from "./runtime.ts";

export interface JsDoc {
  summary: string;
  tags: { tag: string; text: string }[];
}

export interface ExportClassification {
  alias: string;
  packageName: string;
  entrypoint: string;
  exportName: string;
  compatible: RuntimeContext[];
  incompatible: RuntimeContext[];
  capabilities: CapabilitySet;
}

export type ExportKind =
  | "function"
  | "class"
  | "const"
  | "type"
  | "interface"
  | "namespace";

export interface ExportSignature {
  name: string;
  kind: ExportKind;
  signature: string;
  overloads?: string[];
  declarations?: string[];
  classification: ExportClassification;
  jsdoc: JsDoc | null;
  examples: string[];
}

export interface Entrypoint {
  subpath: string;
  conditions: string[];
  patternBacked: boolean;
  dtsPath: string | null;
  exports: ExportSignature[];
}

export interface PackageApi {
  name: string;
  version: string;
  packageManager: PackageManager;
  resolutionMode: ResolutionMode;
  entrypoints: Entrypoint[];
  source: "static" | "static+runtime";
  runtimeShape?: RuntimeExportShape;
  contentChecksum: string;
}

export interface PackageGraph {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  packages: PackageApi[];
}

export interface Dependency {
  name: string;
  version: string;
  packageManager: PackageManager;
  packageIntegrity?: string;
  installPath: string;
}

export interface AnalyzeOptions {
  runtimeInspect: boolean;
  sandboxBackend?: SandboxBackend;
  resolutionMode: ResolutionMode;
  cacheDir: string;
}
