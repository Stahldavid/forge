import { join, relative, resolve } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
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
import { run as runGenerate } from "../orchestrator/run.ts";
import {
  buildAddCommand,
  detectAndCreatePackageManagerAdapter,
  dryRunRecipeFallbackMessage,
  type PackageManagerAdapter,
} from "../package-manager/adapter.ts";
import { parsePackageName } from "../package-manager/parse-spec.ts";
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
  mode?: "integration" | "package";
  targetKind?: "forge-integration" | "npm-package";
  target?: string;
  packageTarget?: "root" | "frontend" | "backend" | "workspace";
  packageTargetReason?: string;
  explanation?: string;
  recipeVersion?: string;
  recipePackages?: string[];
  requiredSecrets?: string[];
  optionalSecrets?: string[];
  packageSpec?: string;
  packageName?: string;
  packageManager?: string;
  installCommand?: string[];
  nativeInstallCommand?: string[];
  avoidedManualCommand?: string;
  installCwd?: string;
  installWorkspace?: string;
  changed: string[];
  unchanged: string[];
  warnings: Diagnostic[];
  errors: Diagnostic[];
  exitCode: 0 | 1;
  failureKind?: string;
}

function recipeResultMetadata(recipe: NonNullable<ReturnType<typeof resolveRecipe>>): Pick<
  ForgeAddResult,
  "recipeVersion" | "recipePackages" | "requiredSecrets" | "optionalSecrets"
> {
  return {
    recipeVersion: recipe.recipeVersion,
    recipePackages: recipe.packages.map((pkg) => pkg.packageName),
    requiredSecrets: recipe.secrets.filter((secret) => secret.required !== false).map((secret) => secret.envVar),
    optionalSecrets: recipe.secrets.filter((secret) => secret.required === false).map((secret) => secret.envVar),
  };
}

function addExplanation(result: ForgeAddResult): string {
  if (result.mode === "package") {
    const location = result.target && result.target !== "root" ? `${result.target}/package.json` : "package.json";
    const command = result.installCommand?.join(" ") ?? `package manager add ${result.packageSpec ?? result.alias}`;
    const target = result.packageTarget && result.packageTarget !== "root" ? ` (${result.packageTarget})` : "";
    return `Adds npm package '${result.packageSpec ?? result.alias}' to ${location}${target}, then refreshes Forge package evidence. Forge runs the native install command for you: ${command}.`;
  }

  if (result.failureKind === "unknown_alias") {
    return `No Forge integration recipe exists for '${result.alias}'. Use 'forge add ${result.alias}' or 'forge add package ${result.alias}' for a normal npm package, or choose a supported integration alias.`;
  }

  return `Applies the Forge integration recipe '${result.alias}', including package install, generated adapters, secret-name metadata, runtime guards, and Forge lock evidence.`;
}

function finalizeAddResult(result: Omit<ForgeAddResult, "targetKind" | "explanation">): ForgeAddResult {
  const mode = result.mode ?? "integration";
  const withMode: ForgeAddResult = {
    ...result,
    mode,
    targetKind: mode === "package" ? "npm-package" : "forge-integration",
  };
  return {
    ...withMode,
    explanation: addExplanation(withMode),
  };
}

function packageJsonRelativeFor(workspace?: string): string {
  return workspace ? `${workspace.replace(/\\/g, "/")}/package.json` : "package.json";
}

type PackageAddScope = "root" | "frontend" | "backend" | "workspace";

interface NormalizedPackageRequest {
  spec: string;
  packageTarget: PackageAddScope;
  packageTargetReason: string;
  installWorkspace?: string;
  forcePackageMode: boolean;
}

function parseScopedPackageSpec(spec: string): {
  spec: string;
  target?: "frontend" | "backend";
  forcePackageMode: boolean;
} {
  const trimmed = spec.trim();
  const match = /^(frontend|front|web|client|backend|back|server|api|root):(.+)$/i.exec(trimmed);
  if (!match) {
    return { spec: trimmed, forcePackageMode: false };
  }
  const scope = match[1]!.toLowerCase();
  return {
    spec: match[2]!.trim(),
    target: scope === "frontend" || scope === "front" || scope === "web" || scope === "client"
      ? "frontend"
      : "backend",
    forcePackageMode: true,
  };
}

function findFrontendWorkspace(workspaceRoot: string): string | undefined {
  for (const candidate of ["web", "frontend", "client", "apps/web", "packages/web"]) {
    if (nodeFileSystem.exists(join(workspaceRoot, candidate, "package.json"))) {
      return candidate;
    }
  }
  return undefined;
}

function normalizePackageRequest(
  spec: string,
  options: ForgeAddOptions,
): { request: NormalizedPackageRequest; error?: Diagnostic } {
  const scoped = parseScopedPackageSpec(spec);
  const requestedTarget = options.packageTarget ?? scoped.target;
  if (options.installWorkspace?.trim()) {
    return {
      request: {
        spec: scoped.spec,
        packageTarget: "workspace",
        packageTargetReason: `explicit --workspace ${options.installWorkspace.trim()}`,
        installWorkspace: options.installWorkspace.trim(),
        forcePackageMode: scoped.forcePackageMode,
      },
    };
  }
  if (requestedTarget === "frontend") {
    const workspace = findFrontendWorkspace(options.workspaceRoot);
    if (!workspace) {
      return {
        request: {
          spec: scoped.spec,
          packageTarget: "frontend",
          packageTargetReason: "frontend target requested, but no frontend package.json was detected",
          forcePackageMode: true,
        },
        error: createDiagnostic({
          severity: "error",
          code: "FORGE_ADD_FRONTEND_WORKSPACE_MISSING",
          message: "frontend package target requested, but no frontend package.json was found under web, frontend, client, apps/web, or packages/web",
          fixHint: "Create a frontend with forge make ui, pass --workspace <path>, or install as a backend/root package.",
          suggestedCommands: [
            "forge make ui --framework vite --dry-run --json",
            `forge add ${scoped.spec} --workspace web --dry-run --json`,
            `forge add backend:${scoped.spec} --dry-run --json`,
          ],
        }),
      };
    }
    return {
      request: {
        spec: scoped.spec,
        packageTarget: "frontend",
        packageTargetReason: `frontend target resolved to ${workspace}/package.json`,
        installWorkspace: workspace,
        forcePackageMode: true,
      },
    };
  }
  if (requestedTarget === "backend") {
    return {
      request: {
        spec: scoped.spec,
        packageTarget: "backend",
        packageTargetReason: "backend target resolves to the Forge app root package.json",
        forcePackageMode: true,
      },
    };
  }
  return {
    request: {
      spec: scoped.spec,
      packageTarget: "root",
      packageTargetReason: "default package target resolves to the Forge app root package.json",
      forcePackageMode: scoped.forcePackageMode,
    },
  };
}

function resolveInstallRoot(options: ForgeAddOptions): {
  installRoot: string;
  target: string;
  extraSnapshotPaths: string[];
  error?: Diagnostic;
} {
  const workspace = options.installWorkspace?.trim();
  if (!workspace) {
    return {
      installRoot: options.workspaceRoot,
      target: "root",
      extraSnapshotPaths: [],
    };
  }

  const workspaceRoot = resolve(options.workspaceRoot);
  const installRoot = resolve(workspaceRoot, workspace);
  const rel = relative(workspaceRoot, installRoot).replace(/\\/g, "/");
  if (rel.startsWith("..") || rel === "") {
    return {
      installRoot,
      target: workspace,
      extraSnapshotPaths: [],
      error: createDiagnostic({
        severity: "error",
        code: "FORGE_ADD_INVALID_WORKSPACE",
        message: `workspace '${workspace}' must resolve inside the Forge app`,
      }),
    };
  }

  if (!nodeFileSystem.exists(join(installRoot, "package.json"))) {
    return {
      installRoot,
      target: rel,
      extraSnapshotPaths: [],
      error: createDiagnostic({
        severity: "error",
        code: "FORGE_ADD_INVALID_WORKSPACE",
        message: `workspace '${workspace}' does not contain a package.json`,
      }),
    };
  }

  return {
    installRoot,
    target: rel,
    extraSnapshotPaths: [packageJsonRelativeFor(rel)],
  };
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
    if (nodeFileSystem.exists(pkgJsonPath)) {
      const installed = JSON.parse((nodeFileSystem.readText(pkgJsonPath) ?? "")) as {
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
  const packageRequestResult = normalizePackageRequest(alias, options);
  const packageRequest = packageRequestResult.request;
  const effectiveOptions: ForgeAddOptions = {
    ...options,
    installWorkspace: packageRequest.installWorkspace,
  };
  const packageModeRequested =
    options.mode === "package" ||
    packageRequest.forcePackageMode ||
    options.packageTarget !== undefined;
  if (packageRequestResult.error && packageModeRequested) {
    return finalizeAddResult({
      alias: packageRequest.spec,
      mode: "package",
      target: packageRequest.installWorkspace ?? packageRequest.packageTarget,
      packageTarget: packageRequest.packageTarget,
      packageTargetReason: packageRequest.packageTargetReason,
      packageSpec: packageRequest.spec,
      packageName: parsePackageName(packageRequest.spec),
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [packageRequestResult.error],
      exitCode: 1,
      failureKind: "invalid_workspace",
    });
  }
  if (options.mode === "integration" && (packageRequest.forcePackageMode || options.packageTarget)) {
    const error = createDiagnostic({
      severity: "error",
      code: "FORGE_ADD_SCOPED_INTEGRATION",
      message: "frontend/backend package targets only apply to normal npm package installs, not explicit integration recipes",
      fixHint: "Use forge add package <spec> --frontend, forge add frontend:<spec>, or remove the frontend/backend target for an integration recipe.",
      suggestedCommands: [
        `forge add package ${packageRequest.spec} --frontend --dry-run --json`,
        `forge add integration ${packageRequest.spec} --dry-run --json`,
      ],
    });
    return finalizeAddResult({
      alias: packageRequest.spec,
      mode: "integration",
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [error],
      exitCode: 1,
      failureKind: "invalid_target",
    });
  }

  const normalized = packageRequest.spec.trim().toLowerCase();
  const recipe = resolveRecipe(normalized);
  const mode = options.mode ?? "auto";

  if (packageModeRequested) {
    return forgeAddPackage(packageRequest.spec, effectiveOptions, packageRequest);
  }

  if (mode === "auto" && (!isReferenceAlias(normalized) || recipe === null)) {
    return forgeAddPackage(packageRequest.spec, effectiveOptions, packageRequest);
  }

  if (!isReferenceAlias(normalized) || recipe === null) {
    const error = createDiagnostic({
      severity: "error",
      code: "FORGE_UNKNOWN_ALIAS",
      message: `unknown integration alias '${alias}'; supported: stripe, posthog, sentry, zod, ai. For npm packages, use 'forge add package ${alias}' or 'forge add ${alias}'.`,
      suggestedCommands: [`forge add package ${alias} --dry-run --json`, "forge add --help"],
    });
    return finalizeAddResult({
      alias: normalized,
      mode: "integration",
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [error],
      exitCode: 1,
      failureKind: "unknown_alias",
    });
  }

  const pm =
    options.pmAdapter ??
    detectAndCreatePackageManagerAdapter(options.workspaceRoot);

  if (options.dryRun) {
    const ctx = discover({ workspaceRoot: effectiveOptions.workspaceRoot });
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
        effectiveOptions,
      );
      warnings.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_DRY_RUN_FALLBACK",
          message: fallback,
        }),
      );

      return finalizeAddResult({
        alias: normalized,
        mode: "integration",
        ...recipeResultMetadata(recipe),
        changed: [...emitPlan.files.map((file) => file.path), "forge.lock"],
        unchanged: [],
        warnings,
        errors,
        exitCode: errors.length > 0 ? 1 : 0,
        failureKind: failureKind(errors),
      });
    }

    const { emitPlan, warnings, errors } = await buildAddPlan(
      normalized,
      recipe,
      ctx,
      installRoot,
      effectiveOptions,
    );

    return finalizeAddResult({
      alias: normalized,
      mode: "integration",
      ...recipeResultMetadata(recipe),
      changed: [...emitPlan.files.map((file) => file.path), "forge.lock"],
      unchanged: [],
      warnings,
      errors,
      exitCode: errors.length > 0 ? 1 : 0,
      failureKind: failureKind(errors),
    });
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
      return finalizeAddResult({
        alias: normalized,
        mode: "integration",
        ...recipeResultMetadata(recipe),
        changed: [],
        unchanged: [],
        warnings,
        errors: analyzeErrors,
        exitCode: 1,
        failureKind: failureKind(analyzeErrors),
      });
    }

    const emitResult = await emit(emitPlan, {
      workspaceRoot: options.workspaceRoot,
      mode: "write",
    });

    const warningsCombined = [...warnings, ...emitResult.warnings];
    const errors = [...analyzeErrors, ...emitResult.errors];

    if (errors.length > 0) {
      restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);
      return finalizeAddResult({
        alias: normalized,
        mode: "integration",
        ...recipeResultMetadata(recipe),
        changed: [],
        unchanged: [],
        warnings: warningsCombined,
        errors,
        exitCode: 1,
        failureKind: failureKind(errors),
      });
    }

    const integrityErrors = verifyLockIntegrity(
      options.workspaceRoot,
      emitPlan.lock,
    );
    if (integrityErrors.length > 0) {
      restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);
      return finalizeAddResult({
        alias: normalized,
        mode: "integration",
        ...recipeResultMetadata(recipe),
        changed: [],
        unchanged: [],
        warnings: warningsCombined,
        errors: integrityErrors,
        exitCode: 1,
        failureKind: "lock_integrity",
      });
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

    return finalizeAddResult({
      alias: normalized,
      mode: "integration",
      ...recipeResultMetadata(recipe),
      changed: emitResult.changed,
      unchanged: emitResult.unchanged,
      warnings: warningsCombined,
      errors: [],
      exitCode: 0,
    });
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

    return finalizeAddResult({
      alias: normalized,
      mode: "integration",
      ...recipeResultMetadata(recipe),
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [diagnostic],
      exitCode: 1,
      failureKind: "install_failed",
    });
  }
}

async function forgeAddPackage(
  spec: string,
  options: ForgeAddOptions,
  request = normalizePackageRequest(spec, options).request,
): Promise<ForgeAddResult> {
  const normalized = request.spec.trim();
  const packageName = parsePackageName(normalized);
  const target = resolveInstallRoot(options);
  if (target.error) {
    return finalizeAddResult({
      alias: normalized,
      mode: "package",
      target: target.target,
      packageTarget: request.packageTarget,
      packageTargetReason: request.packageTargetReason,
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [target.error],
      exitCode: 1,
      failureKind: "invalid_workspace",
    });
  }

  const pm =
    options.pmAdapter ??
    detectAndCreatePackageManagerAdapter(options.workspaceRoot);
  const packageManagerCwd = target.installRoot;
  const semanticInstallWorkspace = target.target === "root" ? undefined : target.target;
  const installCommand = buildAddCommand(pm.name, normalized, {
    ignoreScripts: !options.allowScripts,
    workspace: undefined,
  });
  const avoidedManualCommand = installCommand.join(" ");
  const installPlan = {
    packageSpec: normalized,
    packageName,
    packageManager: pm.name,
    installCommand,
    nativeInstallCommand: installCommand,
    avoidedManualCommand,
    installCwd: packageManagerCwd.replace(/\\/g, "/"),
    packageTarget: request.packageTarget,
    packageTargetReason: request.packageTargetReason,
    ...(semanticInstallWorkspace ? { installWorkspace: semanticInstallWorkspace } : {}),
  };

  if (options.dryRun) {
    try {
      await pm.dryRunAdd(normalized, {
        cwd: packageManagerCwd,
        ignoreScripts: !options.allowScripts,
        workspace: undefined,
      });
    } catch (error) {
      const message =
        error instanceof PackageManagerCommandError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      const diagnostic = createDiagnostic({
        severity: "error",
        code: "FORGE_ADD_INSTALL_FAILED",
        message: `forge add package dry-run failed: ${message}`,
      });
      return finalizeAddResult({
        alias: normalized,
        mode: "package",
        target: target.target,
        ...installPlan,
        changed: [],
        unchanged: [],
        warnings: [],
        errors: [diagnostic],
        exitCode: 1,
        failureKind: "install_failed",
      });
    }

    return finalizeAddResult({
      alias: normalized,
      mode: "package",
      target: target.target,
      ...installPlan,
      changed: [
        packageJsonRelativeFor(target.target === "root" ? undefined : target.target),
      ],
      unchanged: [],
      warnings: [],
      errors: [],
      exitCode: 0,
    });
  }

  const snapshot = snapshotVersionControlled(
    options.workspaceRoot,
    target.extraSnapshotPaths,
  );

  try {
    await pm.add(normalized, {
      cwd: packageManagerCwd,
      ignoreScripts: !options.allowScripts,
      workspace: undefined,
    });

    const generated = await runGenerate({
      workspaceRoot: options.workspaceRoot,
      check: false,
      dryRun: false,
      json: options.json,
      concurrency: 4,
    });

    if (generated.exitCode !== 0) {
      restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);
      return finalizeAddResult({
        alias: normalized,
        mode: "package",
        target: target.target,
        ...installPlan,
        changed: [],
        unchanged: [],
        warnings: generated.warnings,
        errors: generated.errors,
        exitCode: 1,
        failureKind: generated.failureKind,
      });
    }

    return finalizeAddResult({
      alias: normalized,
      mode: "package",
      target: target.target,
      ...installPlan,
      changed: [
        packageJsonRelativeFor(target.target === "root" ? undefined : target.target),
        ...generated.changed,
      ],
      unchanged: generated.unchanged,
      warnings: generated.warnings,
      errors: generated.errors,
      exitCode: 0,
    });
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
      message: `forge add package failed: ${message}`,
    });

    return finalizeAddResult({
      alias: normalized,
      mode: "package",
      target: target.target,
      ...installPlan,
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [diagnostic],
      exitCode: 1,
      failureKind: "install_failed",
    });
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
  nodeFileSystem.mkdirp(target);
  nodeFileSystem.copy(join(fixtureRoot, ...segments), target);

  const pkgJsonPath = join(workspaceRoot, "package.json");
  const pkg = JSON.parse((nodeFileSystem.readText(pkgJsonPath) ?? "")) as {
    dependencies?: Record<string, string>;
  };
  pkg.dependencies = {
    ...pkg.dependencies,
    [packageName]: "1.0.0",
  };
  nodeFileSystem.writeText(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
