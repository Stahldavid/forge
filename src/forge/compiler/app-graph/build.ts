import { canonicalJson } from "../primitives/serialize.ts";
import { hashStable } from "../primitives/hash.ts";
import { normalizePath } from "../primitives/paths.ts";
import { stableSortEdges, stableSortSymbols } from "../primitives/sort.ts";
import type { AppGraph, SourceFile } from "../types/app-graph.ts";
import { detectDuplicateSymbols } from "./dup-symbol.ts";
import { buildModuleGraph } from "./module-graph.ts";
import { incrementalParse } from "./parser.ts";
import { buildForgeSymbols } from "./symbols.ts";
import { hashTsconfigForWorkspace } from "./tsconfig-hash.ts";
import type { ParseInvalidationKey } from "./types.ts";
import { buildAnalyzerVersion } from "./types.ts";
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

export async function buildAppGraph(
  options: AppGraphBuildOptions,
): Promise<AppGraph> {
  const sources = normalizeSources(options.sources);
  const tsconfigHash = hashTsconfigForWorkspace(
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

  const { symbols: rawSymbols, diagnostics: parseDiagnostics } =
    incrementalParse(
      sources,
      options.prior?.symbols,
      priorInvalidation,
      invalidation,
    );

  const forgeSymbols = buildForgeSymbols(rawSymbols, sources);
  const dupDiagnostics = detectDuplicateSymbols(forgeSymbols);
  const moduleGraph = buildModuleGraph(
    sources,
    rawSymbols,
    options.workspaceRoot,
    options.tsconfigPath,
  );

  return {
    schemaVersion: APP_GRAPH_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: buildAnalyzerVersion(invalidation),
    inputHash: computeInputHash(sources, invalidation),
    symbols: stableSortSymbols(forgeSymbols),
    edges: stableSortEdges([]),
    moduleGraph,
    diagnostics: [...parseDiagnostics, ...dupDiagnostics],
  };
}
