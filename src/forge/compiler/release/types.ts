import type { Diagnostic } from "../types/diagnostic.ts";

export type ReleaseExportProvider =
  | "local"
  | "sentry-compatible"
  | "sentry"
  | "glitchtip"
  | "bugsink"
  | "otel"
  | "custom";

export interface BuildInfo {
  schemaVersion: "0.1.0";
  packageName: string;
  packageVersion: string;
  gitSha: string;
  releaseId: string;
  generatedHash: string;
}

export interface ReleaseManifest {
  schemaVersion: "0.1.0";
  releaseId: string;
  packageName: string;
  packageVersion: string;
  gitSha: string;
  defaultProvider: "local";
  optionalProviders: ReleaseExportProvider[];
  env: {
    releaseId: "FORGE_RELEASE_ID";
    deployId: "FORGE_DEPLOY_ID";
    deployEnv: "FORGE_DEPLOY_ENV";
    publicReleaseId: "NEXT_PUBLIC_FORGE_RELEASE_ID";
  };
  diagnostics: Diagnostic[];
}

export interface DeployManifest {
  schemaVersion: "0.1.0";
  deployId: string;
  releaseId: string;
  environment: string;
  attributes: Record<string, string>;
}

export interface ReleaseArtifact {
  path: string;
  kind: "javascript" | "sourcemap" | "asset" | "manifest";
  public: boolean;
  sizeBytes?: number;
  sha256?: string;
  sourceMap?: string;
}

export interface ArtifactManifest {
  schemaVersion: "0.1.0";
  releaseId: string;
  artifacts: ReleaseArtifact[];
  diagnostics: Diagnostic[];
}

export interface SourceMapEntry {
  generatedFile: string;
  sourceMapFile: string;
  sources: string[];
  debugId?: string;
  public: boolean;
}

export interface SourceMapManifest {
  schemaVersion: "0.1.0";
  releaseId: string;
  sourceMaps: SourceMapEntry[];
  diagnostics: Diagnostic[];
}

export interface SymbolicationManifest {
  schemaVersion: "0.1.0";
  releaseId: string;
  localSymbolication: true;
  sourceMapCount: number;
  providers: ReleaseExportProvider[];
  diagnostics: Diagnostic[];
}

export interface GeneratedReleaseArtifacts {
  releaseManifest: ReleaseManifest;
  deployManifest: DeployManifest;
  artifactManifest: ArtifactManifest;
  sourceMapManifest: SourceMapManifest;
  symbolicationManifest: SymbolicationManifest;
  buildInfo: BuildInfo;
}

export interface StacktraceFrame {
  file: string;
  line: number;
  column: number;
  function?: string;
}

export interface StacktraceInput {
  frames: StacktraceFrame[];
}

export interface SymbolicatedFrame {
  generated: StacktraceFrame;
  original?: {
    source: string;
    line: number;
    column: number;
    name?: string;
  };
}

export interface SymbolicationResult {
  frames: SymbolicatedFrame[];
  diagnostics: Diagnostic[];
}
