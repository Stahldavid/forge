import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { run } from "../compiler/orchestrator/run.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { PackageGraph } from "../compiler/types/package-graph.ts";
import type { ForgeLock } from "../compiler/types/lock.ts";
import { resolveByPackageName } from "../compiler/recipes/registry.ts";
import {
  createUpgradePlan,
  listOutdatedFromFixture,
  parseUpgradeTarget,
} from "../compiler/package-upgrades/planner.ts";
import {
  applyUpgradePlan,
  rollbackUpgradePlan,
} from "../compiler/package-upgrades/apply.ts";

export type DepsSubcommand =
  | "outdated"
  | "inspect"
  | "diff"
  | "upgrade-plan"
  | "upgrade-apply"
  | "upgrade-check"
  | "upgrade-rollback"
  | "risk";

export interface DepsCommandOptions {
  subcommand: DepsSubcommand;
  packageName?: string;
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

function planPathFor(workspaceRoot: string, planIdOrPath: string): string {
  if (nodeFileSystem.exists(planIdOrPath)) {
    return planIdOrPath;
  }
  const direct = join(workspaceRoot, planIdOrPath);
  if (nodeFileSystem.exists(direct)) {
    return direct;
  }
  return join(workspaceRoot, ".forge", "upgrades", planIdOrPath, "plan.json");
}

function inspectPackage(workspaceRoot: string, packageName: string): DepsCommandResult {
  const graph = readGeneratedJson<PackageGraph>(workspaceRoot, `${GENERATED_DIR}/packageGraph.json`);
  const lock = nodeFileSystem.exists(join(workspaceRoot, "forge.lock"))
    ? (JSON.parse((nodeFileSystem.readText(join(workspaceRoot, "forge.lock")) ?? "")) as ForgeLock)
    : null;
  const pkg = graph?.packages.find((candidate) => candidate.name === packageName);
  const lockEntry = lock?.packages.find((candidate) => candidate.name === packageName);
  const recipe = resolveByPackageName(packageName);

  if (!pkg) {
    return {
      ok: false,
      diagnostics: [{
        severity: "error",
        code: "FORGE_DEPS_PACKAGE_NOT_INSTALLED",
        message: `package '${packageName}' is not present in generated packageGraph`,
      }],
      exitCode: 1,
    };
  }

  return {
    ok: true,
    data: {
      package: packageName,
      version: pkg.version,
      integrationAlias: recipe?.alias,
      recipeVersion: recipe?.recipeVersion,
      runtimeContexts: {
        allowed: lockEntry?.runtimeContexts ?? [],
        denied: recipe?.contexts.denied ?? [],
      },
      usedBy: {
        generatedAdapters: (recipe?.adapters ?? []).map(
          (adapter) => `src/forge/_generated/packages/${adapter}`,
        ),
      },
      secrets: (recipe?.secrets ?? []).map((secret) => secret.envVar),
    },
    diagnostics: [],
    exitCode: 0,
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

  if (options.subcommand === "inspect") {
    if (!options.packageName) {
      return missingPackage();
    }
    return inspectPackage(options.workspaceRoot, options.packageName);
  }

  if (options.subcommand === "diff" || options.subcommand === "upgrade-plan" || options.subcommand === "risk") {
    if (!options.packageName) {
      return missingPackage();
    }
    const planned = await createUpgradePlan({
      workspaceRoot: options.workspaceRoot,
      packageName: options.packageName,
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

    return {
      ok: planned.ok,
      data,
      diagnostics: planned.diagnostics,
      exitCode: planned.exitCode,
    };
  }

  if (options.subcommand === "upgrade-apply") {
    if (!options.planPath) {
      return missingPlan();
    }
    const applied = await applyUpgradePlan({
      workspaceRoot: options.workspaceRoot,
      planPath: planPathFor(options.workspaceRoot, options.planPath),
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
      },
      diagnostics: applied.diagnostics,
      exitCode: applied.exitCode,
    };
  }

  if (options.subcommand === "upgrade-rollback") {
    if (!options.planPath) {
      return missingPlan();
    }
    const rolledBack = rollbackUpgradePlan({
      workspaceRoot: options.workspaceRoot,
      planPath: planPathFor(options.workspaceRoot, options.planPath),
    });
    return {
      ok: rolledBack.ok,
      data: {
        rolledBack: rolledBack.rolledBack,
        reinstallCommand: rolledBack.plan?.rollback.reinstallCommand,
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
  return `deps ${subcommand} ok${diagnostics ? `\n${diagnostics}` : ""}\n`;
}
