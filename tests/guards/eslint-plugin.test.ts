import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildImportGuardsArtifact,
  buildRuntimeMatrixEmitFiles,
} from "../../src/forge/compiler/guards/index.ts";
import {
  checkSourceForgeGuards,
  loadForgeGuardArtifacts,
} from "../../packages/eslint-plugin-forge/index.ts";
import { stripeMatrix } from "./helpers.ts";
import { graphFromNodes, makeModuleNode } from "./helpers.ts";

function tempDir(): string {
  const dir = join(import.meta.dir, ".tmp", Bun.randomUUIDv7());
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("eslint-plugin-forge", () => {
  test("reads importGuards.json and runtimeMatrix.json and reports violations", () => {
    const dir = tempDir();
    const helper = makeModuleNode("tests/app-graph/fixtures/guard-stripe-helper.ts", {
      declaredContexts: ["command"],
      packageImports: [
        {
          specifier: "stripe",
          packageName: "stripe",
          subpath: "",
          span: { start: 0, end: 0 },
          importKind: "static",
        },
      ],
    });

    const matrix = stripeMatrix();
    const guards = buildImportGuardsArtifact(matrix, graphFromNodes([helper]));
    const matrixFiles = buildRuntimeMatrixEmitFiles(matrix);

    const importGuardsPath = join(dir, "importGuards.json");
    const runtimeMatrixPath = join(dir, "runtimeMatrix.json");
    writeFileSync(importGuardsPath, JSON.stringify(guards));
    writeFileSync(
      runtimeMatrixPath,
      matrixFiles.find((file) => file.path.endsWith(".json"))!.content,
    );

    const artifacts = loadForgeGuardArtifacts(importGuardsPath, runtimeMatrixPath);
    const source = "import Stripe from 'stripe';\n";
    const violations = checkSourceForgeGuards(
      "tests/app-graph/fixtures/guard-stripe-helper.ts",
      source,
      artifacts.importGuards,
      artifacts.runtimeMatrix,
    );

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].packageName).toBe("stripe");
    expect(violations[0].context).toBe("command");

    rmSync(dir, { recursive: true, force: true });
  });
});
