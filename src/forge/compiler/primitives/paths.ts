import { compareBytes } from "./compare.ts";

/**
 * Normalize a path to workspace-relative POSIX form with `/` separators.
 */
export function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, "/");

  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }

  normalized = normalized.replace(/\/+/g, "/");

  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function comparePaths(a: string, b: string): number {
  return compareBytes(normalizePath(a), normalizePath(b));
}
