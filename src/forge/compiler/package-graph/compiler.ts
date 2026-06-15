import { join, relative } from "node:path";
import ts from "typescript";
import type { Diagnostic } from "../types/diagnostic.ts";
import type {
  AnalyzeOptions,
  Dependency,
  Entrypoint,
  PackageApi,
  PackageGraph,
} from "../types/package-graph.ts";
import type { PackageCacheKey } from "../types/lock.ts";
import type { ResolutionMode } from "../types/runtime.ts";
import { forgePkgNoTypes } from "../diagnostics/create.ts";
import { createDiagnostic } from "../diagnostics/create.ts";
import { stableSortEntrypoints, stableSortPackages } from "../primitives/sort.ts";
import {
  PackageCacheStore,
  forgeCacheDiscardedMessage,
} from "../cache/store.ts";
import { buildPackageCacheKey, cacheKeysEqual } from "../cache/key.ts";
import { runWithConcurrency } from "../cache/scheduler.ts";
import {
  GENERATOR_VERSION,
  PACKAGE_ANALYZER_VERSION,
  PACKAGE_GRAPH_SCHEMA_VERSION,
  DEFAULT_PATTERN_EXPANSION_LIMIT,
} from "./constants.ts";
import {
  computeContentChecksum,
  hashDtsFiles,
  hashDtsFilesForCache,
  hashPackageJson,
  hashPackageJsonForCache,
} from "./checksum.ts";
import {
  discoverSubpathsFromExports,
  expandPatternSubpaths,
} from "./exports-discovery.ts";
import { DtsSignatureExtractor } from "./dts-extractor.ts";
import { readTextFile } from "./read-file.ts";
import {
  resolveEntrypointTypes,
  resolveTypesPackage,
  typesPackageName,
} from "./resolve.ts";
import {
  buildRuntimeCompatibility,
  readPackageMetadata,
  runtimeTypeMismatches,
} from "./oracle.ts";
import {
  assertPackageApiSecretSafe,
  defaultSandboxLimits,
  inspectExports,
} from "../sandbox/index.ts";
import type { SandboxBackend } from "../types/runtime.ts";

export interface BuildOptions extends AnalyzeOptions {
  concurrency?: number;
  patternExpansionLimit?: number;
  /** Informational only — does not invalidate per-package cache entries. */
  lockfileHash?: string;
}

export interface AnalyzeResult {
  api: PackageApi;
  diagnostics: Diagnostic[];
  cacheHit: boolean;
}

export interface BuildResult {
  graph: PackageGraph;
  diagnostics: Diagnostic[];
}

export class PackageGraphCompiler {
  async build(
    deps: Dependency[],
    opts: BuildOptions,
  ): Promise<BuildResult> {
    const concurrency = Math.max(1, opts.concurrency ?? 4);
    const cache = new PackageCacheStore(opts.cacheDir);
    const diagnostics: Diagnostic[] = [];

    const results = await runWithConcurrency(
      deps,
      concurrency,
      async (dep) => this.analyzeWithCache(dep, opts, cache),
    );

    for (const result of results) {
      diagnostics.push(...result.diagnostics);
    }

    const packages = stableSortPackages(results.map((r) => r.api));

    return {
      graph: {
        schemaVersion: PACKAGE_GRAPH_SCHEMA_VERSION,
        generatorVersion: GENERATOR_VERSION,
        analyzerVersion: PACKAGE_ANALYZER_VERSION,
        packages,
      },
      diagnostics,
    };
  }

  async analyze(
    dep: Dependency,
    opts: AnalyzeOptions,
  ): Promise<PackageApi> {
    const result = await this.analyzeWithCache(
      dep,
      opts,
      new PackageCacheStore(opts.cacheDir),
    );
    return result.api;
  }

  private async analyzeWithCache(
    dep: Dependency,
    opts: BuildOptions,
    cache: PackageCacheStore,
  ): Promise<AnalyzeResult> {
    const cacheKey = buildPackageCacheKey({
      name: dep.name,
      version: dep.version,
      packageManager: dep.packageManager,
      packageIntegrity: dep.packageIntegrity,
      packageJsonHash: hashPackageJsonForCache(dep.installPath),
      dtsFilesHash: hashDtsFilesForCache(dep.installPath),
      analyzerVersion: PACKAGE_ANALYZER_VERSION,
      typescriptVersion: ts.version,
      resolutionMode: opts.resolutionMode,
      recipeVersion: opts.recipeVersion,
    });

    const lookup = cache.getWithValidation(cacheKey);
    if ("hit" in lookup) {
      return { api: lookup.hit, diagnostics: [], cacheHit: true };
    }

    const diagnostics: Diagnostic[] = [];
    if ("corrupt" in lookup) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_CACHE_DISCARD",
          message: forgeCacheDiscardedMessage(),
        }),
      );
    }

    const analyzed = await this.analyzeWithOptionalRuntime(dep, opts, {
      packageJsonHash: hashPackageJson(dep.installPath),
      dtsFilesHash: hashDtsFiles(dep.installPath),
    });
    diagnostics.push(...analyzed.diagnostics);
    assertPackageApiSecretSafe(analyzed.api);
    await cache.put(cacheKey, analyzed.api);
    return { api: analyzed.api, diagnostics, cacheHit: false };
  }

  private async analyzeWithOptionalRuntime(
    dep: Dependency,
    opts: BuildOptions,
    packageHashes: { packageJsonHash: string; dtsFilesHash: string },
  ): Promise<{ api: PackageApi; diagnostics: Diagnostic[] }> {
    const staticResult = this.analyzeStatic(dep, opts, packageHashes);
    if (!opts.runtimeInspect) {
      return staticResult;
    }

    const backend = resolveSandboxBackend(opts);
    const sandbox = await inspectExports(
      dep,
      defaultSandboxLimits(backend),
    );

    const diagnostics = [
      ...staticResult.diagnostics,
      ...sandbox.diagnostics,
    ];

    if (!sandbox.runtimeUsed) {
      return { api: staticResult.api, diagnostics };
    }

    const api: PackageApi = {
      ...staticResult.api,
      source: "static+runtime",
      runtimeShape: sandbox.shape,
      runtimeTypeMismatches: runtimeTypeMismatches({
        entrypoints: staticResult.api.entrypoints,
        runtimeShape: sandbox.shape,
      }),
      contentChecksum: computeContentChecksum(
        packageHashes.packageJsonHash,
        packageHashes.dtsFilesHash,
        {
          ...staticResult.api,
          source: "static+runtime",
          runtimeShape: sandbox.shape,
        },
      ),
    };

    return { api, diagnostics };
  }

  analyzeStatic(
    dep: Dependency,
    opts: BuildOptions,
    packageHashes?: { packageJsonHash: string; dtsFilesHash: string },
  ): { api: PackageApi; diagnostics: Diagnostic[] } {
    const diagnostics: Diagnostic[] = [];
    const packageJson = readPackageJson(dep.installPath);
    const patternLimit =
      opts.patternExpansionLimit ?? DEFAULT_PATTERN_EXPANSION_LIMIT;

    const discovered = discoverSubpathsFromExports(packageJson.exports);
    const subpathsToAnalyze: Array<{
      subpath: string;
      patternBacked: boolean;
    }> = [];

    for (const item of discovered) {
      if (item.patternBacked) {
        const expanded = expandPatternSubpaths(
          dep.installPath,
          item.subpath,
          patternLimit,
        );
        for (const sub of expanded) {
          subpathsToAnalyze.push({ subpath: sub, patternBacked: true });
        }
        if (expanded.length === 0) {
          subpathsToAnalyze.push(item);
        }
      } else {
        subpathsToAnalyze.push(item);
      }
    }

    const entrypoints: Entrypoint[] = [];
    const dtsExtractor = new DtsSignatureExtractor(opts.resolutionMode);

    for (const { subpath, patternBacked } of subpathsToAnalyze) {
      const entry = this.analyzeEntrypoint(
        dep,
        subpath,
        patternBacked,
        opts.resolutionMode,
        diagnostics,
        dtsExtractor,
      );
      entrypoints.push(entry);
    }

    const sortedEntrypoints = stableSortEntrypoints(entrypoints);
    const metadata = readPackageMetadata(dep.installPath, sortedEntrypoints.length);
    const runtimeCompatibility = buildRuntimeCompatibility(metadata);
    const packageJsonHash =
      packageHashes?.packageJsonHash ?? hashPackageJson(dep.installPath);
    const dtsFilesHash =
      packageHashes?.dtsFilesHash ?? hashDtsFiles(dep.installPath);

    const partialApi = {
      name: dep.name,
      version: dep.version,
      packageManager: dep.packageManager,
      resolutionMode: opts.resolutionMode,
      entrypoints: sortedEntrypoints,
      source: "static" as const,
      runtimeTypeMismatches: [],
      runtimeCompatibility,
      metadata,
    };

    const contentChecksum = computeContentChecksum(
      packageJsonHash,
      dtsFilesHash,
      partialApi,
    );

    return {
      api: { ...partialApi, contentChecksum },
      diagnostics,
    };
  }

  private analyzeEntrypoint(
    dep: Dependency,
    subpath: string,
    patternBacked: boolean,
    mode: ResolutionMode,
    diagnostics: Diagnostic[],
    dtsExtractor: DtsSignatureExtractor,
  ): Entrypoint {
    if (isPackageJsonSubpath(subpath)) {
      return {
        subpath,
        conditions: [],
        patternBacked,
        dtsPath: null,
        resolutionTrace: [
          {
            step: "package.metadata",
            status: "ok",
            detail: "package.json export is metadata and has no type API",
          },
        ],
        exports: [],
      };
    }

    const resolutionTrace: Entrypoint["resolutionTrace"] = [
      {
        step: "typescript.resolveModuleName",
        status: "ok",
        detail: `resolve ${dep.name} ${subpath} with ${mode}`,
      },
    ];
    let resolved = resolveEntrypointTypes(
      dep.installPath,
      dep.name,
      subpath,
      mode,
    );

    if (resolved.dtsPath == null) {
      resolutionTrace.push({
        step: "package.types",
        status: "miss",
        detail: "no bundled type declaration resolved",
      });
      const typesPackage = typesPackageName(dep.name);
      const fallbackPath = resolveTypesPackage(
        typesPackage,
        dep.installPath,
        mode,
      );
      if (fallbackPath != null) {
        resolutionTrace.push({
          step: "typesPackage.fallback",
          status: "fallback",
          detail: `resolved ${typesPackage}`,
        });
        resolved = { dtsPath: fallbackPath, conditions: ["types"] };
      } else {
        resolutionTrace.push({
          step: "typesPackage.fallback",
          status: "miss",
          detail: `${typesPackage} not found`,
        });
      }
    } else {
      resolutionTrace.push({
        step: "package.types",
        status: "ok",
        detail: portableDtsPath(resolved.dtsPath, dep),
      });
    }

    if (resolved.dtsPath == null) {
      diagnostics.push(forgePkgNoTypes(dep.name, subpath));
      return {
        subpath,
        conditions: resolved.conditions,
        patternBacked,
        dtsPath: null,
        resolutionTrace,
        exports: [],
      };
    }

    let exports: Entrypoint["exports"];
    try {
      exports = dtsExtractor.extract(
        resolved.dtsPath,
        dep.name,
        subpath,
      );
    } catch {
      diagnostics.push(forgePkgNoTypes(dep.name, subpath));
      return {
        subpath,
        conditions: resolved.conditions,
        patternBacked,
        dtsPath: portableDtsPath(resolved.dtsPath, dep),
        resolutionTrace: [
          ...resolutionTrace,
          {
            step: "dts.extract",
            status: "warning",
            detail: "failed to extract declarations",
          },
        ],
        exports: [],
      };
    }

    if (exports.length === 0) {
      diagnostics.push(forgePkgNoTypes(dep.name, subpath));
    }

    return {
      subpath,
      conditions: resolved.conditions,
      patternBacked,
      dtsPath: portableDtsPath(resolved.dtsPath, dep),
      resolutionTrace: [
        ...resolutionTrace,
        {
          step: "dts.extract",
          status: exports.length > 0 ? "ok" : "warning",
          detail: `${exports.length} exports extracted`,
        },
      ],
      exports,
    };
  }
}

function isPackageJsonSubpath(subpath: string): boolean {
  return subpath === "./package.json" || subpath === "package.json";
}

function portableDtsPath(dtsPath: string, dep: Pick<Dependency, "installPath" | "name">): string {
  const normalized = dtsPath.replace(/\\/g, "/");
  const marker = "/node_modules/";
  const index = normalized.lastIndexOf(marker);
  if (index >= 0) {
    return normalized.slice(index + 1);
  }
  if (normalized.startsWith("node_modules/")) {
    return normalized;
  }
  const packageRelative = relative(dep.installPath, dtsPath).replace(/\\/g, "/");
  if (packageRelative && !packageRelative.startsWith("../") && packageRelative !== "..") {
    return `packages/${dep.name}/${packageRelative}`;
  }
  return normalized;
}

function readPackageJson(installPath: string): {
  exports?: unknown;
} {
  const raw = readTextFile(join(installPath, "package.json"));
  return JSON.parse(raw) as { exports?: unknown };
}

function resolveSandboxBackend(
  opts: Pick<AnalyzeOptions, "sandboxBackend">,
): SandboxBackend {
  return opts.sandboxBackend ?? "none";
}

export function recomputeFromInputs(
  dep: Dependency,
  opts: Pick<BuildOptions, "resolutionMode" | "patternExpansionLimit">,
): PackageApi {
  const compiler = new PackageGraphCompiler();
  return compiler.analyzeStatic(dep, {
    runtimeInspect: false,
    resolutionMode: opts.resolutionMode,
    cacheDir: "",
    patternExpansionLimit: opts.patternExpansionLimit,
  }).api;
}

export { cacheKeysEqual, buildPackageCacheKey };
export type { PackageCacheKey };
