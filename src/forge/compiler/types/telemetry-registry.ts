import type { Diagnostic } from "../types/diagnostic.ts";

export interface TelemetryEventDefinition {
  name: string;
  files: string[];
}

export interface TelemetrySinkDefinition {
  id: string;
  kind: "local" | "posthog" | "sentry";
}

export interface TelemetryRegistry {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  events: TelemetryEventDefinition[];
  diagnostics: Diagnostic[];
}

export interface TelemetrySinks {
  schemaVersion: string;
  generatorVersion: string;
  sinks: TelemetrySinkDefinition[];
}
