import { describe, expect, test } from "bun:test";
import { incrementalParse } from "../../src/forge/compiler/app-graph/parser.ts";
import type { ParseInvalidationKey } from "../../src/forge/compiler/app-graph/types.ts";
import {
  APP_GRAPH_SCHEMA_VERSION,
  FORGE_CLASSIFIER_VERSION,
  TREE_SITTER_GRAMMAR_VERSION,
} from "../../src/forge/compiler/app-graph/versions.ts";
import { hashStable } from "../../src/forge/compiler/primitives/hash.ts";
import { fixtureSource } from "./helpers.ts";

function invalidationKey(tsconfigHash = "abc"): ParseInvalidationKey {
  return {
    schemaVersion: APP_GRAPH_SCHEMA_VERSION,
    grammarVersion: TREE_SITTER_GRAMMAR_VERSION,
    classifierVersion: FORGE_CLASSIFIER_VERSION,
    tsconfigHash,
  };
}

describe("incrementalParse", () => {
  test("invalidates all files when classifier version changes", () => {
    const source = fixtureSource("queries.ts");
    const keyA = invalidationKey("cfg-a");
    const keyB = {
      ...keyA,
      classifierVersion: "0.2.0",
    };

    const first = incrementalParse([source], undefined, undefined, undefined, keyA);
    const priorSymbols = first.symbols.map((raw, index) => ({
      id: `prior-${index}`,
      kind: raw.kind,
      name: raw.name,
      qualifiedName: raw.qualifiedName,
      file: raw.file,
      span: raw.span,
      contentHash: hashStable(raw.sourceSlice),
      meta: {
        exportPath: raw.exportPath,
        fileContentHash: source.contentHash,
      },
    }));

    const second = incrementalParse(
      [source],
      priorSymbols,
      { [source.path]: source.contentHash },
      keyA,
      keyB,
    );

    expect(second.symbols.length).toBe(first.symbols.length);
  });

  test("reuses cached symbols when content hash is unchanged", () => {
    const source = fixtureSource("queries.ts");
    const key = invalidationKey("cfg-stable");

    const first = incrementalParse([source], undefined, undefined, undefined, key);
    const priorSymbols = first.symbols.map((raw, index) => ({
      id: `cached-${index}`,
      kind: raw.kind,
      name: raw.name,
      qualifiedName: raw.qualifiedName,
      file: raw.file,
      span: raw.span,
      contentHash: hashStable(raw.sourceSlice),
      meta: {
        exportPath: raw.exportPath,
        fileContentHash: source.contentHash,
      },
    }));

    const second = incrementalParse(
      [source],
      priorSymbols,
      { [source.path]: source.contentHash },
      key,
      key,
    );
    expect(second.diagnostics).toHaveLength(0);
    expect(second.symbols.length).toBe(first.symbols.length);
  });

  test("reuses unchanged files that have no cached symbols", () => {
    const key = invalidationKey("cfg-empty-file");
    const source = {
      path: "src/helpers/plain.ts",
      text: "export const value = 1;\n",
      contentHash: hashStable("export const value = 1;\n"),
    };

    const second = incrementalParse(
      [source],
      [],
      { [source.path]: source.contentHash },
      key,
      key,
    );

    expect(second.diagnostics).toHaveLength(0);
    expect(second.symbols).toEqual([]);
  });
});
