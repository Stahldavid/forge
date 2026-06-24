import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  categorizeFiles,
  classifyChangeType,
  compactFiles,
  filterVolatileForgeState,
  type CategorizedFileSummary,
  type ChangeClassifier,
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

function runGit(
  args: string[],
  workspaceRoot: string,
  options: { trim?: boolean } = {},
): { ok: boolean; stdout: string; error?: string } {
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
  return { ok: true, stdout: options.trim === false ? result.stdout : result.stdout.trim() };
}

function pathspecLiteral(file: string): string {
  return `:(literal)${file}`;
}

function diffTouchesOnlyGeneratedMetadata(diff: string): boolean {
  let changedLines = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("@@ ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (!line.startsWith("+") && !line.startsWith("-")) {
      continue;
    }
    changedLines += 1;
    if (!line.slice(1).trimStart().startsWith("// @forge-generated")) {
      return false;
    }
  }
  return changedLines > 0;
}

function generatedLineSet(text: string): Set<number> {
  const generated = new Set<number>();
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trimStart().startsWith("// @forge-generated")) {
    generated.add(1);
  }
  let inGeneratedBlock = false;
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.includes("<!-- forge-generated:start -->")) {
      inGeneratedBlock = true;
      generated.add(lineNumber);
      return;
    }
    if (inGeneratedBlock) {
      generated.add(lineNumber);
    }
    if (line.includes("<!-- forge-generated:end -->")) {
      inGeneratedBlock = false;
    }
  });
  return generated;
}

function headFileText(workspaceRoot: string, file: string): string | null {
  const result = runGit(["show", `HEAD:${file}`], workspaceRoot, { trim: false });
  return result.ok ? result.stdout : null;
}

function worktreeFileText(workspaceRoot: string, file: string): string | null {
  try {
    return readFileSync(join(workspaceRoot, file), "utf8");
  } catch {
    return null;
  }
}

function parseHunkStart(header: string, marker: "-" | "+"): number {
  const pattern = marker === "-"
    ? /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/
    : /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  const match = header.match(pattern);
  return match ? Number(match[1]) : 1;
}

function diffTouchesOnlyGeneratedRegions(diff: string, oldText: string | null, newText: string | null): boolean {
  if (!oldText || !newText) {
    return diffTouchesOnlyGeneratedMetadata(diff);
  }
  const oldGenerated = generatedLineSet(oldText);
  const newGenerated = generatedLineSet(newText);
  if (oldGenerated.size === 0 && newGenerated.size === 0) {
    return diffTouchesOnlyGeneratedMetadata(diff);
  }

  let changedLines = 0;
  let oldLine = 1;
  let newLine = 1;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("@@ ")) {
      oldLine = parseHunkStart(line, "-");
      newLine = parseHunkStart(line, "+");
      continue;
    }
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (line.startsWith("-")) {
      changedLines += 1;
      if (!oldGenerated.has(oldLine) && !line.slice(1).trimStart().startsWith("// @forge-generated")) {
        return false;
      }
      oldLine += 1;
      continue;
    }
    if (line.startsWith("+")) {
      changedLines += 1;
      if (!newGenerated.has(newLine) && !line.slice(1).trimStart().startsWith("// @forge-generated")) {
        return false;
      }
      newLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
    }
  }
  return changedLines > 0;
}

function generatedMetadataOnlyChange(workspaceRoot: string, file: string): boolean {
  const pathspec = pathspecLiteral(file);
  const diffs = [
    runGit(["diff", "--unified=0", "--", pathspec], workspaceRoot, { trim: false }),
    runGit(["diff", "--cached", "--unified=0", "--", pathspec], workspaceRoot, { trim: false }),
  ]
    .filter((result) => result.ok)
    .map((result) => result.stdout)
    .filter((stdout) => stdout.trim().length > 0);
  const oldText = headFileText(workspaceRoot, file);
  const newText = worktreeFileText(workspaceRoot, file);
  return diffs.length > 0 && diffs.every((diff) => diffTouchesOnlyGeneratedRegions(diff, oldText, newText));
}

function workspaceChangeClassifier(workspaceRoot: string): ChangeClassifier {
  const cache = new Map<string, ReturnType<ChangeClassifier>>();
  return (file) => {
    const cached = cache.get(file);
    if (cached) {
      return cached;
    }
    const baseType = classifyChangeType(file);
    const type = baseType === "docs" && generatedMetadataOnlyChange(workspaceRoot, file)
      ? "generated"
      : baseType;
    cache.set(file, type);
    return type;
  };
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

  const status = runGit(["status", "--porcelain=v1", "-uall"], workspaceRoot, { trim: false });
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

  const stagedFiles = filterVolatileForgeState([...new Set(staged)].sort());
  const unstagedFiles = filterVolatileForgeState([...new Set(unstaged)].sort());
  const untrackedFiles = filterVolatileForgeState([...new Set(untracked)].sort());
  const changedFiles = [...new Set([...stagedFiles, ...unstagedFiles, ...untrackedFiles])].sort();
  const classify = workspaceChangeClassifier(workspaceRoot);

  return {
    available: true,
    ...(branch.ok ? { branch: branch.stdout } : {}),
    ...(commit.ok ? { commit: commit.stdout } : {}),
    changed: compactFiles(changedFiles),
    staged: compactFiles(stagedFiles),
    unstaged: compactFiles(unstagedFiles),
    untracked: compactFiles(untrackedFiles),
    changeSummary: {
      changed: categorizeFiles(changedFiles, 8, classify),
      staged: categorizeFiles(stagedFiles, 8, classify),
      unstaged: categorizeFiles(unstagedFiles, 8, classify),
      untracked: categorizeFiles(untrackedFiles, 8, classify),
    },
    ...(status.ok ? {} : { error: status.error }),
  };
}
