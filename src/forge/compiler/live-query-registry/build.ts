import { createDiagnostic } from "../diagnostics/create.ts";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type {
  LiveQueryDefinition,
  LiveQueryRegistry,
  SubscriptionManifest,
} from "../types/live-query-registry.ts";
import {
  LIVE_QUERY_REGISTRY_ANALYZER_VERSION,
  LIVE_QUERY_REGISTRY_SCHEMA_VERSION,
} from "./constants.ts";

function moduleIdForFile(
  moduleGraph: AppGraph["moduleGraph"],
  file: string,
): string | null {
  const node = moduleGraph.nodes.find((candidate) => candidate.file === file);
  return node?.id ?? null;
}

function stableSortLiveQueries(
  liveQueries: LiveQueryDefinition[],
): LiveQueryDefinition[] {
  return [...liveQueries].sort((a, b) => {
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });
}

function detectDuplicateLiveQueryNames(
  liveQueries: LiveQueryDefinition[],
): LiveQueryRegistry["diagnostics"] {
  const byName = new Map<string, LiveQueryDefinition[]>();

  for (const liveQuery of liveQueries) {
    const list = byName.get(liveQuery.name) ?? [];
    list.push(liveQuery);
    byName.set(liveQuery.name, list);
  }

  const diagnostics: LiveQueryRegistry["diagnostics"] = [];

  for (const [name, group] of byName) {
    if (group.length <= 1) {
      continue;
    }

    for (const liveQuery of group) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_DUP_QUERY",
          message: `duplicate liveQuery name '${name}'`,
          file: liveQuery.file,
        }),
      );
    }
  }

  return diagnostics.sort((a, b) => {
    const fileA = a.file ?? "";
    const fileB = b.file ?? "";
    if (fileA !== fileB) {
      return fileA < fileB ? -1 : 1;
    }
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

function parsePolicyFromSourceSlice(sourceSlice: string): string | undefined {
  const match = sourceSlice.match(/auth\s*:\s*can\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/);
  return match?.[1];
}

export function buildLiveQueryRegistry(appGraph: AppGraph): LiveQueryRegistry {
  const liveQueries: LiveQueryDefinition[] = [];
  const diagnostics: LiveQueryRegistry["diagnostics"] = [];

  for (const symbol of appGraph.symbols) {
    if (symbol.kind !== "liveQuery") {
      continue;
    }

    const moduleId = moduleIdForFile(appGraph.moduleGraph, symbol.file);
    if (moduleId === null) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_QUERY_UNRESOLVABLE",
          message: `cannot resolve module for liveQuery '${symbol.qualifiedName}'`,
          file: symbol.file,
          span: symbol.span,
        }),
      );
      continue;
    }

    const sourceSlice =
      typeof symbol.meta.sourceSlice === "string" ? symbol.meta.sourceSlice : "";

    liveQueries.push({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      file: symbol.file,
      exportName: symbol.name,
      symbolId: symbol.id,
      moduleId,
      ...(sourceSlice.length > 0
        ? { policy: parsePolicyFromSourceSlice(sourceSlice) }
        : {}),
    });
  }

  const dupDiagnostics = detectDuplicateLiveQueryNames(liveQueries);

  return {
    schemaVersion: LIVE_QUERY_REGISTRY_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: LIVE_QUERY_REGISTRY_ANALYZER_VERSION,
    inputHash: hashStable(
      canonicalJson({
        appInputHash: appGraph.inputHash,
        analyzerVersion: LIVE_QUERY_REGISTRY_ANALYZER_VERSION,
      }),
    ),
    liveQueries: stableSortLiveQueries(liveQueries),
    diagnostics: [...diagnostics, ...dupDiagnostics],
  };
}

export function buildSubscriptionManifest(
  registry: LiveQueryRegistry,
): SubscriptionManifest {
  return {
    schemaVersion: registry.schemaVersion,
    generatorVersion: registry.generatorVersion,
    inputHash: registry.inputHash,
    liveQueries: registry.liveQueries.map((liveQuery) => ({
      name: liveQuery.name,
      file: liveQuery.file,
      exportName: liveQuery.exportName,
      ...(liveQuery.policy ? { policy: liveQuery.policy } : {}),
    })),
  };
}
