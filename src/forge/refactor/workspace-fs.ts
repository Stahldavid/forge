/**
 * Workspace-scoped filesystem helpers for the refactor engine.
 *
 * Extracted from the former `refactor/index.ts` god file. All disk access goes
 * through the injectable {@link FileSystem} abstraction (defaulting to the real
 * {@link nodeFileSystem}), so refactor logic can be unit-tested against an
 * in-memory backend. Every path is resolved relative to `workspaceRoot` and is
 * refused if it escapes the workspace.
 */
import { extname, join, normalize, relative, resolve } from "node:path";
import { hashStable } from "../compiler/primitives/hash.ts";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import type { DirEntry, FileSystem } from "../compiler/fs/index.ts";
import type { PlannedFile, PlannedPatch } from "../make/types.ts";

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".json", ".md"]);

/** Resolve `file` under `workspaceRoot`, refusing paths that escape it. */
export function absPath(workspaceRoot: string, file: string): string {
  const root = resolve(workspaceRoot);
  const absolute = resolve(root, normalize(file));
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    throw new Error(`refusing to access outside workspace: ${file}`);
  }
  return absolute;
}

/** Normalise a workspace-relative path to forward slashes without leading `/`. */
export function normalizeRel(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Whether a path points into the generated tree (never patched by refactors). */
export function isGenerated(file: string): boolean {
  return normalizeRel(file).startsWith("src/forge/_generated/");
}

/** Read a workspace file, or `null` when it does not exist. */
export function readText(
  workspaceRoot: string,
  file: string,
  fs: FileSystem = nodeFileSystem,
): string | null {
  return fs.readText(absPath(workspaceRoot, file));
}

/** Write a workspace file, creating parent directories as needed. */
export function writeText(
  workspaceRoot: string,
  file: string,
  content: string,
  fs: FileSystem = nodeFileSystem,
): void {
  fs.writeText(absPath(workspaceRoot, file), content);
}

/** Remove a workspace file (best-effort; missing paths are ignored). */
export function removeFile(
  workspaceRoot: string,
  file: string,
  fs: FileSystem = nodeFileSystem,
): void {
  fs.remove(absPath(workspaceRoot, file));
}

/** List immediate directory entries of a workspace-relative directory. */
export function readDirEntries(
  workspaceRoot: string,
  dir: string,
  fs: FileSystem = nodeFileSystem,
): DirEntry[] {
  return fs.readDir(absPath(workspaceRoot, dir));
}

/** Recursively list supported source files, skipping caches and generated output. */
export function walkFiles(
  workspaceRoot: string,
  dir = ".",
  fs: FileSystem = nodeFileSystem,
): string[] {
  const absolute = absPath(workspaceRoot, dir);
  if (!fs.exists(absolute)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of fs.readDir(absolute)) {
    const rel = normalizeRel(join(dir, entry.name));
    if (
      entry.name === "node_modules" ||
      rel.startsWith(".forge/cache") ||
      rel.startsWith(".forge/refactors") ||
      rel.startsWith(".forge/features/plans") ||
      rel.startsWith("src/forge/_generated")
    ) {
      continue;
    }
    if (entry.isDirectory) {
      files.push(...walkFiles(workspaceRoot, rel, fs));
    } else if (SUPPORTED_EXTENSIONS.has(extname(entry.name))) {
      files.push(rel);
    }
  }
  return files.sort();
}

/** Build a `PlannedFile`, recording whether the target already exists. */
export function makeFile(
  workspaceRoot: string,
  file: string,
  description: string,
  content: string,
  fs: FileSystem = nodeFileSystem,
): PlannedFile {
  return {
    file,
    description,
    content,
    exists: fs.exists(absPath(workspaceRoot, file)),
  };
}

/**
 * Build a `PlannedPatch` by reading a file and applying `transform`. Returns
 * `null` for generated files, missing files, or no-op transforms.
 */
export function patchFile(
  workspaceRoot: string,
  file: string,
  description: string,
  transform: (content: string) => string,
  fs: FileSystem = nodeFileSystem,
): PlannedPatch | null {
  if (isGenerated(file)) {
    return null;
  }
  const before = readText(workspaceRoot, file, fs);
  if (before === null) {
    return null;
  }
  const after = transform(before);
  if (after === before) {
    return null;
  }
  return {
    file,
    kind: "replace-section",
    description,
    beforeHash: hashStable(before),
    afterPreview: after,
  };
}

/** Build a `PlannedPatch` from explicit before/after content. */
export function makePatchFromContent(
  file: string,
  description: string,
  before: string,
  after: string,
): PlannedPatch | null {
  if (before === after) {
    return null;
  }
  return {
    file,
    kind: "replace-section",
    description,
    beforeHash: hashStable(before),
    afterPreview: after,
  };
}
