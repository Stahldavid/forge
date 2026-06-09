import { GENERATOR_VERSION } from "../emitter/constants.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type {
  TelemetryEventDefinition,
  TelemetryRegistry,
  TelemetrySinkDefinition,
  TelemetrySinks,
} from "../types/telemetry-registry.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import {
  TELEMETRY_REGISTRY_ANALYZER_VERSION,
  TELEMETRY_REGISTRY_SCHEMA_VERSION,
} from "./constants.ts";
import { parseTelemetryEventsFromSlice } from "./parse.ts";

function stableSortEvents(events: TelemetryEventDefinition[]): TelemetryEventDefinition[] {
  return [...events].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

export function buildTelemetryRegistry(appGraph: AppGraph): TelemetryRegistry {
  const byName = new Map<string, Set<string>>();

  for (const symbol of appGraph.symbols) {
    const sourceSlice =
      typeof symbol.meta.sourceSlice === "string" ? symbol.meta.sourceSlice : "";
    if (sourceSlice.length === 0) {
      continue;
    }

    const eventNames = parseTelemetryEventsFromSlice(sourceSlice);
    for (const name of eventNames) {
      const files = byName.get(name) ?? new Set<string>();
      files.add(symbol.file);
      byName.set(name, files);
    }
  }

  const events: TelemetryEventDefinition[] = [...byName.entries()].map(
    ([name, files]) => ({
      name,
      files: [...files].sort(),
    }),
  );

  return {
    schemaVersion: TELEMETRY_REGISTRY_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: TELEMETRY_REGISTRY_ANALYZER_VERSION,
    inputHash: hashStable(
      canonicalJson({
        appInputHash: appGraph.inputHash,
        analyzerVersion: TELEMETRY_REGISTRY_ANALYZER_VERSION,
      }),
    ),
    events: stableSortEvents(events),
    diagnostics: [],
  };
}

export function buildTelemetrySinks(
  classified: ClassifiedPackage[],
): TelemetrySinks {
  const sinks: TelemetrySinkDefinition[] = [{ id: "local", kind: "local" }];
  const seen = new Set<string>(["local"]);

  for (const pkg of classified) {
    const alias = pkg.recipe?.alias;
    if (alias === "posthog" && !seen.has("posthog")) {
      sinks.push({ id: "posthog", kind: "posthog" });
      seen.add("posthog");
    }
    if (alias === "sentry" && !seen.has("sentry")) {
      sinks.push({ id: "sentry", kind: "sentry" });
      seen.add("sentry");
    }
  }

  sinks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    schemaVersion: TELEMETRY_REGISTRY_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    sinks,
  };
}
