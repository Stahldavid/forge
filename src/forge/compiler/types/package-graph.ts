import type { CapabilitySet } from "./capability.ts";
import type { RuntimeExportKind, RuntimeExportShape } from "./sandbox.ts";
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

export interface ResolutionTraceStep {
  step: string;
  status: "ok" | "miss" | "fallback" | "warning";
  detail: string;
}

export interface RuntimeTypeMismatch {
  entrypoint: string;
  exportName: string;
  kind: "types-only" | "runtime-only" | "kind-mismatch";
  typesKind?: ExportKind;
  runtimeKind?: RuntimeExportKind;
}

export type RuntimeCompatibilityStatus = "compatible" | "risky" | "unknown";

export interface PackageRuntimeCompatibility {
  node: RuntimeCompatibilityStatus;
  bun: RuntimeCompatibilityStatus;
  browser: RuntimeCompatibilityStatus;
  edge: RuntimeCompatibilityStatus;
  reasons: string[];
  risks: string[];
}

export interface PackageMetadata {
  type?: "module" | "commonjs";
  engines: Record<string, string>;
  entryFields: {
    main?: string;
    module?: string;
    browser?: string | boolean;
    types?: string;
  };
  peerDependencies: string[];
  optionalPeerDependencies: string[];
  hasInstallScripts: boolean;
  hasNativeBindings: boolean;
  exportSubpathCount: number;
}

export interface Entrypoint {
  subpath: string;
  conditions: string[];
  patternBacked: boolean;
  dtsPath: string | null;
  resolutionTrace?: ResolutionTraceStep[];
  exports: ExportSignature[];
}

export interface PackageApi {
  /**
   * Import/dependency name used by the app, which may be an npm alias such as
   * "forge" for "npm:forgeos@...".
   */
  name: string;
  /** Real package.json name when it differs from the dependency/import name. */
  packageName?: string;
  version: string;
  packageManager: PackageManager;
  resolutionMode: ResolutionMode;
  entrypoints: Entrypoint[];
  source: "static" | "static+runtime";
  runtimeShape?: RuntimeExportShape;
  runtimeTypeMismatches?: RuntimeTypeMismatch[];
  runtimeCompatibility?: PackageRuntimeCompatibility;
  metadata?: PackageMetadata;
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
  recipeVersion?: string;
}
