import type { AppGraph } from "../types/app-graph.ts";
import type { Dependency } from "../types/package-graph.ts";
import type { PackageManager } from "../types/runtime.ts";
import type { SourceFile } from "../types/app-graph.ts";

export const ORCHESTRATOR_MANIFEST_VERSION = "1";

export interface DiscoverContext {
  workspaceRoot: string;
  cacheDir: string;
  generatedDir: string;
  packageManager: PackageManager;
  sources: SourceFile[];
  dependencies: Dependency[];
  tsconfigPath: string | null;
  packageJsonHash: string;
  lockfileHash: string;
  tsconfigHash: string;
  sourceFingerprint: string;
  inputFingerprint: string;
}

export interface OrchestratorManifest {
  schemaVersion: string;
  fileHashes: Record<string, string>;
  priorAppGraph?: AppGraph;
  inputFingerprint?: string;
}
