import { describe, expect, test } from "bun:test";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import {
  checkImportGuards,
  propagateContexts,
  buildImportGuardsArtifact,
  buildGuardArtifactEmitFiles,
} from "../../src/forge/compiler/guards/index.ts";
import { FORGE_GUARD_VIOLATION } from "../../src/forge/compiler/diagnostics/codes.ts";
import {
  fixtureSource,
  fixtureWorkspaceRoot,
} from "../app-graph/helpers.ts";
import {
  customMatrixEntry,
  graphFromNodes,
  linkModules,
  makeModuleNode,
  stripeMatrix,
  unmanagedMatrix,
} from "./helpers.ts";

describe("checkImportGuards", () => {
  test("returns zero diagnostics when imports are compatible", () => {
    const command = makeModuleNode("src/commands/ok.ts", {
      declaredContexts: ["command"],
      packageImports: [
        {
          specifier: "zod",
          packageName: "zod",
          subpath: "",
          span: { start: 10, end: 15 },
          importKind: "static",
        },
      ],
    });

    const matrix = customMatrixEntry({
      packageName: "zod",
      compatible: ["command", "shared", "server"],
      incompatible: ["client"],
    });

    const diagnostics = checkImportGuards(graphFromNodes([command]), matrix);
    expect(diagnostics).toHaveLength(0);
  });

  test("emits FORGE_GUARD_VIOLATION for stripe in command context", () => {
    const command = makeModuleNode("src/commands/pay.ts", {
      declaredContexts: ["command"],
      packageImports: [
        {
          specifier: "stripe",
          packageName: "stripe",
          subpath: "",
          span: { start: 20, end: 28 },
          importKind: "static",
        },
      ],
    });

    const diagnostics = checkImportGuards(
      graphFromNodes([command]),
      stripeMatrix(),
    );

    expect(diagnostics.length).toBeGreaterThan(0);
    const violation = diagnostics.find((d) => d.code === FORGE_GUARD_VIOLATION);
    expect(violation).toBeDefined();
    expect(violation?.message).toContain("stripe");
    expect(violation?.message).toContain("command");
    expect(violation?.file).toBe("src/commands/pay.ts");
    expect(violation?.span).toEqual({ start: 20, end: 28 });
    expect(violation?.message.length).toBeGreaterThan(
      "'stripe' is not allowed in 'command' context: ".length,
    );
  });

  test("skips packages absent from the runtime matrix", () => {
    const command = makeModuleNode("src/commands/ext.ts", {
      declaredContexts: ["command"],
      packageImports: [
        {
          specifier: "unmanaged-lib",
          packageName: "unmanaged-lib",
          subpath: "",
          span: { start: 5, end: 20 },
          importKind: "static",
        },
      ],
    });

    const diagnostics = checkImportGuards(
      graphFromNodes([command]),
      unmanagedMatrix(),
    );
    expect(diagnostics).toHaveLength(0);
  });

  test("propagates transitive violations command → helper → stripe", () => {
    const helper = makeModuleNode("src/lib/stripe-helper.ts", {
      packageImports: [
        {
          specifier: "stripe",
          packageName: "stripe",
          subpath: "",
          span: { start: 30, end: 38 },
          importKind: "static",
        },
      ],
    });
    const command = makeModuleNode("src/commands/charge.ts", {
      declaredContexts: ["command"],
    });
    linkModules(command, helper);

    const diagnostics = checkImportGuards(
      graphFromNodes([command, helper]),
      stripeMatrix(),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(FORGE_GUARD_VIOLATION);
    expect(diagnostics[0].file).toBe("src/lib/stripe-helper.ts");
    expect(diagnostics[0].span).toEqual({ start: 30, end: 38 });
  });

  test("narrower-context-wins: multi-context helper must satisfy every effective context", () => {
    const helper = makeModuleNode("src/lib/narrow.ts", {
      packageImports: [
        {
          specifier: "narrow-only-lib",
          packageName: "narrow-only-lib",
          subpath: "",
          span: { start: 12, end: 28 },
          importKind: "static",
        },
      ],
    });
    const command = makeModuleNode("src/commands/a.ts", {
      declaredContexts: ["command"],
    });
    const query = makeModuleNode("src/queries/b.ts", {
      declaredContexts: ["query"],
    });
    linkModules(command, helper);
    linkModules(query, helper);

    const matrix = customMatrixEntry({
      packageName: "narrow-only-lib",
      compatible: ["server", "query", "action"],
      incompatible: ["command"],
    });

    const graph = graphFromNodes([command, query, helper]);
    propagateContexts(graph);

    expect(helper.effectiveContexts).toContain("command");
    expect(helper.effectiveContexts).toContain("query");

    const diagnostics = checkImportGuards(graph, matrix);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("command");
    expect(diagnostics[0].file).toBe("src/lib/narrow.ts");
  });
});

describe("guard artifacts", () => {
  test("buildGuardArtifactEmitFiles includes importGuards and runtimeMatrix ts/json", () => {
    const matrix = stripeMatrix();
    const files = buildGuardArtifactEmitFiles(matrix);
    const paths = files.map((file) => file.path).sort();

    expect(paths).toEqual([
      "src/forge/_generated/importGuards.json",
      "src/forge/_generated/importGuards.ts",
      "src/forge/_generated/runtimeMatrix.json",
      "src/forge/_generated/runtimeMatrix.ts",
    ]);
  });

  test("buildImportGuardsArtifact records module effective contexts", () => {
    const helper = makeModuleNode("src/lib/h.ts", {
      declaredContexts: ["command"],
    });
    const doc = buildImportGuardsArtifact(
      stripeMatrix(),
      graphFromNodes([helper]),
    );

    expect(doc.moduleContexts).toEqual([
      {
        file: "src/lib/h.ts",
        effectiveContexts: ["command"],
      },
    ]);
  });
});

describe("e2e: command → helper → stripe", () => {
  test("buildAppGraph + checkImportGuards yields FORGE_GUARD_VIOLATION", async () => {
    const graph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [
        fixtureSource("guard-command-chain.ts"),
        fixtureSource("guard-stripe-helper.ts"),
      ],
    });

    const diagnostics = checkImportGuards(graph.moduleGraph, stripeMatrix());
    const violations = diagnostics.filter(
      (diagnostic) => diagnostic.code === FORGE_GUARD_VIOLATION,
    );

    expect(violations.length).toBeGreaterThan(0);
    expect(
      violations.some((diagnostic) =>
        diagnostic.file?.includes("guard-stripe-helper.ts"),
      ),
    ).toBe(true);
    expect(violations[0].message).toContain("stripe");
    expect(violations[0].message).toContain("command");
  });
});
