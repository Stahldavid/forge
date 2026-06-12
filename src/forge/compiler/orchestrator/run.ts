import {
  formatFileSystemProfile,
  getFileSystemProfile,
} from "../fs/index.ts";
import type { GenerateOptions, GenerateResult } from "../types/cli.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import { classify } from "../classifier/classify.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { buildRuntimeMatrix } from "../classifier/runtime-matrix.ts";
import { emit } from "../emitter/emit.ts";
import { PackageGraphCompiler } from "../package-graph/compiler.ts";
import { resolveByPackageName } from "../recipes/registry.ts";
import { checkImportGuards } from "./guards.ts";
import {
  saveManifest,
  updateManifestAfterWrite,
} from "./manifest.ts";
import { buildManifestFileHashes } from "./manifest-hashes.ts";
import { runFastGenerateCheck } from "./fast-check.ts";
import {
  formatCompileTimings,
  isCompileProfileEnabled,
  recordCompileTimings,
} from "./profile.ts";
import { plan } from "./plan.ts";
import {
  buildAppGraphForSession,
  discoverForSession,
  getCompileSession,
  loadManifestForSession,
} from "./session.ts";
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

function appGraphForManifest(
  appGraph: Awaited<ReturnType<typeof buildAppGraphForSession>>,
): Awaited<ReturnType<typeof buildAppGraphForSession>> {
  return {
    ...appGraph,
    moduleGraph: {
      nodes: appGraph.moduleGraph.nodes.map((node) => ({
        ...node,
        directPackageImports: [...node.directPackageImports],
        localImports: [...node.localImports],
        declaredContexts: [...node.declaredContexts],
        effectiveContexts: [],
      })),
    },
  };
}

export async function run(options: GenerateOptions): Promise<GenerateResult> {
  const profileEnabled = isCompileProfileEnabled();
  const runStarted = profileEnabled ? performance.now() : 0;
  let generateCheckCache: GenerateResult["cache"] =
    options.check && !options.dryRun
      ? {
          strategy: "generated-check",
          result: "skipped",
          reason: "fast check not attempted",
        }
      : undefined;

  if (options.check && !options.dryRun) {
    const fastCheck = runFastGenerateCheck(options.workspaceRoot);
    if (fastCheck.kind === "hit") {
      return fastCheck.result;
    }
    generateCheckCache = {
      strategy: "generated-check",
      result: "miss",
      reason: fastCheck.reason,
    };
  }

  const session = getCompileSession(options.workspaceRoot);

  const discoverStarted = profileEnabled ? performance.now() : 0;
  const ctx = discoverForSession(session);
  const manifest = loadManifestForSession(session);
  const discoverMs = profileEnabled ? performance.now() - discoverStarted : 0;

  const pkgCompiler = new PackageGraphCompiler();

  const graphStarted = profileEnabled ? performance.now() : 0;
  const [appGraph, pkgResult] = await Promise.all([
    buildAppGraphForSession(session),
    pkgCompiler.build(ctx.dependencies, {
      runtimeInspect: false,
      resolutionMode: "nodenext",
      cacheDir: ctx.cacheDir,
      concurrency: options.concurrency,
      lockfileHash: ctx.lockfileHash,
    }),
  ]);
  const graphMs = profileEnabled ? performance.now() - graphStarted : 0;

  const classified = classifyPackages(pkgResult.graph);

  const planStarted = profileEnabled ? performance.now() : 0;
  const emitPlan = plan({
    appGraph,
    packageGraph: pkgResult.graph,
    classified,
    ctx,
  });
  const planMs = profileEnabled ? performance.now() - planStarted : 0;

  const mode = options.check
    ? "check"
    : options.dryRun
      ? "dry-run"
      : "write";

  const matrix = buildRuntimeMatrix(classified);
  const guardDiagnostics = checkImportGuards(appGraph.moduleGraph, matrix);
  // Import guards fail `forge check`; generate/drift only surface them as warnings.
  const guardDiagnosticsForGate =
    mode === "check"
      ? []
      : guardDiagnostics.map((diagnostic) =>
          diagnostic.severity === "error"
            ? { ...diagnostic, severity: "warning" as const }
            : diagnostic,
        );
  const qualityDiagnostics = collectQualityGateDiagnostics(
    appGraph.diagnostics,
    pkgResult.diagnostics,
    [...guardDiagnosticsForGate, ...(emitPlan.diagnostics ?? [])],
  );

  const emitStarted = profileEnabled ? performance.now() : 0;
  const emitResult = await emit(emitPlan, {
    workspaceRoot: ctx.workspaceRoot,
    mode,
  });
  const emitMs = profileEnabled ? performance.now() - emitStarted : 0;

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
      const fileHashes = buildManifestFileHashes(emitPlan);

      saveManifest(
        ctx.cacheDir,
        updateManifestAfterWrite(
          manifest,
          fileHashes,
          appGraphForManifest(appGraph),
          ctx.inputFingerprint,
          ctx.sourceFileIndex,
          ctx.sources,
        ),
      );
    }
  }

  if (profileEnabled) {
    const totalMs = performance.now() - runStarted;
    recordCompileTimings({
      discoverMs,
      appGraphMs: graphMs,
      packageGraphMs: 0,
      planMs,
      emitMs,
      totalMs,
    });
    const fsProfile = getFileSystemProfile();
    process.stderr.write(`${formatCompileTimings({
      discoverMs,
      appGraphMs: graphMs,
      packageGraphMs: 0,
      planMs,
      emitMs,
      totalMs,
    })}\n`);
    if (fsProfile) {
      process.stderr.write(`${formatFileSystemProfile(fsProfile)}\n`);
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
    ...(generateCheckCache ? { cache: generateCheckCache } : {}),
    exitCode,
  };
}

export interface GenerationOrchestrator {
  run(options: GenerateOptions): Promise<GenerateResult>;
}

export function createGenerationOrchestrator(): GenerationOrchestrator {
  return { run };
}
