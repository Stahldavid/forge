import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function hasGitMetadata(workspaceRoot: string): boolean {
  if (process.env.GIT_DIR) return true;
  let directory = resolve(workspaceRoot);
  while (true) {
    if (existsSync(join(directory, ".git"))) return true;
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

function git(workspaceRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export interface DeltaGitSnapshot {
  branch?: string;
  head?: string;
  dirty?: boolean;
  changedPaths?: string[];
  changedPathCount?: number;
  changedPathsTruncated?: boolean;
}

export function readDeltaGitSnapshot(workspaceRoot: string): DeltaGitSnapshot {
  if (!hasGitMetadata(workspaceRoot)) {
    return {
      branch: undefined,
      head: undefined,
      dirty: false,
      changedPaths: [],
      changedPathCount: 0,
      changedPathsTruncated: false,
    };
  }
  const branch = git(workspaceRoot, ["branch", "--show-current"]) ?? undefined;
  const head = git(workspaceRoot, ["rev-parse", "--short=12", "HEAD"]) ?? undefined;
  const status = git(workspaceRoot, ["status", "--porcelain"]);
  const allChangedPaths = status
    ? status
        .split(/\r?\n/)
        .map((line) => line.slice(3).trim())
        .filter(Boolean)
    : [];
  const changedPaths = allChangedPaths.slice(0, 50);
  return {
    branch,
    head,
    dirty: allChangedPaths.length > 0,
    changedPaths,
    changedPathCount: allChangedPaths.length,
    changedPathsTruncated: allChangedPaths.length > changedPaths.length,
  };
}
