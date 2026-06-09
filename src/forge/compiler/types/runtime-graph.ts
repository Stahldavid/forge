import type { Diagnostic } from "./diagnostic.ts";

export interface RuntimeEntry {
  id: string;
  kind: "command" | "action";
  name: string;
  qualifiedName: string;
  file: string;
  moduleId: string;
  runtimeContext: "command" | "action";
  dependencies: string[];
}

export interface RuntimeGraph {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  entries: RuntimeEntry[];
  diagnostics: Diagnostic[];
}

export interface MockMapEntry {
  packageName: string;
  mockFile: string;
}

export interface MockMap {
  entries: MockMapEntry[];
}
