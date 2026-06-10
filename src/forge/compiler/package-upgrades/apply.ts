import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createDiagnostic } from "../diagnostics/create.ts";
import {
  FORGE_DEPS_APPLY_FAILED,
  FORGE_DEPS_ROLLBACK_FAILED,
} from "../diagnostics/codes.ts";
import { run } from "../orchestrator/run.ts";
import {
  createPackageManagerAdapter,
  detectPackageManager,
} from "../package-manager/adapter.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import type { PackageUpgradePlan } from "./types.ts";

export interface UpgradeApplyOptions {
  workspaceRoot: string;
  planPath: string;
  yes: boolean;
  allowScripts: boolean;
  skipTests: boolean;
  dryRun: boolean;
  forceFailure?: boolean;
}

export interface UpgradeApplyResult {
  ok: boolean;
  plan: PackageUpgradePlan | null;
  diagnostics: Diagnostic[];
  applied: boolean;
  rolledBack: boolean;
  exitCode: 0 | 1;
}

function assertInside(root: string, target: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(root, target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}\\`) && !resolvedTarget.startsWith(`${resolvedRoot}/`)) {
    throw new Error(`snapshot target escapes workspace: ${target}`);
  }
  return resolvedTarget;
}

function readPlan(path: string): PackageUpgradePlan {
  return JSON.parse(readFileSync(path, "utf8")) as PackageUpgradePlan;
}

function snapshotFiles(workspaceRoot: string, plan: PackageUpgradePlan): string {
  const snapshotDir = assertInside(workspaceRoot, plan.rollback.snapshotDir);
  rmSync(snapshotDir, { recursive: true, force: true });
  mkdirSync(snapshotDir, { recursive: true });

  for (const file of plan.rollback.files) {
    const source = assertInside(workspaceRoot, file);
    if (!existsSync(source)) {
      continue;
    }
    const target = join(snapshotDir, basename(file));
    cpSync(source, target, { recursive: true, force: true });
  }

  return snapshotDir;
}

function restoreSnapshot(workspaceRoot: string, plan: PackageUpgradePlan): void {
  const snapshotDir = assertInside(workspaceRoot, plan.rollback.snapshotDir);
  for (const file of plan.rollback.files) {
    const snapshot = join(snapshotDir, basename(file));
    if (!existsSync(snapshot)) {
      continue;
    }
    const target = assertInside(workspaceRoot, file);
    rmSync(target, { recursive: true, force: true });
    cpSync(snapshot, target, { recursive: true, force: true });
  }
}

export async function applyUpgradePlan(
  options: UpgradeApplyOptions,
): Promise<UpgradeApplyResult> {
  const diagnostics: Diagnostic[] = [];
  let plan: PackageUpgradePlan | null = null;
  let applied = false;
  let rolledBack = false;

  try {
    plan = readPlan(options.planPath);
    snapshotFiles(options.workspaceRoot, plan);

    if (options.dryRun) {
      return { ok: true, plan, diagnostics, applied: false, rolledBack: false, exitCode: 0 };
    }

    if (options.forceFailure) {
      throw new Error("forced upgrade failure");
    }

    const pm = detectPackageManager(options.workspaceRoot);
    const adapter = createPackageManagerAdapter(pm);
    await adapter.add(plan.to.spec, {
      cwd: options.workspaceRoot,
      ignoreScripts: !options.allowScripts,
    });

    const generated = await run({
      workspaceRoot: options.workspaceRoot,
      check: false,
      dryRun: false,
      json: false,
      concurrency: 4,
    });
    diagnostics.push(...generated.errors, ...generated.warnings);

    if (generated.exitCode !== 0) {
      throw new Error("upgrade validation failed after install");
    }

    applied = true;
    return {
      ok: true,
      plan,
      diagnostics,
      applied,
      rolledBack,
      exitCode: 0,
    };
  } catch (error) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: FORGE_DEPS_APPLY_FAILED,
        message: error instanceof Error ? error.message : "package upgrade apply failed",
      }),
    );

    if (plan) {
      try {
        restoreSnapshot(options.workspaceRoot, plan);
        rolledBack = true;
      } catch (rollbackError) {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: FORGE_DEPS_ROLLBACK_FAILED,
            message: rollbackError instanceof Error ? rollbackError.message : "rollback failed",
          }),
        );
      }
    }

    return {
      ok: false,
      plan,
      diagnostics,
      applied,
      rolledBack,
      exitCode: 1,
    };
  }
}

export function rollbackUpgradePlan(options: {
  workspaceRoot: string;
  planPath: string;
}): UpgradeApplyResult {
  const diagnostics: Diagnostic[] = [];
  try {
    const plan = readPlan(options.planPath);
    restoreSnapshot(options.workspaceRoot, plan);
    return {
      ok: true,
      plan,
      diagnostics,
      applied: false,
      rolledBack: true,
      exitCode: 0,
    };
  } catch (error) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: FORGE_DEPS_ROLLBACK_FAILED,
        message: error instanceof Error ? error.message : "rollback failed",
      }),
    );
    return {
      ok: false,
      plan: null,
      diagnostics,
      applied: false,
      rolledBack: false,
      exitCode: 1,
    };
  }
}
