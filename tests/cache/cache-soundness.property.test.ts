import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPackageCacheKey,
  fingerprintPackageCacheKey,
  lockfileHashAffectsCache,
} from "../../src/forge/compiler/cache/key.ts";
import { PackageCacheStore } from "../../src/forge/compiler/cache/store.ts";
import {
  PackageGraphCompiler,
  recomputeFromInputs,
} from "../../src/forge/compiler/package-graph/compiler.ts";
import { hashDtsFiles, hashPackageJson } from "../../src/forge/compiler/package-graph/checksum.ts";
import { PACKAGE_ANALYZER_VERSION } from "../../src/forge/compiler/package-graph/constants.ts";
import ts from "typescript";
import { FIXTURE_PACKAGES, tempCacheDir } from "../package-graph/helpers.ts";

describe("Property 5: Cache Soundness", () => {
  test(
    "unchanged PackageCacheKey yields identical contentChecksum",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom("nodenext", "bundler") as fc.Arbitrary<
            "nodenext" | "bundler"
          >,
          async (mode) => {
            const dep = FIXTURE_PACKAGES.zod;
            const cacheDir = tempCacheDir(`pbt-zod-${mode}`);
            mkdirSync(cacheDir, { recursive: true });

            try {
              const compiler = new PackageGraphCompiler();
              const fresh = recomputeFromInputs(dep, {
                resolutionMode: mode,
              });

              const first = await compiler.build([dep], {
                runtimeInspect: false,
                resolutionMode: mode,
                cacheDir,
                lockfileHash: "lock-a",
              });

              const second = await compiler.build([dep], {
                runtimeInspect: false,
                resolutionMode: mode,
                cacheDir,
                lockfileHash: "lock-b-changed",
              });

              expect(first.graph.packages[0]?.contentChecksum).toBe(
                fresh.contentChecksum,
              );
              expect(second.graph.packages[0]?.contentChecksum).toBe(
                fresh.contentChecksum,
              );
              expect(lockfileHashAffectsCache("anything")).toBe(false);
            } finally {
              rmSync(cacheDir, { recursive: true, force: true });
            }
          },
        ),
        { numRuns: 2 },
      );
    },
    { timeout: 60_000 },
  );
});

describe("cache invalidation and integrity", () => {
  test("reuses cache entry when per-package key is unchanged", async () => {
    const cacheDir = tempCacheDir("reuse");
    mkdirSync(cacheDir, { recursive: true });
    const compiler = new PackageGraphCompiler();

    const first = await compiler.build([FIXTURE_PACKAGES.zod], {
      runtimeInspect: false,
      resolutionMode: "nodenext",
      cacheDir,
    });
    const second = await compiler.build([FIXTURE_PACKAGES.zod], {
      runtimeInspect: false,
      resolutionMode: "nodenext",
      cacheDir,
    });

    rmSync(cacheDir, { recursive: true, force: true });
    expect(first.graph.packages[0]?.contentChecksum).toBe(
      second.graph.packages[0]?.contentChecksum,
    );
  });

  test("recomputes when package.json hash changes", async () => {
    const dep = FIXTURE_PACKAGES.zod;
    const cacheDir = tempCacheDir("invalidation");
    mkdirSync(cacheDir, { recursive: true });

    const keyBefore = buildPackageCacheKey({
      name: dep.name,
      version: dep.version,
      packageManager: dep.packageManager,
      packageJsonHash: hashPackageJson(dep.installPath),
      dtsFilesHash: hashDtsFiles(dep.installPath),
      analyzerVersion: PACKAGE_ANALYZER_VERSION,
      typescriptVersion: ts.version,
      resolutionMode: "nodenext",
    });

    const store = new PackageCacheStore(cacheDir);
    const staleApi = recomputeFromInputs(dep, { resolutionMode: "nodenext" });
    staleApi.contentChecksum = "deadbeef".repeat(8);
    await store.put(keyBefore, staleApi);

    const keyAfter = buildPackageCacheKey({
      ...keyBefore,
      packageJsonHash: "changed-hash",
    });

    expect(store.getWithValidation(keyAfter)).toEqual({ miss: true });
    rmSync(cacheDir, { recursive: true, force: true });
  });

  test("discards corrupt cache entries with warning", async () => {
    const dep = FIXTURE_PACKAGES.zod;
    const cacheDir = tempCacheDir("corrupt");
    mkdirSync(cacheDir, { recursive: true });

    const key = buildPackageCacheKey({
      name: dep.name,
      version: dep.version,
      packageManager: dep.packageManager,
      packageJsonHash: hashPackageJson(dep.installPath),
      dtsFilesHash: hashDtsFiles(dep.installPath),
      analyzerVersion: PACKAGE_ANALYZER_VERSION,
      typescriptVersion: ts.version,
      resolutionMode: "nodenext",
    });

    const store = new PackageCacheStore(cacheDir);
    const entryPath = join(
      cacheDir,
      "packages",
      `${fingerprintPackageCacheKey(key)}.json`,
    );
    writeFileSync(entryPath, "{not-json", "utf8");

    const compiler = new PackageGraphCompiler();
    const result = await compiler.build([dep], {
      runtimeInspect: false,
      resolutionMode: "nodenext",
      cacheDir,
    });

    rmSync(cacheDir, { recursive: true, force: true });
    expect(result.diagnostics.some((d) => d.code === "FORGE_CACHE_DISCARD")).toBe(
      true,
    );
    expect(result.graph.packages[0]?.contentChecksum).toMatch(/^[0-9a-f]{64}$/);
  });
});
