import type { Diagnostic } from "./diagnostic.ts";

export interface LiveQueryDefinition {
  name: string;
  qualifiedName: string;
  file: string;
  exportName: string;
  symbolId: string;
  moduleId: string;
  policy?: string;
}

export interface LiveQueryRegistry {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  liveQueries: LiveQueryDefinition[];
  diagnostics: Diagnostic[];
}

export interface SubscriptionManifest {
  schemaVersion: string;
  generatorVersion: string;
  inputHash: string;
  liveQueries: Array<{
    name: string;
    file: string;
    exportName: string;
    policy?: string;
  }>;
}
