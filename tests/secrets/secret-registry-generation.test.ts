import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildSecretRegistry, buildEnvSchema } from "../../src/forge/compiler/secret-registry/build.ts";
import { classify } from "../../src/forge/compiler/classifier/classify.ts";
import { PackageGraphCompiler } from "../../src/forge/compiler/package-graph/compiler.ts";
import { STRIPE_RECIPE } from "../../src/forge/compiler/recipes/definitions.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { readFileSync } from "node:fs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("secret registry generation", () => {
  test("emits secretRegistry and envSchema from stripe recipe", async () => {
    const workspace = scaffoldGenerateWorkspace("secret-registry-gen");
    writeFileSync(
      join(workspace, "package.json"),
      JSON.stringify({
        name: "secret-registry-app",
        dependencies: { stripe: "17.0.0" },
      }),
      "utf8",
    );

    try {
      const result = await run(defaultGenerateOptions(workspace));
      expect(result.exitCode).toBe(0);

      const registry = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, GENERATED_DIR, "secretRegistry.json"), "utf8"),
        ),
      );
      expect(registry.secrets.some((s: { name: string }) => s.name === "STRIPE_SECRET_KEY")).toBe(
        true,
      );

      const envSchema = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, GENERATED_DIR, "envSchema.json"), "utf8"),
        ),
      );
      expect(envSchema.variables.length).toBeGreaterThan(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("buildSecretRegistry collects recipe secrets", async () => {
    const compiler = new PackageGraphCompiler();
    const cacheDir = mkdtempSync(join(tmpdir(), "forge-secret-registry-cache-"));
    const dep = {
      name: "stripe",
      version: "17.0.0",
      packageManager: "bun" as const,
      installPath: join(repoRoot, "tests", "fixtures", "packages", "stripe"),
      packageIntegrity: undefined as string | undefined,
    };
    try {
      const api = await compiler.analyze(dep, {
        runtimeInspect: false,
        resolutionMode: "nodenext",
        cacheDir,
        recipeVersion: STRIPE_RECIPE.recipeVersion,
      });

      const classified = {
        api,
        classification: classify(api, STRIPE_RECIPE),
        recipe: STRIPE_RECIPE,
      };

      const registry = buildSecretRegistry([classified]);
      expect(registry.secrets.map((entry) => entry.name)).toContain("STRIPE_SECRET_KEY");

      const envSchema = buildEnvSchema(registry);
      expect(envSchema.variables.every((variable) => variable.kind === "secret")).toBe(true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
