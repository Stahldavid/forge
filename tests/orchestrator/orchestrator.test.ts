import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORGE_DRIFT,
  FORGE_ORPHANED_GENERATED_FILE,
} from "../../src/forge/compiler/diagnostics/codes.ts";
import {
  BARREL_INDEX_PATH,
  FORGE_LOCK_PATH,
  GENERATED_DIR,
} from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/index.ts";
import { discover } from "../../src/forge/compiler/orchestrator/discover.ts";
import { plan } from "../../src/forge/compiler/orchestrator/plan.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { loadManifest } from "../../src/forge/compiler/orchestrator/manifest.ts";
import { verifyLockIntegrity } from "../../src/forge/compiler/orchestrator/verify.ts";
import { makeSampleLock } from "../emitter/helpers.ts";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { classify } from "../../src/forge/compiler/classifier/classify.ts";
import { PackageGraphCompiler } from "../../src/forge/compiler/package-graph/compiler.ts";
import { resolveByPackageName } from "../../src/forge/compiler/recipes/registry.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "./helpers.ts";

describe("discover", () => {
  test("collects workspace sources, dependencies, and fingerprints", () => {
    const workspace = scaffoldGenerateWorkspace("discover");
    try {
      const ctx = discover({ workspaceRoot: workspace });
      expect(ctx.sources.length).toBeGreaterThan(0);
      expect(ctx.dependencies.some((dep) => dep.name === "zod")).toBe(true);
      expect(ctx.inputFingerprint.length).toBeGreaterThan(0);
      expect(ctx.packageManager).toBeDefined();
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});

describe("plan", () => {
  test("assembles stably sorted EmitPlan with core generated artifacts", async () => {
    const workspace = scaffoldGenerateWorkspace("plan");
    try {
      const ctx = discover({ workspaceRoot: workspace });
      const appGraph = await buildAppGraph({
        workspaceRoot: workspace,
        sources: ctx.sources,
      });
      const pkgCompiler = new PackageGraphCompiler();
      const pkgResult = await pkgCompiler.build(ctx.dependencies, {
        runtimeInspect: false,
        resolutionMode: "nodenext",
        cacheDir: ctx.cacheDir,
        concurrency: 1,
      });
      const classified = pkgResult.graph.packages.map((api) => ({
        api,
        classification: classify(api, resolveByPackageName(api.name) ?? undefined),
        recipe: resolveByPackageName(api.name) ?? undefined,
      }));

      const emitPlan = plan({ appGraph, packageGraph: pkgResult.graph, classified, ctx });
      const paths = emitPlan.files.map((file) => file.path);
      const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect(paths).toEqual(sorted);
      expect(paths).toContain(`${GENERATED_DIR}/appGraph.ts`);
      expect(paths).toContain(`${GENERATED_DIR}/dataGraph.ts`);
      expect(paths).toContain(`${GENERATED_DIR}/dataGraph.json`);
      expect(paths).toContain(`${GENERATED_DIR}/runtimeGraph.json`);
      expect(paths).toContain(`${GENERATED_DIR}/runtimeRegistry.ts`);
      expect(paths).toContain(`${GENERATED_DIR}/mockMap.ts`);
      expect(paths).toContain(`${GENERATED_DIR}/runtimeMatrix.json`);
      expect(paths).toContain(`${GENERATED_DIR}/importGuards.json`);
      expect(emitPlan.lock.packages.some((entry) => entry.name === "zod")).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});

describe("run", () => {
  test("write mode updates manifest hashes and keeps changed/unchanged disjoint", async () => {
    const workspace = scaffoldGenerateWorkspace("write-manifest");
    try {
      const first = await run(defaultGenerateOptions(workspace));
      expect(first.exitCode).toBe(0);
      expect(first.changed.length).toBeGreaterThan(0);

      const union = new Set([...first.changed, ...first.unchanged]);
      for (const path of first.changed) {
        expect(first.unchanged).not.toContain(path);
      }
      expect(union.size).toBe(first.changed.length + first.unchanged.length);

      const manifest = loadManifest(join(workspace, ".forge", "cache"));
      expect(Object.keys(manifest.fileHashes).length).toBeGreaterThan(0);
      expect(manifest.fileHashes[FORGE_LOCK_PATH]).toBeDefined();
      expect(manifest.fileHashes[BARREL_INDEX_PATH]).toBeDefined();
      expect(manifest.priorAppGraph).toBeDefined();

      const second = await run(defaultGenerateOptions(workspace));
      expect(second.exitCode).toBe(0);
      expect(second.changed).toEqual([]);
      expect(second.unchanged.length).toBeGreaterThan(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("check mode does not write and fails on drift", async () => {
    const workspace = scaffoldGenerateWorkspace("check-drift");
    try {
      const initial = await run(defaultGenerateOptions(workspace));
      expect(initial.exitCode).toBe(0);

      const appGraphPath = join(workspace, GENERATED_DIR, "appGraph.ts");
      const current = readFileSync(appGraphPath, "utf8");
      writeFileSync(
        appGraphPath,
        `${stripDeterministicHeader(current)}// drift\n`,
        "utf8",
      );

      const checked = await run({
        ...defaultGenerateOptions(workspace),
        check: true,
      });
      expect(checked.exitCode).toBe(1);
      expect(checked.changed.length).toBeGreaterThan(0);
      expect(checked.warnings.some((d) => d.code === FORGE_DRIFT)).toBe(true);
      expect(checked.errors).toHaveLength(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("check mode fails on orphaned generated files", async () => {
    const workspace = scaffoldGenerateWorkspace("check-orphan");
    try {
      const initial = await run(defaultGenerateOptions(workspace));
      expect(initial.exitCode).toBe(0);

      const orphanPath = join(workspace, GENERATED_DIR, "stale.ts");
      writeFileSync(orphanPath, "export const stale = true;\n", "utf8");

      const checked = await run({
        ...defaultGenerateOptions(workspace),
        check: true,
      });
      expect(checked.exitCode).toBe(1);
      expect(
        checked.errors.some((d) => d.code === FORGE_ORPHANED_GENERATED_FILE),
      ).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("dry-run reports changes without writing", async () => {
    const workspace = scaffoldGenerateWorkspace("dry-run");
    try {
      const dry = await run({
        ...defaultGenerateOptions(workspace),
        dryRun: true,
      });
      expect(dry.exitCode).toBe(0);
      expect(dry.changed.length).toBeGreaterThan(0);
      expect(existsSync(join(workspace, GENERATED_DIR, "appGraph.ts"))).toBe(false);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("verify lock integrity fails when generated file path is missing", async () => {
    const workspace = scaffoldGenerateWorkspace("lock-integrity");
    try {
      const lock = makeSampleLock({
        packages: [
          {
            name: "zod",
            version: "3.24.1",
            recipeVersion: "1",
            runtimeContexts: ["shared"],
            capabilities: makeSampleLock().packages[0]!.capabilities,
            secrets: [],
            generatedFiles: [`${GENERATED_DIR}/packages/missing.ts`],
            contentChecksum: "checksum",
          },
        ],
      });

      const diagnostics = verifyLockIntegrity(workspace, lock);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe("FORGE_LOCK_INTEGRITY");
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
