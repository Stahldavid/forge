import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { normalizePath } from "../compiler/primitives/paths.ts";
import {
  categorizeFiles,
  classifyChangeType,
  compactFiles,
  filterVolatileForgeState,
  type CategorizedFileSummary,
  type ChangeClassifier,
  type FileListSummary,
} from "./change-summary.ts";
import {
  diffWorkspaceBaseline,
  readWorkspaceBaseline,
  type WorkspaceBaseline,
} from "./baseline.ts";

export interface WorkspaceGitSummary {
  available: boolean;
  source?: "git" | "filesystem" | "forge-baseline";
  workspaceMode?: "git" | "nonGit";
  tracking?: "git" | "filesystem-inventory" | "forge-baseline";
  baseline?: {
    present: boolean;
    createdAt?: string;
    reason?: string;
    files?: number;
    added?: number;
    modified?: number;
    deleted?: number;
  };
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

const FALLBACK_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
]);

export function listWorkspaceFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && FALLBACK_IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const absolute = join(dir, entry.name);
      const rel = normalizePath(relative(root, absolute));
      if (!rel || rel === ".") {
        continue;
      }
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (entry.isFile()) {
        files.push(rel);
      }
    }
  };
  visit(root);
  return filterVolatileForgeState(files).sort();
}

function summarizeBaseline(
  baseline: WorkspaceBaseline,
  diff?: ReturnType<typeof diffWorkspaceBaseline>,
): WorkspaceGitSummary["baseline"] {
  return {
    present: true,
    createdAt: baseline.createdAt,
    ...(baseline.reason ? { reason: baseline.reason } : {}),
    files: Object.keys(baseline.files).length,
    ...(diff
      ? {
          added: diff.added.length,
          modified: diff.modified.length,
          deleted: diff.deleted.length,
        }
      : {}),
  };
}

function filesystemSummary(workspaceRoot: string, error?: string): WorkspaceGitSummary {
  const files = listWorkspaceFiles(workspaceRoot);
  const classify = workspaceChangeClassifier(workspaceRoot);
  const baseline = readWorkspaceBaseline(workspaceRoot);
  if (baseline) {
    const diff = diffWorkspaceBaseline({ workspaceRoot, baseline, files });
    return {
      available: false,
      source: "forge-baseline",
      workspaceMode: "nonGit",
      tracking: "forge-baseline",
      baseline: summarizeBaseline(baseline, diff),
      changed: compactFiles(diff.changed),
      staged: compactFiles([]),
      unstaged: compactFiles(diff.modified),
      untracked: compactFiles(diff.added),
      changeSummary: {
        changed: categorizeFiles(diff.changed, 8, classify),
        staged: categorizeFiles([]),
        unstaged: categorizeFiles(diff.modified, 8, classify),
        untracked: categorizeFiles(diff.added, 8, classify),
      },
      ...(error ? { error } : {}),
    };
  }
  return {
    available: false,
    source: "filesystem",
    workspaceMode: "nonGit",
    tracking: "filesystem-inventory",
    baseline: { present: false },
    changed: compactFiles(files),
    staged: compactFiles([]),
    unstaged: compactFiles([]),
    untracked: compactFiles(files),
    changeSummary: {
      changed: categorizeFiles(files, 8, classify),
      staged: categorizeFiles([]),
      unstaged: categorizeFiles([]),
      untracked: categorizeFiles(files, 8, classify),
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

export function workspaceChangeClassifier(workspaceRoot: string): ChangeClassifier {
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
    return filesystemSummary(workspaceRoot, root.error);
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
    source: "git",
    workspaceMode: "git",
    tracking: "git",
    baseline: { present: readWorkspaceBaseline(workspaceRoot) !== null },
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
