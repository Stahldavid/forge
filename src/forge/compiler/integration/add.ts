import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddOptions } from "../types/cli.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import type { Dependency } from "../types/package-graph.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { buildAppGraph } from "../app-graph/build.ts";
import { classify } from "../classifier/classify.ts";
import { createDiagnostic } from "../diagnostics/create.ts";
import { emit } from "../emitter/emit.ts";
import {
  FORGE_LOCK_SCHEMA_VERSION,
  GENERATOR_VERSION,
} from "../emitter/constants.ts";
import { PACKAGE_ANALYZER_VERSION } from "../package-graph/constants.ts";
import { renderBody } from "../emitter/render.ts";
import { hashStable } from "../primitives/hash.ts";
import { PackageGraphCompiler } from "../package-graph/compiler.ts";
import {
  detectAndCreatePackageManagerAdapter,
  dryRunRecipeFallbackMessage,
  type PackageManagerAdapter,
} from "../package-manager/adapter.ts";
import { PackageManagerCommandError } from "../package-manager/executor.ts";
import {
  isReferenceAlias,
  resolveByPackageName,
  resolveRecipe,
} from "../recipes/registry.ts";
import { discover } from "../orchestrator/discover.ts";
import {
  loadManifest,
  saveManifest,
  updateManifestAfterWrite,
} from "../orchestrator/manifest.ts";
import { verifyLockIntegrity } from "../orchestrator/verify.ts";
import {
  buildIntegrationEmitPlan,
  loadExistingForgeLock,
} from "./plan.ts";
import {
  restoreVersionControlledSnapshot,
  snapshotVersionControlled,
} from "./snapshot.ts";

export interface ForgeAddOptions extends AddOptions {
  workspaceRoot: string;
  pmAdapter?: PackageManagerAdapter;
}

export interface ForgeAddResult {
  alias: string;
  changed: string[];
  unchanged: string[];
  warnings: Diagnostic[];
  errors: Diagnostic[];
  exitCode: 0 | 1;
  failureKind?: string;
}

function failureKind(errors: Diagnostic[]): string | undefined {
  if (errors.length === 0) {
    return undefined;
  }
  const first = errors[0];
  if (first?.code === "FORGE_UNKNOWN_ALIAS") {
    return "unknown_alias";
  }
  if (first?.code === "FORGE_ADD_INSTALL_FAILED") {
    return "install_failed";
  }
  if (errors.some((error) => error.code === "FORGE_WRITE_ERROR")) {
    return "write_failed";
  }
  if (errors.some((error) => error.code === "FORGE_LOCK_INTEGRITY")) {
    return "lock_integrity";
  }
  return "error";
}

function collectAllClassified(
  ctx: ReturnType<typeof discover>,
  cacheDir: string,
  runtimeInspect: boolean,
  sandboxBackend: ForgeAddOptions["sandboxBackend"],
): Promise<ClassifiedPackage[]> {
  const compiler = new PackageGraphCompiler();
  return Promise.all(
    ctx.dependencies.map(async (dep) => {
      const recipe = resolveByPackageName(dep.name) ?? undefined;
      const api = await compiler.analyze(dep, {
        runtimeInspect,
        sandboxBackend,
        resolutionMode: "nodenext",
        cacheDir,
        recipeVersion: recipe?.recipeVersion,
      });
      return {
        api,
        classification: classify(api, recipe),
        recipe,
      };
    }),
  );
}

function dependencyFromInstall(
  packageName: string,
  version: string,
  workspaceRoot: string,
  packageManager: Dependency["packageManager"],
  installRoot = workspaceRoot,
): Dependency {
  return {
    name: packageName,
    version,
    packageManager,
    installPath: join(installRoot, "node_modules", ...packageName.split("/")),
  };
}

async function analyzeRecipePackages(
  recipe: NonNullable<ReturnType<typeof resolveRecipe>>,
  ctx: ReturnType<typeof discover>,
  installRoot: string,
  options: ForgeAddOptions,
): Promise<{ classified: ClassifiedPackage[]; diagnostics: Diagnostic[] }> {
  const compiler = new PackageGraphCompiler();
  const classified: ClassifiedPackage[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const pkg of recipe.packages) {
    const dep = dependencyFromInstall(
      pkg.packageName,
      "0.0.0",
      ctx.workspaceRoot,
      ctx.packageManager,
      installRoot,
    );

    const pkgJsonPath = join(dep.installPath, "package.json");
    if (existsSync(pkgJsonPath)) {
      const installed = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
        version?: string;
      };
      if (installed.version) {
        dep.version = installed.version;
      }
    }

    try {
      const result = await compiler.analyze(dep, {
        runtimeInspect: options.runtimeInspect,
        sandboxBackend: options.sandboxBackend,
        resolutionMode: "nodenext",
        cacheDir: ctx.cacheDir,
        recipeVersion: recipe.recipeVersion,
      });
      classified.push({
        api: result,
        classification: classify(result, recipe),
        recipe,
      });
    } catch (error) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "FORGE_ADD_ANALYZE_FAILED",
          message: `failed to analyze ${pkg.packageName}: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    }
  }

  return { classified, diagnostics };
}

async function buildAddPlan(
  alias: string,
  recipe: NonNullable<ReturnType<typeof resolveRecipe>>,
  ctx: ReturnType<typeof discover>,
  installRoot: string,
  options: ForgeAddOptions,
): Promise<{
  emitPlan: ReturnType<typeof buildIntegrationEmitPlan>;
  warnings: Diagnostic[];
  errors: Diagnostic[];
}> {
  const manifest = loadManifest(ctx.cacheDir);
  const appGraph = await buildAppGraph({
    workspaceRoot: ctx.workspaceRoot,
    sources: ctx.sources,
    prior: manifest.priorAppGraph,
    tsconfigPath: ctx.tsconfigPath ?? undefined,
  });

  const { classified, diagnostics } = await analyzeRecipePackages(
    recipe,
    ctx,
    installRoot,
    options,
  );

  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = [
    ...appGraph.diagnostics.filter((item) => item.severity === "warning"),
    ...diagnostics.filter((item) => item.severity === "warning"),
  ];

  if (classified.length === 0) {
    errors.push(
      createDiagnostic({
        severity: "error",
        code: "FORGE_ADD_ANALYZE_FAILED",
        message: `no packages analyzed for alias '${alias}'`,
      }),
    );
    return {
      emitPlan: {
        files: [],
        orphanedFiles: [],
        lock: loadExistingForgeLock(options.workspaceRoot) ?? {
          schemaVersion: FORGE_LOCK_SCHEMA_VERSION,
          generatorVersion: GENERATOR_VERSION,
          analyzerVersion: PACKAGE_ANALYZER_VERSION,
          inputHash: ctx.inputFingerprint,
          lockfileHash: ctx.lockfileHash,
          packageManager: ctx.packageManager,
          packages: [],
        },
      },
      warnings,
      errors,
    };
  }

  const allClassified = await collectAllClassified(
    discover({ workspaceRoot: options.workspaceRoot }),
    ctx.cacheDir,
    false,
    "none",
  );

  const emitPlan = buildIntegrationEmitPlan({
    alias,
    recipe,
    classified,
    allClassified,
    appGraph,
    ctx,
    existingLock: loadExistingForgeLock(options.workspaceRoot),
  });

  return { emitPlan, warnings, errors };
}

export async function forgeAdd(
  alias: string,
  options: ForgeAddOptions,
): Promise<ForgeAddResult> {
  const normalized = alias.trim().toLowerCase();
  const recipe = resolveRecipe(normalized);

  if (!isReferenceAlias(normalized) || recipe === null) {
    const error = createDiagnostic({
      severity: "error",
      code: "FORGE_UNKNOWN_ALIAS",
      message: `unknown integration alias '${alias}'; supported: stripe, posthog, sentry, zod, ai`,
    });
    return {
      alias: normalized,
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [error],
      exitCode: 1,
      failureKind: "unknown_alias",
    };
  }

  const pm =
    options.pmAdapter ??
    detectAndCreatePackageManagerAdapter(options.workspaceRoot);

  if (options.dryRun) {
    const ctx = discover({ workspaceRoot: options.workspaceRoot });
    let installRoot = options.workspaceRoot;

    try {
      const dryRun = await pm.dryRunAddWithPath(
        recipe.packages.map((pkg) => pkg.packageName).join(" "),
        {
          cwd: options.workspaceRoot,
          ignoreScripts: !options.allowScripts,
        },
      );
      installRoot = dryRun.installPath;
    } catch {
      const fallback = dryRunRecipeFallbackMessage(normalized);
      const { emitPlan, warnings, errors } = await buildAddPlan(
        normalized,
        recipe,
        ctx,
        installRoot,
        options,
      );
      warnings.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_DRY_RUN_FALLBACK",
          message: fallback,
        }),
      );

      return {
        alias: normalized,
        changed: [...emitPlan.files.map((file) => file.path), "forge.lock"],
        unchanged: [],
        warnings,
        errors,
        exitCode: errors.length > 0 ? 1 : 0,
        failureKind: failureKind(errors),
      };
    }

    const { emitPlan, warnings, errors } = await buildAddPlan(
      normalized,
      recipe,
      ctx,
      installRoot,
      options,
    );

    return {
      alias: normalized,
      changed: [...emitPlan.files.map((file) => file.path), "forge.lock"],
      unchanged: [],
      warnings,
      errors,
      exitCode: errors.length > 0 ? 1 : 0,
      failureKind: failureKind(errors),
    };
  }

  const snapshot = snapshotVersionControlled(options.workspaceRoot);

  try {
    for (const pkg of recipe.packages) {
      await pm.add(pkg.packageName, {
        cwd: options.workspaceRoot,
        ignoreScripts: !options.allowScripts,
      });
    }

    const ctx = discover({ workspaceRoot: options.workspaceRoot });
    const { emitPlan, warnings, errors: analyzeErrors } = await buildAddPlan(
      normalized,
      recipe,
      ctx,
      options.workspaceRoot,
      options,
    );

    if (analyzeErrors.length > 0) {
      restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);
      return {
        alias: normalized,
        changed: [],
        unchanged: [],
        warnings,
        errors: analyzeErrors,
        exitCode: 1,
        failureKind: failureKind(analyzeErrors),
      };
    }

    const emitResult = await emit(emitPlan, {
      workspaceRoot: options.workspaceRoot,
      mode: "write",
    });

    const warningsCombined = [...warnings, ...emitResult.warnings];
    const errors = [...analyzeErrors, ...emitResult.errors];

    if (errors.length > 0) {
      restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);
      return {
        alias: normalized,
        changed: [],
        unchanged: [],
        warnings: warningsCombined,
        errors,
        exitCode: 1,
        failureKind: failureKind(errors),
      };
    }

    const integrityErrors = verifyLockIntegrity(
      options.workspaceRoot,
      emitPlan.lock,
    );
    if (integrityErrors.length > 0) {
      restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);
      return {
        alias: normalized,
        changed: [],
        unchanged: [],
        warnings: warningsCombined,
        errors: integrityErrors,
        exitCode: 1,
        failureKind: "lock_integrity",
      };
    }

    const manifest = loadManifest(ctx.cacheDir);
    const appGraph = await buildAppGraph({
      workspaceRoot: ctx.workspaceRoot,
      sources: ctx.sources,
      prior: manifest.priorAppGraph,
      tsconfigPath: ctx.tsconfigPath ?? undefined,
    });

    saveManifest(
      ctx.cacheDir,
      updateManifestAfterWrite(
        manifest,
        Object.fromEntries(
          emitPlan.files.map((file) => [
            file.path,
            hashStable(renderBody(file)),
          ]),
        ),
        appGraph,
        ctx.inputFingerprint,
      ),
    );

    return {
      alias: normalized,
      changed: emitResult.changed,
      unchanged: emitResult.unchanged,
      warnings: warningsCombined,
      errors: [],
      exitCode: 0,
    };
  } catch (error) {
    restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);

    const message =
      error instanceof PackageManagerCommandError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    const diagnostic = createDiagnostic({
      severity: "error",
      code: "FORGE_ADD_INSTALL_FAILED",
      message: `forge add failed: ${message}`,
    });

    return {
      alias: normalized,
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [diagnostic],
      exitCode: 1,
      failureKind: "install_failed",
    };
  }
}

/** Test helper: seed fixture packages into node_modules and update package.json. */
export function seedWorkspacePackage(
  workspaceRoot: string,
  packageName: string,
  fixtureRoot: string,
): void {
  const segments = packageName.startsWith("@")
    ? packageName.slice(1).split("/")
    : [packageName];
  const target = join(workspaceRoot, "node_modules", ...segments);
  mkdirSync(target, { recursive: true });
  cpSync(join(fixtureRoot, ...segments), target, { recursive: true, force: true });

  const pkgJsonPath = join(workspaceRoot, "package.json");
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  pkg.dependencies = {
    ...pkg.dependencies,
    [packageName]: "1.0.0",
  };
  writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}
