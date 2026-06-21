import { spawnSync } from "node:child_process";
import {
  categorizeFiles,
  compactFiles,
  type CategorizedFileSummary,
  type FileListSummary,
} from "./change-summary.ts";

export interface WorkspaceGitSummary {
  available: boolean;
  branch?: string;
  commit?: string;
  changed: FileListSummary;
  staged: FileListSummary;
  unstaged: FileListSummary;
  untracked: FileListSummary;
  changeSummary: {
    changed: CategorizedFileSummary;
    staged: CategorizedFileSummary;
    unstaged: CategorizedFileSummary;
    untracked: CategorizedFileSummary;
  };
  error?: string;
}

function emptySummary(error?: string): WorkspaceGitSummary {
  return {
    available: false,
    changed: compactFiles([]),
    staged: compactFiles([]),
    unstaged: compactFiles([]),
    untracked: compactFiles([]),
    changeSummary: {
      changed: categorizeFiles([]),
      staged: categorizeFiles([]),
      unstaged: categorizeFiles([]),
      untracked: categorizeFiles([]),
    },
    ...(error ? { error } : {}),
  };
}

function runGit(args: string[], workspaceRoot: string): { ok: boolean; stdout: string; error?: string } {
  const result = spawnSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      stdout: "",
      error: (result.stderr || result.stdout || "git command failed").trim(),
    };
  }
  return { ok: true, stdout: result.stdout.trim() };
}

function parseStatusPath(line: string): string {
  const raw = line.slice(2).trimStart();
  const renamed = raw.split(" -> ");
  return (renamed[renamed.length - 1] ?? raw).replace(/\\/g, "/");
}

export function buildWorkspaceGitSummary(workspaceRoot: string): WorkspaceGitSummary {
  const root = runGit(["rev-parse", "--show-toplevel"], workspaceRoot);
  if (!root.ok) {
    return emptySummary(root.error);
  }

  const status = runGit(["status", "--porcelain=v1", "-uall"], workspaceRoot);
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], workspaceRoot);
  const commit = runGit(["rev-parse", "--short", "HEAD"], workspaceRoot);
  const lines = status.ok ? status.stdout.split(/\r?\n/).filter(Boolean) : [];
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const file = parseStatusPath(line);
    if (x === "?" && y === "?") {
      untracked.push(file);
      continue;
    }
    if (x !== " ") {
      staged.push(file);
    }
    if (y !== " ") {
      unstaged.push(file);
    }
  }

  const stagedFiles = [...new Set(staged)].sort();
  const unstagedFiles = [...new Set(unstaged)].sort();
  const untrackedFiles = [...new Set(untracked)].sort();
  const changedFiles = [...new Set([...stagedFiles, ...unstagedFiles, ...untrackedFiles])].sort();

  return {
    available: true,
    ...(branch.ok ? { branch: branch.stdout } : {}),
    ...(commit.ok ? { commit: commit.stdout } : {}),
    changed: compactFiles(changedFiles),
    staged: compactFiles(stagedFiles),
    unstaged: compactFiles(unstagedFiles),
    untracked: compactFiles(untrackedFiles),
    changeSummary: {
      changed: categorizeFiles(changedFiles),
      staged: categorizeFiles(stagedFiles),
      unstaged: categorizeFiles(unstagedFiles),
      untracked: categorizeFiles(untrackedFiles),
    },
    ...(status.ok ? {} : { error: status.error }),
  };
}
