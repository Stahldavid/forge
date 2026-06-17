import {
  formatFileSystemProfile,
  getFileSystemProfile,
} from "../fs/index.ts";
import type { GenerateOptions, GenerateResult } from "../types/cli.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import { classify } from "../classifier/classify.ts";
import { getAppGraphProfile } from "../app-graph/profile.ts";
import {
  clearSignalProfile,
  getSignalProfile,
  resetSignalProfile,
} from "../classifier/signals.ts";
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
  acquireGenerateLock,
  GENERATE_LOCK_FAILURE_KIND,
} from "./generate-lock.ts";
import {
  formatCompileTimings,
  isCompileProfileEnabled,
  recordCompileTimings,
  shouldPrintCompileProfile,
} from "./profile.ts";
import { plan } from "./plan.ts";
import { getPlanProfile } from "./plan-profile.ts";
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
  if (process.env.FORGE_GENERATE_LOCK_DISABLED !== "1") {
    const lock = await acquireGenerateLock(options.workspaceRoot);
    if (!lock.ok) {
      return {
        changed: [],
        unchanged: [],
        warnings: [],
        errors: [lock.diagnostic],
        exitCode: 1,
        failureKind: GENERATE_LOCK_FAILURE_KIND,
      };
    }

    try {
      return await runUnlocked(options);
    } finally {
      lock.handle.release();
    }
  }

  return runUnlocked(options);
}

async function runUnlocked(options: GenerateOptions): Promise<GenerateResult> {
  const profileEnabled = isCompileProfileEnabled();
  const runStarted = profileEnabled ? performance.now() : 0;
  let fastCheckMs = 0;
  let generateCheckCache: GenerateResult["cache"] =
    options.check && !options.dryRun
      ? {
          strategy: "generated-check",
          result: "skipped",
          reason: "fast check not attempted",
        }
      : undefined;

  if (options.check && !options.dryRun) {
    const fastCheckStarted = profileEnabled ? performance.now() : 0;
    const fastCheck = runFastGenerateCheck(options.workspaceRoot);
    fastCheckMs = profileEnabled ? performance.now() - fastCheckStarted : 0;
    if (fastCheck.kind === "hit") {
      return fastCheck.result;
    }
    generateCheckCache = {
      strategy: "generated-check",
      result: "miss",
      reason: fastCheck.reason,
    };
  }

  const sessionStarted = profileEnabled ? performance.now() : 0;
  const session = getCompileSession(options.workspaceRoot);
  const sessionMs = profileEnabled ? performance.now() - sessionStarted : 0;

  const discoverStarted = profileEnabled ? performance.now() : 0;
  const ctx = discoverForSession(session);
  const manifest = loadManifestForSession(session);
  const discoverMs = profileEnabled ? performance.now() - discoverStarted : 0;

  const pkgCompiler = new PackageGraphCompiler();

  let appGraphMs = 0;
  let packageGraphMs = 0;
  const graphBuildStarted = profileEnabled ? performance.now() : 0;
  const appGraphPromise = (async () => {
    const started = profileEnabled ? performance.now() : 0;
    const graph = await buildAppGraphForSession(session);
    appGraphMs = profileEnabled ? performance.now() - started : 0;
    return graph;
  })();
  const packageGraphPromise = (async () => {
    const started = profileEnabled ? performance.now() : 0;
    const result = await pkgCompiler.build(ctx.dependencies, {
      runtimeInspect: false,
      resolutionMode: "nodenext",
      cacheDir: ctx.cacheDir,
      concurrency: options.concurrency,
      lockfileHash: ctx.lockfileHash,
    });
    packageGraphMs = profileEnabled ? performance.now() - started : 0;
    return result;
  })();
  const [appGraph, pkgResult] = await Promise.all([appGraphPromise, packageGraphPromise]);
  const graphBuildMs = profileEnabled ? performance.now() - graphBuildStarted : 0;

  const classifyStarted = profileEnabled ? performance.now() : 0;
  if (profileEnabled) {
    resetSignalProfile();
  }
  const classified = classifyPackages(pkgResult.graph);
  const classifierSignals = profileEnabled ? getSignalProfile() : undefined;
  if (profileEnabled) {
    clearSignalProfile();
  }
  const classifyMs = profileEnabled ? performance.now() - classifyStarted : 0;

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

  const runtimeMatrixStarted = profileEnabled ? performance.now() : 0;
  const matrix = buildRuntimeMatrix(classified);
  const runtimeMatrixMs = profileEnabled ? performance.now() - runtimeMatrixStarted : 0;
  const importGuardsStarted = profileEnabled ? performance.now() : 0;
  const guardDiagnostics = checkImportGuards(appGraph.moduleGraph, matrix);
  const importGuardsMs = profileEnabled ? performance.now() - importGuardsStarted : 0;
  const qualityGateStarted = profileEnabled ? performance.now() : 0;
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
  const qualityGateMs = profileEnabled ? performance.now() - qualityGateStarted : 0;

  const emitStarted = profileEnabled ? performance.now() : 0;
  const emitResult = await emit(emitPlan, {
    workspaceRoot: ctx.workspaceRoot,
    mode,
  });
  const emitMs = profileEnabled ? performance.now() - emitStarted : 0;

  const postEmitStarted = profileEnabled ? performance.now() : 0;
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
  const postEmitMs = profileEnabled ? performance.now() - postEmitStarted : 0;

  if (profileEnabled) {
    const totalMs = performance.now() - runStarted;
    const appGraphProfile = getAppGraphProfile(appGraph);
    const planProfile = getPlanProfile(emitPlan);
    const unaccountedMs = Math.max(
      0,
      totalMs -
        fastCheckMs -
        sessionMs -
        discoverMs -
        graphBuildMs -
        classifyMs -
        planMs -
        runtimeMatrixMs -
        importGuardsMs -
        qualityGateMs -
        emitMs -
        postEmitMs,
    );
    const timings = {
      fastCheckMs,
      sessionMs,
      discoverMs,
      graphBuildMs,
      appGraphMs,
      ...(appGraphProfile ? { appGraph: appGraphProfile } : {}),
      packageGraphMs,
      classifyMs,
      ...(classifierSignals ? { classifierSignals } : {}),
      planMs,
      ...(planProfile ? { planDetail: planProfile } : {}),
      runtimeMatrixMs,
      importGuardsMs,
      qualityGateMs,
      emitMs,
      postEmitMs,
      unaccountedMs,
      totalMs,
    };
    recordCompileTimings(timings);
    const fsProfile = getFileSystemProfile();
    if (shouldPrintCompileProfile()) {
      process.stderr.write(`${formatCompileTimings(timings)}\n`);
      if (fsProfile) {
        process.stderr.write(`${formatFileSystemProfile(fsProfile)}\n`);
      }
    }
  }

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
