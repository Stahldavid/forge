import { GENERATOR_VERSION } from "../emitter/constants.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type {
  DevManifest,
  DevManifestEntry,
  DevManifestWorkflow,
  DevRoute,
} from "../types/dev-manifest.ts";
import type { RuntimeGraph } from "../types/runtime-graph.ts";
import type { QueryRegistry } from "../types/query-registry.ts";
import {
  DEV_MANIFEST_ANALYZER_VERSION,
  DEV_MANIFEST_SCHEMA_VERSION,
} from "./constants.ts";

function stableSortRoutes(routes: DevRoute[]): DevRoute[] {
  return [...routes].sort((a, b) => {
    if (a.path !== b.path) {
      return a.path < b.path ? -1 : 1;
    }
    if (a.method !== b.method) {
      return a.method < b.method ? -1 : 1;
    }
    const nameA = a.entryName ?? "";
    const nameB = b.entryName ?? "";
    if (nameA !== nameB) {
      return nameA < nameB ? -1 : 1;
    }
    return 0;
  });
}

function stableSortEntries(entries: DevManifestEntry[]): DevManifestEntry[] {
  return [...entries].sort((a, b) => {
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
}

function stableSortWorkflows(
  workflows: DevManifestWorkflow[],
): DevManifestWorkflow[] {
  return [...workflows].sort((a, b) => {
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });
}

function buildRoutes(
  runtimeGraph: RuntimeGraph,
  queryRegistry: QueryRegistry,
): DevRoute[] {
  const routes: DevRoute[] = [
    { method: "GET", path: "/", purpose: "home" },
    { method: "GET", path: "/health", purpose: "health" },
    { method: "GET", path: "/entries", purpose: "entries" },
    { method: "GET", path: "/queries", purpose: "queries" },
    { method: "GET", path: "/workflows", purpose: "workflows" },
    { method: "GET", path: "/workflows/runs", purpose: "workflow-runs" },
    { method: "POST", path: "/workflows/process", purpose: "workflow-process" },
  ];

  for (const query of queryRegistry.queries) {
    routes.push({
      method: "POST",
      path: `/queries/${query.name}`,
      purpose: "query",
      entryName: query.name,
      entryKind: "query",
    });
  }

  for (const entry of runtimeGraph.entries) {
    routes.push({
      method: "POST",
      path: `/run/${entry.name}`,
      purpose: "invoke",
      entryName: entry.name,
      entryKind: entry.kind,
    });

    if (entry.kind === "command") {
      routes.push({
        method: "POST",
        path: `/commands/${entry.name}`,
        purpose: "invoke",
        entryName: entry.name,
        entryKind: "command",
      });
    } else {
      routes.push({
        method: "POST",
        path: `/actions/${entry.name}`,
        purpose: "invoke",
        entryName: entry.name,
        entryKind: "action",
      });
    }
  }

  return stableSortRoutes(routes);
}

function buildEntries(
  runtimeGraph: RuntimeGraph,
  queryRegistry: QueryRegistry,
): DevManifestEntry[] {
  const queryEntries = queryRegistry.queries.map((query) => ({
    name: query.name,
    kind: "query" as const,
    invokePath: `/queries/${query.name}`,
    semanticPath: `/queries/${query.name}`,
  }));

  const entries = runtimeGraph.entries.map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    invokePath: `/run/${entry.name}`,
    semanticPath:
      entry.kind === "command"
        ? `/commands/${entry.name}`
        : `/actions/${entry.name}`,
  }));

  return stableSortEntries([...queryEntries, ...entries]);
}

function buildWorkflows(appGraph?: AppGraph): DevManifestWorkflow[] {
  if (!appGraph) {
    return [];
  }

  const workflows = appGraph.symbols
    .filter((symbol) => symbol.kind === "workflow")
    .map((symbol) => ({
      name: symbol.name,
      file: symbol.file,
    }));

  return stableSortWorkflows(workflows);
}

export function buildDevManifest(
  runtimeGraph: RuntimeGraph,
  queryRegistry: QueryRegistry,
  appGraph?: AppGraph,
): DevManifest {
  return {
    schemaVersion: DEV_MANIFEST_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: DEV_MANIFEST_ANALYZER_VERSION,
    inputHash: hashStable(
      canonicalJson({
        runtimeInputHash: runtimeGraph.inputHash,
        queryInputHash: queryRegistry.inputHash,
        analyzerVersion: DEV_MANIFEST_ANALYZER_VERSION,
      }),
    ),
    routes: buildRoutes(runtimeGraph, queryRegistry),
    entries: buildEntries(runtimeGraph, queryRegistry),
    workflows: buildWorkflows(appGraph),
    diagnostics: [...runtimeGraph.diagnostics, ...queryRegistry.diagnostics],
  };
}
