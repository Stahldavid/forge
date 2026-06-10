import type { Diagnostic } from "./diagnostic.ts";

export type TestCost = "instant" | "fast" | "standard" | "slow" | "docker" | "browser";
export type TestConfidence = "confirmed" | "probable" | "weak";
export type TestKind = "unit" | "integration" | "frontend" | "e2e" | "unknown";

export interface TestCoverage {
  commands: string[];
  queries: string[];
  liveQueries: string[];
  actions: string[];
  workflows: string[];
  tables: string[];
  policies: string[];
  components: string[];
  packages: string[];
}

export interface TestGraphEntry {
  file: string;
  kind: TestKind;
  cost: TestCost;
  confidence: TestConfidence;
  covers: TestCoverage;
  reasons: string[];
}

export interface TestGraph {
  schemaVersion: "0.1.0";
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  tests: TestGraphEntry[];
  diagnostics: Diagnostic[];
}

export interface TestPlanRegistry {
  schemaVersion: "0.1.0";
  generatorVersion: string;
  commands: string[];
  generatedArtifacts: string[];
  planDirectory: ".forge/test-plans";
  runDirectory: ".forge/test-runs";
  costs: TestCost[];
}
