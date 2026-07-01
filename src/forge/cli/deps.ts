import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { run } from "../compiler/orchestrator/run.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { PackageGraph } from "../compiler/types/package-graph.ts";
import type { ForgeLock } from "../compiler/types/lock.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import {
  FORGE_DEPS_RUNTIME_TYPE_MISMATCH,
  FORGE_DEPS_UNKNOWN_EXPORT,
} from "../compiler/diagnostics/codes.ts";
import { resolveByPackageName } from "../compiler/recipes/registry.ts";
import {
  defaultPackageMetadata,
  defaultRuntimeCompatibility,
  summarizeDependencyApi,
  traceForPackage,
} from "../compiler/package-graph/oracle.ts";
import {
  createUpgradePlan,
  listOutdatedFromFixture,
  parseUpgradeTarget,
} from "../compiler/package-upgrades/planner.ts";
import { parsePackageName } from "../compiler/package-manager/parse-spec.ts";
import {
  applyUpgradePlan,
  rollbackUpgradePlan,
} from "../compiler/package-upgrades/apply.ts";

export type DepsSubcommand =
  | "outdated"
  | "inspect"
  | "api"
  | "trace"
  | "runtime-compat"
  | "diff"
  | "upgrade-plan"
  | "upgrade-apply"
  | "upgrade-check"
  | "upgrade-rollback"
  | "risk";

export interface DepsCommandOptions {
  subcommand: DepsSubcommand;
  packageName?: string;
  symbolName?: string;
  planPath?: string;
  target?: string;
  json: boolean;
  yes: boolean;
  allowScripts: boolean;
  skipTests: boolean;
  dryRun: boolean;
  changed: boolean;
  workspaceRoot: string;
}

export interface DepsCommandResult {
  ok: boolean;
  data?: unknown;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  return JSON.parse(raw) as T;
}

function resolvePlanPathFor(
  workspaceRoot: string,
  planIdOrPath: string,
): { ok: true; path: string } | { ok: false; diagnostics: Diagnostic[] } {
  const candidates = [
    planIdOrPath,
    join(workspaceRoot, planIdOrPath),
    join(workspaceRoot, ".forge", "upgrades", planIdOrPath, "plan.json"),
  ];

  for (const candidate of candidates) {
    if (!nodeFileSystem.exists(candidate)) {
      continue;
    }
    if (!nodeFileSystem.isDirectory(candidate)) {
      return { ok: true, path: candidate };
    }
    const nestedPlan = join(candidate, "plan.json");
    if (nodeFileSystem.exists(nestedPlan) && !nodeFileSystem.isDirectory(nestedPlan)) {
      return { ok: true, path: nestedPlan };
    }
    return {
      ok: false,
      diagnostics: [{
        severity: "error",
        code: "FORGE_DEPS_TARGET_NOT_FOUND",
        message: `upgrade plan directory '${planIdOrPath}' does not contain plan.json`,
        fixHint: "Pass the plan.json file returned by forge deps upgrade-plan, or rerun upgrade-plan.",
        suggestedCommands: [
          `forge deps upgrade-apply ${nestedPlan} --json`,
          "forge deps upgrade-plan <package> --to latest --json",
        ],
      }],
    };
  }

  return {
    ok: false,
    diagnostics: [{
      severity: "error",
      code: "FORGE_DEPS_TARGET_NOT_FOUND",
      message: `upgrade plan '${planIdOrPath}' was not found`,
      fixHint: "Use the planDir or plan.json path returned by forge deps upgrade-plan.",
      suggestedCommands: [
        `forge deps upgrade-apply .forge/upgrades/${planIdOrPath}/plan.json --json`,
        "forge deps upgrade-plan <package> --to latest --json",
      ],
    }],
  };
}

function findPackage(workspaceRoot: string, packageName: string): {
  graph: PackageGraph | null;
  pkg: PackageGraph["packages"][number] | undefined;
  lock: ForgeLock | null;
} {
  const graph = readGeneratedJson<PackageGraph>(workspaceRoot, `${GENERATED_DIR}/packageGraph.json`);
  const lock = nodeFileSystem.exists(join(workspaceRoot, "forge.lock"))
    ? (JSON.parse((nodeFileSystem.readText(join(workspaceRoot, "forge.lock")) ?? "")) as ForgeLock)
    : null;
  const pkg = graph?.packages.find((candidate) =>
    candidate.name === packageName || candidate.packageName === packageName
  );
  return { graph, pkg, lock };
}

function packageMissing(packageName: string): DepsCommandResult {
  return {
    ok: false,
    diagnostics: [{
      severity: "error",
      code: "FORGE_DEPS_PACKAGE_NOT_INSTALLED",
      message: `package '${packageName}' is not present in generated packageGraph`,
      fixHint: "Run forge generate, then retry the deps command.",
      suggestedCommands: ["forge generate", `forge deps inspect ${packageName} --json`],
    }],
    exitCode: 1,
  };
}

function inspectPackage(workspaceRoot: string, packageName: string): DepsCommandResult {
  const { pkg, lock } = findPackage(workspaceRoot, packageName);
  const lockEntry = lock?.packages.find((candidate) => candidate.name === packageName);
  const recipe = resolveByPackageName(packageName);

  if (!pkg) {
    return packageMissing(packageName);
  }

  const runtimeMismatchDiagnostics = (pkg.runtimeTypeMismatches ?? []).map((mismatch) =>
    createDiagnostic({
      severity: "warning",
      code: FORGE_DEPS_RUNTIME_TYPE_MISMATCH,
      message: `${packageName} ${mismatch.entrypoint} export '${mismatch.exportName}' is ${mismatch.kind}`,
      fixHint: "Run forge deps api/trace and check package runtime inspection before relying on this export.",
      suggestedCommands: [
        `forge deps api ${packageName} ${mismatch.exportName} --json`,
        `forge deps trace ${packageName} --json`,
      ],
    }),
  );

  return {
    ok: runtimeMismatchDiagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    data: {
      package: packageName,
      version: pkg.version,
      source: pkg.source,
      integrationAlias: recipe?.alias,
      recipeVersion: recipe?.recipeVersion,
      runtimeContexts: {
        allowed: lockEntry?.runtimeContexts ?? [],
        denied: recipe?.contexts.denied ?? [],
      },
      oracle: summarizeDependencyApi(pkg),
      usedBy: {
        generatedAdapters: (recipe?.adapters ?? []).map(
          (adapter) => `src/forge/_generated/packages/${adapter}`,
        ),
      },
      secrets: (recipe?.secrets ?? []).map((secret) => secret.envVar),
    },
    diagnostics: runtimeMismatchDiagnostics,
    exitCode: 0,
  };
}

function inspectPackageApi(workspaceRoot: string, packageName: string, symbolName: string | undefined): DepsCommandResult {
  const { pkg } = findPackage(workspaceRoot, packageName);
  if (!pkg) {
    return packageMissing(packageName);
  }
  if (!symbolName) {
    return {
      ok: false,
      diagnostics: [{
        severity: "error",
        code: FORGE_DEPS_UNKNOWN_EXPORT,
        message: "symbol name is required",
        fixHint: `Use: forge deps api ${packageName} <symbol> --json`,
      }],
      exitCode: 1,
    };
  }
  const summary = summarizeDependencyApi(pkg, symbolName);
  if (summary.symbols.length === 0) {
    return {
      ok: false,
      data: summary,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_DEPS_UNKNOWN_EXPORT,
          message: `${packageName} does not expose '${symbolName}' in generated packageGraph`,
          fixHint: "Run forge deps inspect to list exports, or run forge generate if node_modules changed.",
          suggestedCommands: [`forge deps inspect ${packageName} --json`, "forge generate"],
        }),
      ],
      exitCode: 1,
    };
  }
  return {
    ok: true,
    data: summary,
    diagnostics: [],
    exitCode: 0,
  };
}

function tracePackage(workspaceRoot: string, packageName: string): DepsCommandResult {
  const { pkg } = findPackage(workspaceRoot, packageName);
  if (!pkg) {
    return packageMissing(packageName);
  }
  return {
    ok: true,
    data: {
      package: packageName,
      version: pkg.version,
      source: pkg.source,
      resolutionMode: pkg.resolutionMode,
      traces: traceForPackage(pkg),
      runtimeShapeAvailable: Boolean(pkg.runtimeShape),
      runtimeTypeMismatches: pkg.runtimeTypeMismatches ?? [],
    },
    diagnostics: [],
    exitCode: 0,
  };
}

function runtimeCompatPackage(workspaceRoot: string, packageName: string): DepsCommandResult {
  const { pkg } = findPackage(workspaceRoot, packageName);
  if (!pkg) {
    return packageMissing(packageName);
  }
  return {
    ok: true,
    data: {
      package: packageName,
      version: pkg.version,
      runtimeCompatibility: pkg.runtimeCompatibility ?? defaultRuntimeCompatibility(),
      metadata: pkg.metadata ?? defaultPackageMetadata(pkg.entrypoints.length),
      runtimeContexts: pkg.entrypoints.flatMap((entrypoint) =>
        entrypoint.exports.flatMap((exported) => exported.classification.compatible),
      ).filter((value, index, array) => array.indexOf(value) === index).sort(),
    },
    diagnostics: [],
    exitCode: 0,
  };
}

function normalizePackageInput(packageSpec: string | undefined): {
  packageName?: string;
  requestedPackageSpec?: string;
} {
  if (!packageSpec) {
    return {};
  }
  const packageName = parsePackageName(packageSpec);
  return {
    packageName,
    ...(packageName !== packageSpec ? { requestedPackageSpec: packageSpec } : {}),
  };
}

function withPackageInput(
  result: DepsCommandResult,
  packageName: string,
  requestedPackageSpec: string | undefined,
): DepsCommandResult {
  if (!requestedPackageSpec) {
    return result;
  }
  const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
    ? {
        requestedPackageSpec,
        package: packageName,
        ...(result.data as Record<string, unknown>),
      }
    : {
        requestedPackageSpec,
        package: packageName,
      };
  return {
    ...result,
    data,
    diagnostics: result.diagnostics.map((diagnostic) =>
      diagnostic.code === "FORGE_DEPS_PACKAGE_NOT_INSTALLED"
        ? {
            ...diagnostic,
            message: `${diagnostic.message} (requested spec: '${requestedPackageSpec}')`,
            fixHint: "Forge strips version/range suffixes for deps lookup. Run forge generate, then retry with the normalized package name if needed.",
          }
        : diagnostic,
    ),
  };
}

export async function runDepsCommand(options: DepsCommandOptions): Promise<DepsCommandResult> {
  if (options.subcommand === "outdated") {
    return {
      ok: true,
      data: { packages: listOutdatedFromFixture(options) },
      diagnostics: [],
      exitCode: 0,
    };
  }

  const packageInput = normalizePackageInput(options.packageName);
  const packageName = packageInput.packageName;

  if (options.subcommand === "inspect") {
    if (!packageName) {
      return missingPackage();
    }
    return withPackageInput(
      inspectPackage(options.workspaceRoot, packageName),
      packageName,
      packageInput.requestedPackageSpec,
    );
  }

  if (options.subcommand === "api") {
    if (!packageName) {
      return missingPackage();
    }
    return withPackageInput(
      inspectPackageApi(options.workspaceRoot, packageName, options.symbolName),
      packageName,
      packageInput.requestedPackageSpec,
    );
  }

  if (options.subcommand === "trace") {
    if (!packageName) {
      return missingPackage();
    }
    return withPackageInput(
      tracePackage(options.workspaceRoot, packageName),
      packageName,
      packageInput.requestedPackageSpec,
    );
  }

  if (options.subcommand === "runtime-compat") {
    if (!packageName) {
      return missingPackage();
    }
    return withPackageInput(
      runtimeCompatPackage(options.workspaceRoot, packageName),
      packageName,
      packageInput.requestedPackageSpec,
    );
  }

  if (options.subcommand === "diff" || options.subcommand === "upgrade-plan" || options.subcommand === "risk") {
    if (!packageName) {
      return missingPackage();
    }
    const planned = await createUpgradePlan({
      workspaceRoot: options.workspaceRoot,
      packageName,
      target: parseUpgradeTarget(options.target),
      writeArtifacts: options.subcommand !== "diff" && options.subcommand !== "risk",
    });

    if (!planned.plan) {
      return {
        ok: false,
        diagnostics: planned.diagnostics,
        exitCode: planned.exitCode,
      };
    }

    const data =
      options.subcommand === "diff"
        ? {
            package: planned.plan.packageName,
            from: planned.plan.from.version,
            to: planned.plan.to.version,
            apiDiff: planned.plan.apiDiff,
            fileDiffAvailable: false,
          }
        : options.subcommand === "risk"
          ? planned.plan.risk
          : {
              plan: planned.plan,
              planDir: planned.planDir,
            };

    return withPackageInput({
      ok: planned.ok,
      data,
      diagnostics: planned.diagnostics,
      exitCode: planned.exitCode,
    }, packageName, packageInput.requestedPackageSpec);
  }

  if (options.subcommand === "upgrade-apply") {
    if (!options.planPath) {
      return missingPlan();
    }
    const resolvedPlan = resolvePlanPathFor(options.workspaceRoot, options.planPath);
    if (!resolvedPlan.ok) {
      return {
        ok: false,
        diagnostics: resolvedPlan.diagnostics,
        exitCode: 1,
      };
    }
    const applied = await applyUpgradePlan({
      workspaceRoot: options.workspaceRoot,
      planPath: resolvedPlan.path,
      yes: options.yes,
      allowScripts: options.allowScripts,
      skipTests: options.skipTests,
      dryRun: options.dryRun,
    });
    return {
      ok: applied.ok,
      data: {
        applied: applied.applied,
        rolledBack: applied.rolledBack,
        reinstallCommand: applied.plan?.rollback.reinstallCommand,
        planPath: resolvedPlan.path,
      },
      diagnostics: applied.diagnostics,
      exitCode: applied.exitCode,
    };
  }

  if (options.subcommand === "upgrade-rollback") {
    if (!options.planPath) {
      return missingPlan();
    }
    const resolvedPlan = resolvePlanPathFor(options.workspaceRoot, options.planPath);
    if (!resolvedPlan.ok) {
      return {
        ok: false,
        diagnostics: resolvedPlan.diagnostics,
        exitCode: 1,
      };
    }
    const rolledBack = rollbackUpgradePlan({
      workspaceRoot: options.workspaceRoot,
      planPath: resolvedPlan.path,
    });
    return {
      ok: rolledBack.ok,
      data: {
        rolledBack: rolledBack.rolledBack,
        reinstallCommand: rolledBack.plan?.rollback.reinstallCommand,
        planPath: resolvedPlan.path,
      },
      diagnostics: rolledBack.diagnostics,
      exitCode: rolledBack.exitCode,
    };
  }

  const generated = await run({
    workspaceRoot: options.workspaceRoot,
    check: true,
    dryRun: false,
    json: options.json,
    concurrency: 4,
  });
  return {
    ok: generated.exitCode === 0,
    data: {
      changedOnly: options.changed,
      changed: generated.changed,
      unchanged: generated.unchanged,
    },
    diagnostics: [...generated.errors, ...generated.warnings],
    exitCode: generated.exitCode,
  };
}

function missingPackage(): DepsCommandResult {
  return {
    ok: false,
    diagnostics: [{
      severity: "error",
      code: "FORGE_DEPS_PACKAGE_NOT_INSTALLED",
      message: "package name is required",
    }],
    exitCode: 1,
  };
}

function missingPlan(): DepsCommandResult {
  return {
    ok: false,
    diagnostics: [{
      severity: "error",
      code: "FORGE_DEPS_TARGET_NOT_FOUND",
      message: "plan path or plan id is required",
    }],
    exitCode: 1,
  };
}

export function formatDepsJson(result: DepsCommandResult): string {
  return `${JSON.stringify(result)}\n`;
}

export function formatDepsHuman(subcommand: DepsSubcommand, result: DepsCommandResult): string {
  const diagnostics = result.diagnostics
    .map((diagnostic) => `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`)
    .join("\n");
  if (!result.ok) {
    return `deps ${subcommand} failed${diagnostics ? `\n${diagnostics}` : ""}\n`;
  }
  if (subcommand === "upgrade-plan") {
    const data = result.data as { planDir?: string; plan?: { risk?: { level?: string } } } | undefined;
    return `upgrade plan written: ${data?.planDir ?? "not written"}\nrisk: ${data?.plan?.risk?.level ?? "unknown"}\n`;
  }
  if (subcommand === "api") {
    const data = result.data as { package?: string; version?: string; symbols?: Array<{ entrypoint: string; name: string; signature: string }> } | undefined;
    const symbols = data?.symbols ?? [];
    return `deps api ${data?.package ?? ""}@${data?.version ?? ""}\n${symbols.map((symbol) => `${symbol.entrypoint} ${symbol.name}: ${symbol.signature}`).join("\n")}\n`;
  }
  if (subcommand === "trace") {
    const data = result.data as { package?: string; version?: string; traces?: Array<{ entrypoint: string; trace: Array<{ step: string; status: string; detail: string }> }> } | undefined;
    const lines = (data?.traces ?? []).flatMap((entry) => [
      `${entry.entrypoint}:`,
      ...entry.trace.map((step) => `  ${step.status} ${step.step}: ${step.detail}`),
    ]);
    return `deps trace ${data?.package ?? ""}@${data?.version ?? ""}\n${lines.join("\n")}\n`;
  }
  if (subcommand === "runtime-compat") {
    const data = result.data as { package?: string; version?: string; runtimeCompatibility?: Record<string, unknown> } | undefined;
    return `deps runtime-compat ${data?.package ?? ""}@${data?.version ?? ""}\n${JSON.stringify(data?.runtimeCompatibility ?? {}, null, 2)}\n`;
  }
  return `deps ${subcommand} ok${diagnostics ? `\n${diagnostics}` : ""}\n`;
}
