import type { Diagnostic } from "./diagnostic.ts";

export interface QueryDefinition {
  name: string;
  qualifiedName: string;
  file: string;
  symbolId: string;
  moduleId: string;
}

export interface QueryRegistry {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  queries: QueryDefinition[];
  diagnostics: Diagnostic[];
}
