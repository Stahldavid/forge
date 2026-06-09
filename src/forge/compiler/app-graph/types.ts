import type { ForgeKind } from "../types/app-graph.ts";
import { APP_GRAPH_ANALYZER_VERSION } from "./versions.ts";

/** Symbol extracted from tree-sitter before stable-id assignment. */
export interface RawSymbol {
  kind: ForgeKind;
  name: string;
  qualifiedName: string;
  file: string;
  span: { start: number; end: number };
  exportPath: string;
  sourceSlice: string;
}

/** Factors that invalidate cached per-file parse results. */
export interface ParseInvalidationKey {
  schemaVersion: string;
  grammarVersion: string;
  classifierVersion: string;
  tsconfigHash: string;
}

export function parseInvalidationKeyEquals(
  a: ParseInvalidationKey,
  b: ParseInvalidationKey,
): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    a.grammarVersion === b.grammarVersion &&
    a.classifierVersion === b.classifierVersion &&
    a.tsconfigHash === b.tsconfigHash
  );
}

export function buildAnalyzerVersion(key: ParseInvalidationKey): string {
  return [
    APP_GRAPH_ANALYZER_VERSION,
    `schema:${key.schemaVersion}`,
    `grammar:${key.grammarVersion}`,
    `classifier:${key.classifierVersion}`,
    `tsconfig:${key.tsconfigHash}`,
  ].join("+");
}
