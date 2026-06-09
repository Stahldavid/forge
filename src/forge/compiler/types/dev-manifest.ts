import type { Diagnostic } from "./diagnostic.ts";

export interface DevRoute {
  method: "GET" | "POST";
  path: string;
  purpose: "health" | "entries" | "invoke" | "workflows";
  entryName?: string;
  entryKind?: "command" | "action";
}

export interface DevManifestEntry {
  name: string;
  kind: "command" | "action";
  invokePath: string;
  semanticPath: string;
}

export interface DevManifestWorkflow {
  name: string;
  file: string;
}

export interface DevManifest {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  routes: DevRoute[];
  entries: DevManifestEntry[];
  workflows: DevManifestWorkflow[];
  diagnostics: Diagnostic[];
}
