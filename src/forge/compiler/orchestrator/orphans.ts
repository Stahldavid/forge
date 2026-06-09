import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { normalizePath } from "../primitives/paths.ts";
import { stableSortByPath } from "../primitives/sort.ts";
import { BARREL_INDEX_PATH } from "../emitter/constants.ts";

function listGeneratedFiles(
  workspaceRoot: string,
  generatedDir: string,
): string[] {
  const absoluteGenerated = join(workspaceRoot, generatedDir);
  if (!existsSync(absoluteGenerated)) {
    return [];
  }

  const files: string[] = [];

  function walk(absoluteDir: string): void {
    const entries = readdirSync(absoluteDir);
    for (const entry of entries) {
      const absolutePath = join(absoluteDir, entry);
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!stat.isFile()) {
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
