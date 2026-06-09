import type { GenerateOptions, GenerateResult } from "../types/cli.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import { buildAppGraph } from "../app-graph/build.ts";
import { classify } from "../classifier/classify.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { buildRuntimeMatrix } from "../classifier/runtime-matrix.ts";
import { emit } from "../emitter/emit.ts";
import { renderBody } from "../emitter/render.ts";
import { hashStable } from "../primitives/hash.ts";
import { PackageGraphCompiler } from "../package-graph/compiler.ts";
import { resolveByPackageName } from "../recipes/registry.ts";
import { discover } from "./discover.ts";
import { checkImportGuards } from "./guards.ts";
import {
  loadManifest,
  saveManifest,
  updateManifestAfterWrite,
} from "./manifest.ts";
import { plan } from "./plan.ts";
import { verifyLockIntegrity } from "./verify.ts";

function classifyPackages(
  packageGraph: Awaited<ReturnType<PackageGraphCompiler["build"]>>["graph"],
): ClassifiedPackage[] {
  return packageGraph.packages.map((api) => {
    const recipe = resolveByPackageName(api.name) ?? undefined;
    return {
      api,
      classification: classify(api, recipe),
      recipe,
    };
  });
}

function collectQualityGateDiagnostics(
  appDiagnostics: Diagnostic[],
  packageDiagnostics: Diagnostic[],
  guardDiagnostics: Diagnostic[],
): Diagnostic[] {
  return [...appDiagnostics, ...packageDiagnostics, ...guardDiagnostics];
}

function buildFileHashManifest(
  plannedFiles: Array<{ path: string; content: string }>,
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const file of plannedFiles) {
    hashes[file.path] = hashStable(file.content);
  }
  return hashes;
}

export async function run(options: GenerateOptions): Promise<GenerateResult> {
  const ctx = discover({ workspaceRoot: options.workspaceRoot });
  const manifest = loadManifest(ctx.cacheDir);

  const pkgCompiler = new PackageGraphCompiler();

  const [appGraph, pkgResult] = await Promise.all([
    buildAppGraph({
      workspaceRoot: ctx.workspaceRoot,
      sources: ctx.sources,
      prior: manifest.priorAppGraph,
      tsconfigPath: ctx.tsconfigPath ?? undefined,
    }),
    pkgCompiler.build(ctx.dependencies, {
      runtimeInspect: false,
      resolutionMode: "nodenext",
      cacheDir: ctx.cacheDir,
      concurrency: options.concurrency,
      lockfileHash: ctx.lockfileHash,
    }),
  ]);

  const classified = classifyPackages(pkgResult.graph);
  const emitPlan = plan({
    appGraph,
    packageGraph: pkgResult.graph,
    classified,
    ctx,
  });

  const matrix = buildRuntimeMatrix(classified);
  const guardDiagnostics = checkImportGuards(appGraph.moduleGraph, matrix);
  const qualityDiagnostics = collectQualityGateDiagnostics(
    appGraph.diagnostics,
    pkgResult.diagnostics,
    guardDiagnostics,
  );

  const mode = options.check
    ? "check"
    : options.dryRun
      ? "dry-run"
      : "write";

  const emitResult = await emit(emitPlan, {
    workspaceRoot: ctx.workspaceRoot,
    mode,
  });

  const warnings: Diagnostic[] = [
    ...qualityDiagnostics.filter((d) => d.severity === "warning"),
    ...emitResult.warnings,
  ];
  const errors: Diagnostic[] = [
    ...qualityDiagnostics.filter((d) => d.severity === "error"),
    ...emitResult.errors,
  ];

  if (mode === "write" && errors.length === 0) {
    const integrityErrors = verifyLockIntegrity(ctx.workspaceRoot, emitPlan.lock);
    errors.push(...integrityErrors);

    if (integrityErrors.length === 0) {
      const fileHashes = buildFileHashManifest(
        emitPlan.files.map((file) => ({
          path: file.path,
          content: renderBody(file),
        })),
      );

      saveManifest(
        ctx.cacheDir,
        updateManifestAfterWrite(
          manifest,
          fileHashes,
          appGraph,
          ctx.inputFingerprint,
        ),
      );
    }
  }

  const driftFailure =
    options.check &&
    (emitResult.changed.length > 0 ||
      emitPlan.orphanedFiles.length > 0 ||
      emitResult.wouldChange.includes("forge.lock"));

  const exitCode: 0 | 1 =
    errors.length > 0 || driftFailure ? 1 : 0;

  const plannedPaths = new Set([
    ...emitPlan.files.map((file) => file.path),
    "forge.lock",
    "src/forge/_generated/index.ts",
  ]);

  const changed = emitResult.changed.filter((path) => plannedPaths.has(path));
  const unchanged = emitResult.unchanged.filter((path) =>
    plannedPaths.has(path),
  );

  return {
    changed,
    unchanged,
    warnings,
    errors,
    exitCode,
  };
}

export interface GenerationOrchestrator {
  run(options: GenerateOptions): Promise<GenerateResult>;
}

export function createGenerationOrchestrator(): GenerationOrchestrator {
  return { run };
}
