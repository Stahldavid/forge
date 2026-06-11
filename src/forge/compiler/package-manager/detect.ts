import { join } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import type { PackageManager } from "../types/runtime.ts";

/** Lockfiles checked in priority order when `packageManager` is absent. */
export const LOCKFILE_PM_MAP: readonly { file: string; pm: PackageManager }[] = [
  { file: "bun.lockb", pm: "bun" },
  { file: "bun.lock", pm: "bun" },
  { file: "pnpm-lock.yaml", pm: "pnpm" },
  { file: "yarn.lock", pm: "yarn" },
  { file: "package-lock.json", pm: "npm" },
] as const;

const PM_FROM_FIELD = /^(bun|npm|pnpm|yarn)(?:@|$)/;

export function parsePackageManagerField(value: string): PackageManager | null {
  const match = value.trim().match(PM_FROM_FIELD);
  return match ? (match[1] as PackageManager) : null;
}

export function getLockfileForPm(pm: PackageManager): string {
  switch (pm) {
    case "bun":
      return "bun.lock";
    case "npm":
      return "package-lock.json";
    case "pnpm":
      return "pnpm-lock.yaml";
    case "yarn":
      return "yarn.lock";
  }
}

/** All lockfile names that may exist for a given package manager. */
export function getLockfileCandidates(pm: PackageManager): readonly string[] {
  if (pm === "bun") {
    return ["bun.lock", "bun.lockb"];
  }
  return [getLockfileForPm(pm)];
}

export function detectPackageManagerFromLockfiles(
  workspaceRoot: string,
): PackageManager | null {
  for (const { file, pm } of LOCKFILE_PM_MAP) {
    if (nodeFileSystem.exists(join(workspaceRoot, file))) {
      return pm;
    }
  }
  return null;
}

/**
 * Detect the active package manager via `package.json#packageManager` or lockfile presence.
 * Defaults to `bun` (primary runtime per design).
 */
export function detectPackageManager(workspaceRoot: string): PackageManager {
  const pkgPath = join(workspaceRoot, "package.json");
  if (nodeFileSystem.exists(pkgPath)) {
    try {
      const pkg = JSON.parse((nodeFileSystem.readText(pkgPath) ?? "")) as {
        packageManager?: string;
      };
      if (pkg.packageManager) {
        const fromField = parsePackageManagerField(pkg.packageManager);
        if (fromField) {
          return fromField;
        }
      }
    } catch {
      // fall through to lockfile detection
    }
  }

  return detectPackageManagerFromLockfiles(workspaceRoot) ?? "bun";
}
