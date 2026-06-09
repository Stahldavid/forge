import { createDiagnostic } from "../diagnostics/create.ts";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type { QueryDefinition, QueryRegistry } from "../types/query-registry.ts";
import {
  QUERY_REGISTRY_ANALYZER_VERSION,
  QUERY_REGISTRY_SCHEMA_VERSION,
} from "./constants.ts";

function moduleIdForFile(
  moduleGraph: AppGraph["moduleGraph"],
  file: string,
): string | null {
  const node = moduleGraph.nodes.find((candidate) => candidate.file === file);
  return node?.id ?? null;
}

function stableSortQueries(queries: QueryDefinition[]): QueryDefinition[] {
  return [...queries].sort((a, b) => {
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });
}

function detectDuplicateQueryNames(queries: QueryDefinition[]): QueryRegistry["diagnostics"] {
  const byName = new Map<string, QueryDefinition[]>();

  for (const query of queries) {
    const list = byName.get(query.name) ?? [];
    list.push(query);
    byName.set(query.name, list);
  }

  const diagnostics: QueryRegistry["diagnostics"] = [];

  for (const [name, group] of byName) {
    if (group.length <= 1) {
      continue;
    }

    for (const query of group) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_DUP_QUERY",
          message: `duplicate query name '${name}'`,
          file: query.file,
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

export function buildQueryRegistry(appGraph: AppGraph): QueryRegistry {
  const queries: QueryDefinition[] = [];
  const diagnostics: QueryRegistry["diagnostics"] = [];

  for (const symbol of appGraph.symbols) {
    if (symbol.kind !== "query") {
      continue;
    }

    const moduleId = moduleIdForFile(appGraph.moduleGraph, symbol.file);
    if (moduleId === null) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_QUERY_UNRESOLVABLE",
          message: `cannot resolve module for query '${symbol.qualifiedName}'`,
          file: symbol.file,
          span: symbol.span,
        }),
      );
      continue;
    }

    queries.push({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      file: symbol.file,
      symbolId: symbol.id,
      moduleId,
    });
  }

  const dupDiagnostics = detectDuplicateQueryNames(queries);

  return {
    schemaVersion: QUERY_REGISTRY_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: QUERY_REGISTRY_ANALYZER_VERSION,
    inputHash: hashStable(
      canonicalJson({
        appInputHash: appGraph.inputHash,
        analyzerVersion: QUERY_REGISTRY_ANALYZER_VERSION,
      }),
    ),
    queries: stableSortQueries(queries),
    diagnostics: [...diagnostics, ...dupDiagnostics],
  };
}
