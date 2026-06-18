import { execFileSync } from "node:child_process";

function git(workspaceRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
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
