import { canonicalJson } from "../primitives/serialize.ts";
import { hashStable } from "../primitives/hash.ts";
import { normalizePath } from "../primitives/paths.ts";
import { stableSortEdges, stableSortSymbols } from "../primitives/sort.ts";
import type { AppGraph, ForgeEdge, ForgeSymbol, SourceFile } from "../types/app-graph.ts";
import { detectDuplicateSymbols } from "./dup-symbol.ts";
import { buildModuleGraph } from "./module-graph.ts";
import { incrementalParse } from "./parser.ts";
import { recordAppGraphProfile } from "./profile.ts";
import { buildForgeSymbols } from "./symbols.ts";
import { hashTsconfigForWorkspace } from "./tsconfig-hash.ts";
import type { ParseInvalidationKey } from "./types.ts";
import { buildAnalyzerVersion, parseInvalidationKeyEquals } from "./types.ts";
import {
  APP_GRAPH_SCHEMA_VERSION,
  FORGE_CLASSIFIER_VERSION,
  GENERATOR_VERSION,
  TREE_SITTER_GRAMMAR_VERSION,
} from "./versions.ts";

export interface AppGraphBuildOptions {
  workspaceRoot: string;
  sources: SourceFile[];
  prior?: AppGraph;
  tsconfigPath?: string;
  /** When provided, skips re-reading and hashing tsconfig.json. */
  tsconfigHash?: string;
}

function normalizeSources(sources: SourceFile[]): SourceFile[] {
  return sources.map((source) => ({
    ...source,
    path: normalizePath(source.path),
  }));
}

function computeInputHash(
  sources: SourceFile[],
  invalidation: ParseInvalidationKey,
): string {
  const payload = {
    files: [...sources]
      .map((source) => ({ path: source.path, contentHash: source.contentHash }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    invalidation,
  };
  return hashStable(canonicalJson(payload));
}

function parseInvalidationFromPrior(prior: AppGraph): ParseInvalidationKey | undefined {
  const analyzer = prior.analyzerVersion;
  const schemaMatch = /schema:([^+]+)/.exec(analyzer);
  const grammarMatch = /grammar:([^+]+)/.exec(analyzer);
  const classifierMatch = /classifier:([^+]+)/.exec(analyzer);
  const tsconfigMatch = /tsconfig:([^+]+)/.exec(analyzer);

  if (!schemaMatch || !grammarMatch || !classifierMatch || !tsconfigMatch) {
    return undefined;
  }

  return {
    schemaVersion: schemaMatch[1] ?? APP_GRAPH_SCHEMA_VERSION,
    grammarVersion: grammarMatch[1] ?? TREE_SITTER_GRAMMAR_VERSION,
    classifierVersion: classifierMatch[1] ?? FORGE_CLASSIFIER_VERSION,
    tsconfigHash: tsconfigMatch[1] ?? "",
  };
}

function moduleIdByFile(moduleGraph: AppGraph["moduleGraph"]): Map<string, string> {
  return new Map(moduleGraph.nodes.map((node) => [node.file, node.id]));
}

function buildAppGraphEdges(
  symbols: ForgeSymbol[],
  moduleGraph: AppGraph["moduleGraph"],
): ForgeEdge[] {
  const edges: ForgeEdge[] = [];
  const modules = moduleIdByFile(moduleGraph);

  for (const symbol of symbols) {
    const moduleId = modules.get(symbol.file);
    if (moduleId) {
      edges.push({ from: symbol.id, to: moduleId, kind: "registers" });
    }
  }

  for (const module of moduleGraph.nodes) {
    for (const localImport of module.localImports) {
      edges.push({
        from: module.id,
        to: localImport.toModuleId,
        kind: "imports",
      });
    }
  }

  return edges;
}

export async function buildAppGraph(
  options: AppGraphBuildOptions,
): Promise<AppGraph> {
  const started = Date.now();
  let checkpoint = started;
  const sources = normalizeSources(options.sources);
  const normalizeMs = Date.now() - checkpoint;
  checkpoint = Date.now();
  const tsconfigHash =
    options.tsconfigHash ??
    hashTsconfigForWorkspace(
      options.workspaceRoot,
      options.tsconfigPath,
    );

  const invalidation: ParseInvalidationKey = {
    schemaVersion: APP_GRAPH_SCHEMA_VERSION,
    grammarVersion: TREE_SITTER_GRAMMAR_VERSION,
    classifierVersion: FORGE_CLASSIFIER_VERSION,
    tsconfigHash,
  };

  const priorInvalidation = options.prior
    ? parseInvalidationFromPrior(options.prior)
    : undefined;
  const canReusePrior =
    priorInvalidation !== undefined &&
    parseInvalidationKeyEquals(priorInvalidation, invalidation);

  const { symbols: rawSymbols, diagnostics: parseDiagnostics } =
    incrementalParse(
      sources,
      options.prior?.symbols,
      options.prior?.sourceHashes,
      priorInvalidation,
      invalidation,
    );
  const parseMs = Date.now() - checkpoint;
  checkpoint = Date.now();

  const forgeSymbols = buildForgeSymbols(rawSymbols, sources);
  const symbolsMs = Date.now() - checkpoint;
  checkpoint = Date.now();
  const dupDiagnostics = detectDuplicateSymbols(forgeSymbols);
  const duplicatesMs = Date.now() - checkpoint;
  checkpoint = Date.now();
  const moduleGraph = buildModuleGraph(
    sources,
    rawSymbols,
    options.prior,
    canReusePrior,
  );
  const moduleGraphMs = Date.now() - checkpoint;
  checkpoint = Date.now();
  const inputHash = computeInputHash(sources, invalidation);
  const inputHashMs = Date.now() - checkpoint;
  const sortedSymbols = stableSortSymbols(forgeSymbols);

  const graph = {
    schemaVersion: APP_GRAPH_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: buildAnalyzerVersion(invalidation),
    inputHash,
    sourceHashes: Object.fromEntries(
      sources.map((source) => [source.path, source.contentHash]),
    ),
    symbols: sortedSymbols,
    edges: stableSortEdges(buildAppGraphEdges(sortedSymbols, moduleGraph)),
    moduleGraph,
    diagnostics: [...parseDiagnostics, ...dupDiagnostics],
  };
  recordAppGraphProfile(graph, {
    normalizeMs,
    parseMs,
    symbolsMs,
    duplicatesMs,
    moduleGraphMs,
    inputHashMs,
    totalMs: Date.now() - started,
  });
  return graph;
}
