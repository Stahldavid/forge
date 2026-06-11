import { join, relative } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import type { SourceFile } from "../types/app-graph.ts";
import { GENERATED_DIR } from "../emitter/constants.ts";
import { hashStable } from "../primitives/hash.ts";
import { normalizePath } from "../primitives/paths.ts";

export interface SourceFileIndexEntry {
  contentHash: string;
  size: number;
  mtimeMs: number;
}

export type SourceFileIndex = Record<string, SourceFileIndexEntry>;

const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  "_generated",
  ".forge",
  "dist",
  "build",
  ".git",
]);

export interface WalkWorkspaceSourcesOptions {
  workspaceRoot: string;
  roots: string[];
  extensions?: Set<string>;
  skipDirNames?: Set<string>;
  excludeRelativePath?: (relativePath: string) => boolean;
  priorIndex?: SourceFileIndex;
  priorSourcesByPath?: Map<string, SourceFile>;
}

export interface WalkWorkspaceSourcesResult {
  sources: SourceFile[];
  index: SourceFileIndex;
}

function resolveSourceContent(
  absolutePath: string,
  relativePath: string,
  priorEntry?: SourceFileIndexEntry,
  priorSource?: SourceFile,
): { text: string; contentHash: string; size: number; mtimeMs: number } {
  const stat = nodeFileSystem.stat(absolutePath);
  if (stat === null || !stat.isFile) {
    return { text: "", contentHash: hashStable(""), size: 0, mtimeMs: 0 };
  }

  if (
    priorEntry !== undefined &&
    priorSource !== undefined &&
    priorEntry.size === stat.size &&
    priorEntry.mtimeMs === stat.mtimeMs &&
    priorEntry.contentHash === priorSource.contentHash
  ) {
    return {
      text: priorSource.text,
      contentHash: priorSource.contentHash,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }

  const text = nodeFileSystem.readText(absolutePath) ?? "";
  return {
    text,
    contentHash: hashStable(text),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

export function walkWorkspaceSources(
  options: WalkWorkspaceSourcesOptions,
): WalkWorkspaceSourcesResult {
  const workspaceRoot = options.workspaceRoot.replace(/\\/g, "/");
  const extensions = options.extensions ?? new Set([".ts", ".tsx"]);
  const skipDirNames = options.skipDirNames ?? DEFAULT_SKIP_DIRS;
  const sources: SourceFile[] = [];
  const index: SourceFileIndex = {};

  function walkDirectory(absoluteDir: string): void {
    for (const entry of nodeFileSystem.readDir(absoluteDir)) {
      const absolutePath = join(absoluteDir, entry.name);

      if (entry.isDirectory) {
        if (skipDirNames.has(entry.name)) {
          continue;
        }
        walkDirectory(absolutePath);
        continue;
      }

      if (!entry.isFile) {
        continue;
      }

      const ext = entry.name.includes(".")
        ? `.${entry.name.split(".").pop()}`
        : "";
      if (!extensions.has(ext)) {
        continue;
      }

      const relativePath = normalizePath(
        relative(workspaceRoot, absolutePath),
      );
      if (relativePath.includes(`${GENERATED_DIR}/`)) {
        continue;
      }
      if (options.excludeRelativePath?.(relativePath)) {
        continue;
      }

      const priorEntry = options.priorIndex?.[relativePath];
      const priorSource = options.priorSourcesByPath?.get(relativePath);
      const resolved = resolveSourceContent(
        absolutePath,
        relativePath,
        priorEntry,
        priorSource,
      );

      index[relativePath] = {
        contentHash: resolved.contentHash,
        size: resolved.size,
        mtimeMs: resolved.mtimeMs,
      };

      sources.push({
        path: relativePath,
        text: resolved.text,
        contentHash: resolved.contentHash,
      });
    }
  }

  for (const root of options.roots) {
    const absoluteRoot = join(workspaceRoot, root);
    if (nodeFileSystem.exists(absoluteRoot)) {
      walkDirectory(absoluteRoot);
    }
  }

  sources.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { sources, index };
}

export function filterSourcesByPattern(
  sources: SourceFile[],
  pattern: RegExp,
): SourceFile[] {
  return sources.filter((source) => pattern.test(source.path));
}
