import { join, relative } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import { normalizePath } from "../primitives/paths.ts";
import { stableSortByPath } from "../primitives/sort.ts";
import { BARREL_INDEX_PATH } from "../emitter/constants.ts";

function listGeneratedFiles(
  workspaceRoot: string,
  generatedDir: string,
): string[] {
  const absoluteGenerated = join(workspaceRoot, generatedDir);
  if (!nodeFileSystem.exists(absoluteGenerated)) {
    return [];
  }

  const files: string[] = [];

  function walk(absoluteDir: string): void {
    for (const entry of nodeFileSystem.readDir(absoluteDir)) {
      const absolutePath = join(absoluteDir, entry.name);
      if (entry.isDirectory) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile) {
        continue;
      }
      files.push(
        normalizePath(relative(workspaceRoot, absolutePath)),
      );
    }
  }

  walk(absoluteGenerated);
  return stableSortByPath(files);
}

export function detectOrphanedGeneratedFiles(
  workspaceRoot: string,
  generatedDir: string,
  plannedPaths: ReadonlySet<string>,
): string[] {
  const existing = listGeneratedFiles(workspaceRoot, generatedDir);
  const orphans = existing.filter((path) => {
    if (path === BARREL_INDEX_PATH) {
      return false;
    }
    return !plannedPaths.has(path);
  });
  return stableSortByPath(orphans);
}
