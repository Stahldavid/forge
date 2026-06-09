import { describe, expect, test } from "bun:test";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import {
  deriveStableSymbolId,
  hashStable,
} from "../../src/forge/compiler/primitives/hash.ts";
import { fixtureSource, fixtureWorkspaceRoot } from "./helpers.ts";

describe("buildAppGraph", () => {
  test("extracts and classifies Forge builder symbols", async () => {
    const graph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [
        fixtureSource("queries.ts"),
        fixtureSource("commands.ts"),
        fixtureSource("schema.ts"),
      ],
    });

    const kinds = graph.symbols.map((symbol) => symbol.kind).sort();
    expect(kinds).toEqual(["command", "liveQuery", "query", "schema.table"]);
    expect(graph.symbols.every((symbol) => symbol.file.includes("/"))).toBe(
      true,
    );
  });

  test("produces order-independent symbol sets", async () => {
    const sources = [
      fixtureSource("commands.ts"),
      fixtureSource("queries.ts"),
      fixtureSource("schema.ts"),
    ];
    const reversed = [...sources].reverse();

    const graphA = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources,
    });
    const graphB = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: reversed,
    });

    expect(graphA.symbols.map((symbol) => symbol.id).sort()).toEqual(
      graphB.symbols.map((symbol) => symbol.id).sort(),
    );
  });

  test("emits FORGE_DUP_SYMBOL for stable-id collisions", async () => {
    const graph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [fixtureSource("duplicate-same-file.ts")],
    });

    const dupWarnings = graph.diagnostics.filter(
      (diagnostic) => diagnostic.code === "FORGE_DUP_SYMBOL",
    );
    expect(dupWarnings.length).toBeGreaterThan(0);
    expect(graph.symbols.length).toBeGreaterThan(1);
  });

  test("does not dup across modules with same qualified name", async () => {
    const graph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [
        fixtureSource("duplicate-a.ts"),
        fixtureSource("duplicate-b.ts"),
      ],
    });

    const dupWarnings = graph.diagnostics.filter(
      (diagnostic) => diagnostic.code === "FORGE_DUP_SYMBOL",
    );
    expect(dupWarnings).toHaveLength(0);

    const ids = graph.symbols.map((symbol) => symbol.id);
    expect(new Set(ids).size).toBe(ids.length);

    const expectedA = deriveStableSymbolId({
      kind: "query",
      canonicalModulePath: "tests/app-graph/fixtures/duplicate-a.ts",
      qualifiedName: "getUser",
      exportPath: "",
    });
    const expectedB = deriveStableSymbolId({
      kind: "query",
      canonicalModulePath: "tests/app-graph/fixtures/duplicate-b.ts",
      qualifiedName: "getUser",
      exportPath: "",
    });
    expect(expectedA).not.toBe(expectedB);
  });

  test("reuses prior symbols when content hash is unchanged", async () => {
    const sources = [fixtureSource("queries.ts")];
    const first = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources,
    });
    const second = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources,
      prior: first,
    });

    expect(second.symbols.map((symbol) => symbol.id)).toEqual(
      first.symbols.map((symbol) => symbol.id),
    );
  });

  test("reparses when content hash changes", async () => {
    const source = fixtureSource("queries.ts");
    const prior = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [source],
    });

    const changedText = `${source.text}\n// changed\n`;
    const changed = {
      ...source,
      text: changedText,
      contentHash: hashStable(changedText),
    };

    const next = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [changed],
      prior,
    });

    expect(next.symbols.length).toBe(prior.symbols.length);
  });

  test("builds ModuleGraph with package and local imports", async () => {
    const graph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [
        fixtureSource("imports.ts"),
        fixtureSource("commands.ts"),
      ],
    });

    const importsNode = graph.moduleGraph.nodes.find(
      (node) => node.file === "tests/app-graph/fixtures/imports.ts",
    );
    expect(importsNode).toBeDefined();
    expect(
      importsNode?.directPackageImports.some(
        (imp) => imp.packageName === "stripe",
      ),
    ).toBe(true);
    expect(
      importsNode?.localImports.some((imp) => imp.toModuleId.length > 0),
    ).toBe(true);
    expect(importsNode?.declaredContexts).toContain("command");
  });
});
