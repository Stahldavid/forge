export { buildAppGraph } from "./build.ts";
export type { AppGraphBuildOptions } from "./build.ts";
export { classifyForgeCallee } from "./classify.ts";
export { FORGE_BUILDER_APIS, FORGE_KIND_TO_CONTEXT } from "./forge-apis.ts";
export { buildModuleGraph, moduleIdForFile, parsePackageSpecifier } from "./module-graph.ts";
export { incrementalParse } from "./parser.ts";
export { detectDuplicateSymbols } from "./dup-symbol.ts";
export { extractSymbolsFromTree } from "./extract.ts";
export type { RawSymbol, ParseInvalidationKey } from "./types.ts";
export {
  APP_GRAPH_SCHEMA_VERSION,
  APP_GRAPH_ANALYZER_VERSION,
  TREE_SITTER_GRAMMAR_VERSION,
  FORGE_CLASSIFIER_VERSION,
  GENERATOR_VERSION,
} from "./versions.ts";
