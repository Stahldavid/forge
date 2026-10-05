import type { RepositoryManifest } from "../repository-manifest/types.ts";

/** Offsets are UTF-16, half-open; lines and columns are one-based. */
export interface RepositoryLocation {
  start: number;
  end: number;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface RepositoryEvidence {
  assurance: "declared" | "syntactic" | "resolved" | "inferred";
  resolution: "complete" | "partial" | "unresolved";
  adapter: string;
  version: string;
  sourceHash?: string;
}

export interface RepositoryNode {
  id: string;
  kind: string;
  name: string;
  file?: string;
  component: string;
  location?: RepositoryLocation;
  evidence: RepositoryEvidence;
  metadata: Record<string, unknown>;
}

export interface RepositoryEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  evidence: RepositoryEvidence;
  location?: RepositoryLocation;
  metadata: Record<string, unknown>;
}

export interface RepositoryDiagnostic {
  code: string;
  message: string;
  file?: string;
  severity: "info" | "warning" | "error";
}

export interface RepositoryFile {
  hash: string;
  size: number;
  component: string;
  adapter: string;
  status: "analyzed" | "unsupported" | "error";
}

export interface RepositoryCoverage {
  found: number;
  analyzed: number;
  ignored: number;
  unsupported: number;
  errors: number;
  reused: number;
  limitations: string[];
  diagnostics: RepositoryDiagnostic[];
  ignoredPaths: { path: string; reason: string }[];
}

export interface RepositorySnapshot {
  schemaVersion: 1;
  provider: "repository";
  snapshotId: string;
  root: string;
  manifestHash: string;
  scenarioHash: string;
  createdAt: string;
  files: Record<string, RepositoryFile>;
  nodes: RepositoryNode[];
  edges: RepositoryEdge[];
  coverage: RepositoryCoverage;
  manifest: RepositoryManifest;
}

export interface AnalysisSource {
  path: string;
  text: string;
  hash: string;
  component: string;
  adapter: string;
}

export interface AdapterResult {
  nodes: RepositoryNode[];
  edges: RepositoryEdge[];
  diagnostics: RepositoryDiagnostic[];
  limitations: string[];
}

export const REPOSITORY_ANALYZER_VERSION = "1.1.0";
