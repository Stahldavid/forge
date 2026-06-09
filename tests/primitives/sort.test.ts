import { describe, expect, test } from "bun:test";
import type {
  ForgeEdge,
  ForgeSymbol,
} from "../../src/forge/compiler/types/app-graph.ts";
import type {
  Entrypoint,
  ExportSignature,
  PackageApi,
} from "../../src/forge/compiler/types/package-graph.ts";
import {
  stableSortEdges,
  stableSortEntrypoints,
  stableSortExports,
  stableSortPackages,
  stableSortSymbols,
} from "../../src/forge/compiler/primitives/sort.ts";

function makeSymbol(
  overrides: Partial<ForgeSymbol> & Pick<ForgeSymbol, "id" | "name" | "file">,
): ForgeSymbol {
  return {
    kind: "query",
    qualifiedName: overrides.name,
    span: { start: 0, end: 10 },
    contentHash: "hash",
    meta: {},
    ...overrides,
  };
}

describe("stableSortSymbols", () => {
  test("sorts by (kind, name, file, span.start)", () => {
    const symbols = [
      makeSymbol({ id: "1", kind: "command", name: "b", file: "src/b.ts", span: { start: 5, end: 10 } }),
      makeSymbol({ id: "2", kind: "command", name: "a", file: "src/a.ts", span: { start: 0, end: 10 } }),
      makeSymbol({ id: "3", kind: "query", name: "z", file: "src/z.ts", span: { start: 0, end: 10 } }),
    ];
    const sorted = stableSortSymbols(symbols);
    expect(sorted.map((s) => s.id)).toEqual(["2", "1", "3"]);
  });
});

describe("stableSortEdges", () => {
  test("sorts by (from, to, kind)", () => {
    const edges: ForgeEdge[] = [
      { from: "b", to: "c", kind: "references" },
      { from: "a", to: "b", kind: "registers" },
      { from: "a", to: "b", kind: "emits" },
    ];
    const sorted = stableSortEdges(edges);
    expect(sorted).toEqual([
      { from: "a", to: "b", kind: "emits" },
      { from: "a", to: "b", kind: "registers" },
      { from: "b", to: "c", kind: "references" },
    ]);
  });
});

describe("stableSortPackages", () => {
  test("sorts packages by name", () => {
    const packages: PackageApi[] = [
      {
        name: "zod",
        version: "3.0.0",
        packageManager: "bun",
        resolutionMode: "bundler",
        entrypoints: [],
        source: "static",
        contentChecksum: "a",
      },
      {
        name: "ai",
        version: "4.0.0",
        packageManager: "bun",
        resolutionMode: "bundler",
        entrypoints: [],
        source: "static",
        contentChecksum: "b",
      },
    ];
    expect(stableSortPackages(packages).map((p) => p.name)).toEqual([
      "ai",
      "zod",
    ]);
  });
});

describe("stableSortEntrypoints", () => {
  test("sorts entrypoints by subpath", () => {
    const entrypoints: Entrypoint[] = [
      { subpath: "./server", conditions: [], patternBacked: false, dtsPath: null, exports: [] },
      { subpath: ".", conditions: [], patternBacked: false, dtsPath: null, exports: [] },
    ];
    expect(stableSortEntrypoints(entrypoints).map((e) => e.subpath)).toEqual([
      ".",
      "./server",
    ]);
  });
});

describe("stableSortExports", () => {
  test("sorts exports by name", () => {
    const makeExport = (name: string): ExportSignature => ({
      name,
      kind: "function",
      signature: "fn()",
      classification: {
        alias: "zod",
        packageName: "zod",
        entrypoint: ".",
        exportName: name,
        compatible: [],
        incompatible: [],
        capabilities: {
          network: { status: "not-detected", confidence: "static", evidence: [] },
          filesystem: { status: "not-detected", confidence: "static", evidence: [] },
          process: { status: "not-detected", confidence: "static", evidence: [] },
          nativeAddon: { status: "not-detected", confidence: "static", evidence: [] },
          lifecycleScripts: { status: "not-detected", confidence: "static", evidence: [] },
          secrets: [],
        },
      },
      jsdoc: null,
      examples: [],
    });

    const exports = [makeExport("z"), makeExport("a")];
    expect(stableSortExports(exports).map((e) => e.name)).toEqual(["a", "z"]);
  });
});
