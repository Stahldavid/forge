import { readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { compareBytes } from "../primitives/compare.ts";
import { DEFAULT_PATTERN_EXPANSION_LIMIT } from "./constants.ts";

export interface DiscoveredSubpath {
  subpath: string;
  patternBacked: boolean;
}

export function discoverSubpathsFromExports(
  exportsField: unknown,
): DiscoveredSubpath[] {
  if (exportsField == null) {
    return [{ subpath: ".", patternBacked: false }];
  }

  if (typeof exportsField === "string") {
    return [{ subpath: ".", patternBacked: false }];
  }

  if (typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return [{ subpath: ".", patternBacked: false }];
  }

  const entries: DiscoveredSubpath[] = [];
  for (const key of Object.keys(exportsField as Record<string, unknown>)) {
    const normalized = key === "." ? "." : key.startsWith("./") ? key : `./${key}`;
    const patternBacked = normalized.endsWith("/*");
    entries.push({ subpath: normalized, patternBacked });
  }

  entries.sort((a, b) => compareBytes(a.subpath, b.subpath));
  return entries;
}

export function expandPatternSubpaths(
  installPath: string,
  patternSubpath: string,
  limit: number = DEFAULT_PATTERN_EXPANSION_LIMIT,
): string[] {
  if (!patternSubpath.endsWith("/*")) {
    return [patternSubpath];
  }

  const prefix = patternSubpath.slice(0, -2);
  const relativePrefix = prefix.startsWith("./") ? prefix.slice(2) : prefix;
  const baseDir = join(installPath, relativePrefix);

  let files: string[];
  try {
    files = listFilesRecursive(baseDir);
  } catch {
    return [];
  }

  const expanded: string[] = [];
  for (const file of files) {
    const rel = posix.join(prefix, file);
    expanded.push(rel.startsWith("./") ? rel : `./${rel}`);
    if (expanded.length >= limit) {
      break;
    }
  }

  expanded.sort(compareBytes);
  return expanded;
}

function listFilesRecursive(dir: string, relative = ""): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const full = join(dir, entry);
    const rel = relative ? posix.join(relative, entry) : entry;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...listFilesRecursive(full, rel));
    } else {
      files.push(rel);
    }
  }

  return files;
}
