import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { forgeAdd } from "../../src/forge/compiler/integration/add.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { checkImportGuards } from "../../src/forge/compiler/guards/check-import-guards.ts";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { buildRuntimeMatrix } from "../../src/forge/compiler/classifier/runtime-matrix.ts";
import { classify } from "../../src/forge/compiler/classifier/classify.ts";
import { resolveRecipe } from "../../src/forge/compiler/recipes/registry.ts";
import { makeExport, makePackageApi } from "../helpers/package-api.ts";
import { graphFromNodes, makeModuleNode, linkModules } from "../guards/helpers.ts";
import { getDockerRunner, setDockerRunner } from "../../src/forge/compiler/sandbox/backends/docker.ts";
import {
  cleanupWorkspace,
  createFixturePmAdapter,
  scaffoldAddWorkspace,
} from "../integration/helpers.ts";
import {
  cleanupWorkspace as cleanupGenerateWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("E2E pipeline wiring", () => {
  test("transitive guard: command → helper → stripe yields FORGE_GUARD_VIOLATION", async () => {
    const helper = makeModuleNode("src/lib/payments.ts", {
      declaredContexts: [],
      packageImports: [
        {
          specifier: "stripe",
          packageName: "stripe",
          subpath: "",
          span: { start: 10, end: 16 },
          importKind: "static",
        },
      ],
    });
    const command = makeModuleNode("src/commands/charge.ts", {
      declaredContexts: ["command"],
    });
    linkModules(command, helper);

    const api = makePackageApi({
      name: "stripe",
      entrypoints: [
        {
          subpath: ".",
          conditions: ["import", "types"],
          patternBacked: false,
          dtsPath: "index.d.ts",
          exports: [makeExport("Stripe", "class Stripe {}")],
        },
      ],
    });

    const matrix = buildRuntimeMatrix([
      {
        api,
        classification: classify(api, resolveRecipe("stripe")!),
        recipe: resolveRecipe("stripe")!,
      },
    ]);

    const diagnostics = checkImportGuards(graphFromNodes([command, helper]), matrix);
    expect(diagnostics.some((item) => item.code === "FORGE_GUARD_VIOLATION")).toBe(true);
  });

  test("orphan cleanup e2e via generate --check", async () => {
    const workspace = scaffoldGenerateWorkspace("e2e-orphan");
    try {
      const first = await run(defaultGenerateOptions(workspace));
      expect(first.exitCode).toBe(0);

      const orphan = join(workspace, "src/forge/_generated/orphan.ts");
      writeFileSync(orphan, "export const orphan = true;\n", "utf8");

      const check = await run({
        ...defaultGenerateOptions(workspace),
        check: true,
      });

      expect(check.exitCode).toBe(1);
      expect(check.errors.some((item) => item.code === "FORGE_ORPHANED_GENERATED_FILE")).toBe(true);
    } finally {
      cleanupGenerateWorkspace(workspace);
    }
  });

  test("drift --check exits 1 after mutating generated file", async () => {
    const workspace = scaffoldGenerateWorkspace("e2e-drift");
    try {
      await run(defaultGenerateOptions(workspace));
      const appGraphPath = join(workspace, "src/forge/_generated/appGraph.ts");
      writeFileSync(appGraphPath, "// mutated\n", "utf8");

      const check = await run({
        ...defaultGenerateOptions(workspace),
        check: true,
      });

      expect(check.exitCode).toBe(1);
      expect(check.warnings.some((item) => item.code === "FORGE_DRIFT")).toBe(true);
    } finally {
      cleanupGenerateWorkspace(workspace);
    }
  });

  test("docker sandbox network-block falls back to static", async () => {
    const previous = getDockerRunner();
    let workspace: string | undefined;
    setDockerRunner({
      async run() {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "network blocked",
          timedOut: false,
          oomKilled: false,
          startFailed: true,
          dockerUnavailable: false,
        };
      },
    });

    try {
      workspace = scaffoldAddWorkspace("e2e-docker-fallback");
      const result = await forgeAdd("zod", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: true,
        sandboxBackend: "docker",
        allowScripts: false,
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(
        existsSync(join(workspace, "src/forge/_generated/packages/zod.shared.ts")),
      ).toBe(true);
    } finally {
      setDockerRunner(previous);
      if (workspace) {
        cleanupWorkspace(workspace);
      }
    }
  });

  test("transactional rollback restores package.json on failed add", async () => {
    const workspace = scaffoldAddWorkspace("e2e-rollback");
    const original = readFileSync(join(workspace, "package.json"), "utf8");

    const failing = createFixturePmAdapter(() => {
      throw new Error("forced failure after snapshot");
    });

    // Override adapter to throw after modifying package.json via executor
    const result = await forgeAdd("stripe", {
      workspaceRoot: workspace,
      json: false,
      dryRun: false,
      runtimeInspect: false,
      sandboxBackend: "none",
      allowScripts: false,
      pmAdapter: {
        ...failing,
        async add() {
          writeFileSync(
            join(workspace, "package.json"),
            `${JSON.stringify({ name: "broken" }, null, 2)}\n`,
            "utf8",
          );
          throw new Error("forced failure");
        },
        dryRunAdd: failing.dryRunAdd.bind(failing),
        dryRunAddWithPath: failing.dryRunAddWithPath.bind(failing),
        detectResolvedVersion: failing.detectResolvedVersion.bind(failing),
      },
    });

    expect(result.exitCode).toBe(1);
    expect(readFileSync(join(workspace, "package.json"), "utf8")).toBe(original);
  });

  test("committed _generated round-trips through generate --check", async () => {
    const workspace = scaffoldGenerateWorkspace("e2e-roundtrip");
    try {
      const write = await run(defaultGenerateOptions(workspace));
      expect(write.exitCode).toBe(0);

      const check = await run({
        ...defaultGenerateOptions(workspace),
        check: true,
      });
      expect(check.exitCode).toBe(0);
      expect(check.changed).toEqual([]);
    } finally {
      cleanupGenerateWorkspace(workspace);
    }
  });
});
