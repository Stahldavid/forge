import { join } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import { createDiagnostic } from "../diagnostics/create.ts";
import {
  FORGE_DEPS_PACKAGE_NOT_INSTALLED,
  FORGE_DEPS_TARGET_ANALYSIS_FAILED,
  FORGE_DEPS_TARGET_NOT_FOUND,
} from "../diagnostics/codes.ts";
import { GENERATED_DIR, GENERATOR_VERSION } from "../emitter/constants.ts";
import {
  createPackageManagerAdapter,
  detectPackageManager,
} from "../package-manager/adapter.ts";
import { PackageGraphCompiler } from "../package-graph/compiler.ts";
import { stripDeterministicHeader } from "../primitives/header.ts";
import { serializeCanonical } from "../primitives/serialize.ts";
import { resolveByPackageName } from "../recipes/registry.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import type { PackageApi, PackageGraph } from "../types/package-graph.ts";
import type { RuntimeGraph } from "../types/runtime-graph.ts";
import type { QueryRegistry } from "../types/query-registry.ts";
import type { LiveQueryRegistry } from "../types/live-query-registry.ts";
import type { WorkflowRegistry } from "../types/workflow-registry.ts";
import type { PackageManager } from "../types/runtime.ts";
import { classify } from "../classifier/classify.ts";
import { comparePackageApi, compareRuntime } from "./comparator.ts";
import { analyzeUpgradeImpact } from "./impact.ts";
import { renderUpgradePlanMarkdown } from "./markdown.ts";
import { buildRiskReport, recommendedCommands, semverBump } from "./risk.ts";
import type {
  PackageUpgradePlan,
  PackageVersionInfo,
  UpgradeTarget,
} from "./types.ts";

export interface UpgradePlannerOptions {
  workspaceRoot: string;
  packageName: string;
  target: UpgradeTarget;
  registryDir?: string;
  writeArtifacts?: boolean;
}

export interface UpgradePlannerResult {
  ok: boolean;
  plan?: PackageUpgradePlan;
  planDir?: string;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface OutdatedPackage {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  type: "dependency" | "devDependency";
  managedByRecipe: boolean;
  recipe?: string;
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  return JSON.parse(raw) as T;
}

function packageKey(packageName: string): string {
  return packageName.replace(/\//g, "__");
}

function parseTarget(raw: string | undefined): UpgradeTarget {
  const value = raw ?? "latest";
  if (value === "patch" || value === "minor" || value === "major") {
    return { kind: "semver-bump", bump: value };
  }
  if (value === "wanted") {
    return { kind: "wanted" };
  }
  if (value.startsWith("range:")) {
    return { kind: "range", range: value.slice("range:".length) };
  }
  if (/^\d+\.\d+\.\d+/.test(value)) {
    return { kind: "version", version: value };
  }
  return { kind: "dist-tag", tag: value };
}

export { parseTarget as parseUpgradeTarget };

function readPackageJson(workspaceRoot: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  return JSON.parse((nodeFileSystem.readText(join(workspaceRoot, "package.json")) ?? "")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

type DependencyType = "dependency" | "devDependency";

interface NpmAliasSpec {
  packageName: string;
  versionOrRange?: string;
}

interface PackageResolution {
  requestedName: string;
  packageName: string;
  dependencyName: string;
  dependencySpec?: string;
  dependencyType: DependencyType;
  isNpmAlias: boolean;
  current: PackageApi;
}

function parseNpmAliasSpec(spec: string): NpmAliasSpec | null {
  if (!spec.startsWith("npm:")) {
    return null;
  }
  const target = spec.slice("npm:".length);
  if (!target) {
    return null;
  }
  const separator =
    target.startsWith("@")
      ? target.indexOf("@", target.indexOf("/") + 1)
      : target.indexOf("@");
  if (separator === -1) {
    return { packageName: target };
  }
  return {
    packageName: target.slice(0, separator),
    versionOrRange: target.slice(separator + 1),
  };
}

function dependencyEntries(
  pkg: ReturnType<typeof readPackageJson>,
): Array<{ type: DependencyType; name: string; spec: string }> {
  return [
    ...Object.entries(pkg.dependencies ?? {}).map(([name, spec]) => ({
      type: "dependency" as const,
      name,
      spec,
    })),
    ...Object.entries(pkg.devDependencies ?? {}).map(([name, spec]) => ({
      type: "devDependency" as const,
      name,
      spec,
    })),
  ];
}

function dependencyType(workspaceRoot: string, packageName: string): DependencyType {
  const pkg = readPackageJson(workspaceRoot);
  if (packageName in (pkg.devDependencies ?? {})) {
    return "devDependency";
  }
  return "dependency";
}

function resolvePackageForUpgrade(workspaceRoot: string, requestedName: string): PackageResolution | null {
  const graph = readGeneratedJson<PackageGraph>(workspaceRoot, `${GENERATED_DIR}/packageGraph.json`);
  if (!graph) {
    return null;
  }
  const pkg = readPackageJson(workspaceRoot);
  const entries = dependencyEntries(pkg);

  const aliasEntry = entries.find((entry) => {
    const alias = parseNpmAliasSpec(entry.spec);
    return entry.name === requestedName || alias?.packageName === requestedName;
  });
  if (aliasEntry) {
    const alias = parseNpmAliasSpec(aliasEntry.spec);
    const packageName = alias?.packageName ?? aliasEntry.name;
    const current = graph.packages.find((candidate) => candidate.name === packageName);
    if (current) {
      return {
        requestedName,
        packageName,
        dependencyName: aliasEntry.name,
        dependencySpec: aliasEntry.spec,
        dependencyType: aliasEntry.type,
        isNpmAlias: Boolean(alias),
        current,
      };
    }
  }

  const current = graph.packages.find((candidate) => candidate.name === requestedName);
  if (!current) {
    return null;
  }
  const directEntry = entries.find((entry) => entry.name === requestedName);
  return {
    requestedName,
    packageName: requestedName,
    dependencyName: requestedName,
    dependencySpec: directEntry?.spec,
    dependencyType: directEntry?.type ?? dependencyType(workspaceRoot, requestedName),
    isNpmAlias: false,
    current,
  };
}

function packageSpecForDependency(
  resolution: Pick<PackageResolution, "packageName" | "dependencyName" | "isNpmAlias">,
  version: string,
): string {
  if (resolution.isNpmAlias) {
    return `${resolution.dependencyName}@npm:${resolution.packageName}@${version}`;
  }
  return `${resolution.packageName}@${version}`;
}

function fixtureMetadata(registryDir: string | undefined, packageName: string): {
  name: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, unknown>;
  time?: Record<string, string>;
} | null {
  if (!registryDir) {
    return null;
  }
  const path = join(registryDir, packageKey(packageName), "metadata.json");
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  return JSON.parse((nodeFileSystem.readText(path) ?? "")) as {
    name: string;
    "dist-tags"?: Record<string, string>;
    versions?: Record<string, unknown>;
    time?: Record<string, string>;
  };
}

function sortedVersions(metadata: { versions?: Record<string, unknown> }): string[] {
  return Object.keys(metadata.versions ?? {}).sort(compareVersions);
}

function compareVersions(a: string, b: string): number {
  const parsedA = a.split(/[.-]/).map((part) => Number(part) || 0);
  const parsedB = b.split(/[.-]/).map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(parsedA.length, parsedB.length); index++) {
    const delta = (parsedA[index] ?? 0) - (parsedB[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return a.localeCompare(b);
}

function resolveFromFixture(input: {
  registryDir: string;
  packageName: string;
  currentVersion: string;
  target: UpgradeTarget;
}): PackageVersionInfo | null {
  const metadata = fixtureMetadata(input.registryDir, input.packageName);
  if (!metadata) {
    return null;
  }
  const versions = sortedVersions(metadata);
  let version: string | undefined;

  if (input.target.kind === "version") {
    version = input.target.version;
  } else if (input.target.kind === "dist-tag") {
    version = metadata["dist-tags"]?.[input.target.tag];
  } else if (input.target.kind === "semver-bump") {
    const [major, minor] = input.currentVersion.split(".").map((part) => Number(part));
    version = versions
      .filter((candidate) => {
        const [nextMajor, nextMinor] = candidate.split(".").map((part) => Number(part));
        if (input.target.kind !== "semver-bump") {
          return false;
        }
        if (input.target.bump === "patch") {
          return nextMajor === major && nextMinor === minor && compareVersions(candidate, input.currentVersion) > 0;
        }
        if (input.target.bump === "minor") {
          return nextMajor === major && compareVersions(candidate, input.currentVersion) > 0;
        }
        return compareVersions(candidate, input.currentVersion) > 0;
      })
      .at(-1);
  } else if (input.target.kind === "wanted") {
    version = metadata["dist-tags"]?.latest ?? versions.at(-1);
  } else {
    const range = input.target.kind === "range" ? input.target.range : "";
    version = versions.find((candidate) => candidate.startsWith(range.replace(/^[^\d]*/, "")));
  }

  if (!version || !metadata.versions?.[version]) {
    return null;
  }

  return {
    version,
    spec: `${input.packageName}@${version}`,
    ...(input.target.kind === "dist-tag" ? { distTag: input.target.tag } : {}),
    ...(metadata.time?.[version] ? { publishedAt: metadata.time[version] } : {}),
  };
}

async function analyzeTargetPackage(input: {
  workspaceRoot: string;
  packageName: string;
  versionInfo: PackageVersionInfo;
  packageManager: PackageManager;
  registryDir?: string;
}): Promise<{ api: PackageApi | null; diagnostics: Diagnostic[] }> {
  const compiler = new PackageGraphCompiler();
  const recipe = resolveByPackageName(input.packageName) ?? undefined;
  const fixturePath = input.registryDir
    ? join(input.registryDir, packageKey(input.packageName), input.versionInfo.version)
    : null;

  if (fixturePath && nodeFileSystem.exists(join(fixturePath, "package.json"))) {
    const api = await compiler.analyze(
      {
        name: input.packageName,
        version: input.versionInfo.version,
        packageManager: input.packageManager,
        installPath: fixturePath.replace(/\\/g, "/"),
      },
      {
        runtimeInspect: false,
        resolutionMode: "nodenext",
        cacheDir: join(input.workspaceRoot, ".forge", "cache"),
        recipeVersion: recipe?.recipeVersion,
      },
    );
    return { api, diagnostics: [] };
  }

  const adapter = createPackageManagerAdapter(input.packageManager);
  let tempDir: string | null = null;
  try {
    const dryRun = await adapter.dryRunAddWithPath(input.versionInfo.spec, {
      cwd: input.workspaceRoot,
      ignoreScripts: true,
    });
    tempDir = dryRun.installPath;
    const installPath = join(tempDir, "node_modules", input.packageName);
    const api = await compiler.analyze(
      {
        name: input.packageName,
        version: dryRun.resolvedVersion,
        packageManager: input.packageManager,
        installPath: installPath.replace(/\\/g, "/"),
      },
      {
        runtimeInspect: false,
        resolutionMode: "nodenext",
        cacheDir: join(input.workspaceRoot, ".forge", "cache"),
        recipeVersion: recipe?.recipeVersion,
      },
    );
    return { api, diagnostics: [] };
  } catch (error) {
    return {
      api: null,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_DEPS_TARGET_ANALYSIS_FAILED,
          message: error instanceof Error ? error.message : "target package analysis failed",
        }),
      ],
    };
  } finally {
    if (tempDir) {
      nodeFileSystem.remove(tempDir);
    }
  }
}

async function resolveTargetVersion(input: {
  workspaceRoot: string;
  packageName: string;
  currentVersion: string;
  target: UpgradeTarget;
  registryDir?: string;
}): Promise<PackageVersionInfo | null> {
  if (input.registryDir) {
    const fixture = resolveFromFixture({
      registryDir: input.registryDir,
      packageName: input.packageName,
      currentVersion: input.currentVersion,
      target: input.target,
    });
    if (fixture) {
      return fixture;
    }
  }

  if (input.target.kind === "version") {
    return {
      version: input.target.version,
      spec: `${input.packageName}@${input.target.version}`,
    };
  }
  if (input.target.kind === "dist-tag") {
    return {
      version: input.target.tag,
      spec: `${input.packageName}@${input.target.tag}`,
      distTag: input.target.tag,
    };
  }
  return null;
}

function packagePlanDir(workspaceRoot: string, packageName: string, from: string, to: string): string {
  return join(workspaceRoot, ".forge", "upgrades", `${packageKey(packageName)}-${from}-to-${to}`);
}

function rollbackFiles(packageManager: PackageManager): string[] {
  const lockfile =
    packageManager === "bun"
      ? "bun.lock"
      : packageManager === "npm"
        ? "package-lock.json"
        : packageManager === "pnpm"
          ? "pnpm-lock.yaml"
          : "yarn.lock";
  return ["package.json", lockfile, "forge.lock", GENERATED_DIR];
}

function reinstallCommand(packageManager: PackageManager): string {
  return packageManager === "npm" ? "npm install" : `${packageManager} install`;
}

function writePlanArtifacts(plan: PackageUpgradePlan, planDir: string): void {
  nodeFileSystem.mkdirp(planDir);
  nodeFileSystem.writeText(join(planDir, "plan.json"), serializeCanonical(plan));
  nodeFileSystem.writeText(join(planDir, "plan.md"), renderUpgradePlanMarkdown(plan));
  nodeFileSystem.writeText(join(planDir, "package-api-diff.json"), serializeCanonical(plan.apiDiff));
  nodeFileSystem.writeText(join(planDir, "affected-symbols.json"), serializeCanonical(plan.affected));
  nodeFileSystem.writeText(join(planDir, "test-plan.json"), serializeCanonical(plan.testPlan));
  nodeFileSystem.writeText(join(planDir, "rollback.json"), serializeCanonical(plan.rollback));
}

export async function createUpgradePlan(
  options: UpgradePlannerOptions,
): Promise<UpgradePlannerResult> {
  const diagnostics: Diagnostic[] = [];
  const packageManager = detectPackageManager(options.workspaceRoot);
  const resolution = resolvePackageForUpgrade(options.workspaceRoot, options.packageName);

  if (!resolution) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_DEPS_PACKAGE_NOT_INSTALLED,
          message: `package '${options.packageName}' is not present in ${GENERATED_DIR}/packageGraph.json; run forge generate first`,
        }),
      ],
      exitCode: 1,
    };
  }
  const current = resolution.current;

  const targetInfo = await resolveTargetVersion({
    workspaceRoot: options.workspaceRoot,
    packageName: resolution.packageName,
    currentVersion: current.version,
    target: options.target,
    registryDir: options.registryDir ?? process.env.FORGE_DEPS_REGISTRY_DIR,
  });

  if (!targetInfo) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_DEPS_TARGET_NOT_FOUND,
          message: `could not resolve target for '${options.packageName}'`,
        }),
      ],
      exitCode: 1,
    };
  }

  const analyzed = await analyzeTargetPackage({
    workspaceRoot: options.workspaceRoot,
    packageName: resolution.packageName,
    versionInfo: targetInfo,
    packageManager,
    registryDir: options.registryDir ?? process.env.FORGE_DEPS_REGISTRY_DIR,
  });
  diagnostics.push(...analyzed.diagnostics);
  if (!analyzed.api) {
    return { ok: false, diagnostics, exitCode: 1 };
  }

  const recipe = resolveByPackageName(resolution.packageName) ?? undefined;
  const currentClassified = { api: current, classification: classify(current, recipe), recipe };
  const targetClassified = {
    api: analyzed.api,
    classification: classify(analyzed.api, recipe),
    recipe,
  };
  const apiDiff = comparePackageApi(current, analyzed.api);
  const runtimeDiff = compareRuntime(currentClassified, targetClassified);
  const appGraph = readGeneratedJson<AppGraph>(options.workspaceRoot, `${GENERATED_DIR}/appGraph.json`);
  const runtimeGraph = readGeneratedJson<RuntimeGraph>(options.workspaceRoot, `${GENERATED_DIR}/runtimeGraph.json`);
  const queryRegistry = readGeneratedJson<QueryRegistry>(options.workspaceRoot, `${GENERATED_DIR}/queryRegistry.json`);
  const liveQueryRegistry = readGeneratedJson<LiveQueryRegistry>(options.workspaceRoot, `${GENERATED_DIR}/liveQueryRegistry.json`);
  const workflowRegistry = readGeneratedJson<WorkflowRegistry>(options.workspaceRoot, `${GENERATED_DIR}/workflowRegistry.json`);

  if (!appGraph || !runtimeGraph || !queryRegistry || !liveQueryRegistry || !workflowRegistry) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: FORGE_DEPS_TARGET_ANALYSIS_FAILED,
        message: "missing generated app/runtime registries; run forge generate first",
      }),
    );
    return { ok: false, diagnostics, exitCode: 1 };
  }

  const affected = analyzeUpgradeImpact({
    packageName: resolution.packageName,
    appGraph,
    runtimeGraph,
    queryRegistry,
    liveQueryRegistry,
    workflowRegistry,
    apiDiff,
  });
  const bump = semverBump(current.version, analyzed.api.version);
  const risk = buildRiskReport({ bump, apiDiff, runtimeDiff, affected });
  const commands = recommendedCommands(affected);
  const toInfo = {
    ...targetInfo,
    version: analyzed.api.version,
    spec: packageSpecForDependency(resolution, analyzed.api.version),
  };
  const planDir = packagePlanDir(
    options.workspaceRoot,
    resolution.dependencyName,
    current.version,
    analyzed.api.version,
  );
  const id = `${packageKey(resolution.dependencyName)}-${current.version}-to-${analyzed.api.version}`;
  const plan: PackageUpgradePlan = {
    schemaVersion: "0.1.0",
    plannerVersion: GENERATOR_VERSION,
    id,
    packageName: resolution.packageName,
    ...(resolution.requestedName !== resolution.packageName
      ? { requestedPackageName: resolution.requestedName }
      : {}),
    ...(resolution.isNpmAlias ? { dependencyAlias: resolution.dependencyName } : {}),
    ...(recipe?.alias ? { integrationAlias: recipe.alias } : {}),
    from: {
      version: current.version,
      spec: resolution.isNpmAlias
        ? packageSpecForDependency(resolution, current.version)
        : `${resolution.packageName}@${current.version}`,
    },
    to: toInfo,
    packageManager,
    semver: {
      bump,
      rangeChangeRequired: bump === "major" || options.target.kind === "range",
    },
    apiDiff,
    runtimeDiff,
    affected,
    risk,
    security: {
      enabled: false,
      fixed: [],
      introduced: [],
      diagnostics: [],
    },
    generatedChanges: affected.generatedAdapters.map((file) => ({
      file,
      reason: "integration adapter belongs to the upgraded package recipe",
    })),
    recommendedCommands: commands,
    testPlan: {
      commands,
      tests: affected.tests,
      manualChecks: risk.level === "high" || risk.level === "critical"
        ? ["Inspect affected files before applying.", "Review package changelog for migration notes."]
        : [],
    },
    rollback: {
      id,
      snapshotDir: join(planDir, "lock-snapshot").replace(/\\/g, "/"),
      files: rollbackFiles(packageManager),
      reinstallCommand: reinstallCommand(packageManager),
    },
    diagnostics,
  };

  if (options.writeArtifacts ?? true) {
    writePlanArtifacts(plan, planDir);
  }

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    plan,
    planDir: planDir.replace(/\\/g, "/"),
    diagnostics,
    exitCode: diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 1 : 0,
  };
}

export function listOutdatedFromFixture(options: {
  workspaceRoot: string;
  registryDir?: string;
}): OutdatedPackage[] {
  const registryDir = options.registryDir ?? process.env.FORGE_DEPS_REGISTRY_DIR;
  const graph = readGeneratedJson<PackageGraph>(options.workspaceRoot, `${GENERATED_DIR}/packageGraph.json`);
  if (!graph || !registryDir) {
    return [];
  }

  return graph.packages
    .flatMap((pkg) => {
      const metadata = fixtureMetadata(registryDir, pkg.name);
      const latest = metadata?.["dist-tags"]?.latest;
      if (!latest || latest === pkg.version) {
        return [];
      }
      const recipe = resolveByPackageName(pkg.name);
      return [{
        name: pkg.name,
        current: pkg.version,
        wanted: latest,
        latest,
        type: dependencyType(options.workspaceRoot, pkg.name),
        managedByRecipe: Boolean(recipe),
        ...(recipe?.alias ? { recipe: recipe.alias } : {}),
      }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
