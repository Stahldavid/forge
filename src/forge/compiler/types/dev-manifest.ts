import type { Diagnostic } from "./diagnostic.ts";

export interface DevRoute {
  method: "GET" | "POST";
  path: string;
  purpose:
    | "home"
    | "health"
    | "entries"
    | "invoke"
    | "workflows"
    | "workflow-runs"
    | "workflow-process"
    | "ai-agent-chat"
    | "ai-agent-run"
    | "ai-providers"
    | "queries"
    | "query";
  entryName?: string;
  entryKind?: "command" | "action" | "query";
}

export interface DevManifestEntry {
  name: string;
  kind: "command" | "action" | "query";
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
