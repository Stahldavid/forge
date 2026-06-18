import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { watch, type FSWatcher } from "node:fs";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { FORGE_DEV_WATCH_FAILED } from "../compiler/diagnostics/codes.ts";
import { getSourceRoots } from "../compiler/orchestrator/discover.ts";
import { normalizePath } from "../compiler/primitives/paths.ts";
import type { DevWatchHandle } from "./types.ts";

const SKIP_PATH_SEGMENTS = ["node_modules", "_generated", ".forge"];
const DEBOUNCE_MS = 400;

export function shouldSkipWatchPath(absolutePath: string): boolean {
  const normalized = absolutePath.replace(/\\/g, "/");
  return SKIP_PATH_SEGMENTS.some((segment) =>
    normalized === segment ||
    normalized.startsWith(`${segment}/`) ||
    normalized.includes(`/${segment}/`),
  );
}

export function createDebouncedCallback(
  debounceMs: number,
  callback: (changedCount: number, changedPaths: string[]) => void | Promise<void>,
): (incrementOrPath?: number | string) => void {
  let pendingChanges = 0;
  const pendingPaths = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (incrementOrPath) => {
    if (typeof incrementOrPath === "number") {
      pendingChanges += incrementOrPath;
    } else {
      pendingChanges += 1;
    }
    if (typeof incrementOrPath === "string") {
      pendingPaths.add(incrementOrPath);
    }
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(async () => {
      const count = pendingChanges;
      const paths = [...pendingPaths].sort();
      pendingChanges = 0;
      pendingPaths.clear();
      timer = null;
      await callback(count, paths);
    }, debounceMs);
  };
}

export function startDevWatch(
  workspaceRoot: string,
  onRegenerate: (changedCount: number, changedPaths: string[]) => void | Promise<void>,
): DevWatchHandle {
  const roots = getSourceRoots(workspaceRoot);
  const watchers: FSWatcher[] = [];
  const debounced = createDebouncedCallback(DEBOUNCE_MS, onRegenerate);

  for (const root of roots) {
    const absoluteRoot = join(workspaceRoot, root);
    if (!existsSync(absoluteRoot)) {
      continue;
    }

    try {
      const watcher = watch(
        absoluteRoot,
        { recursive: true },
        (_eventType, filename) => {
          if (!filename) {
            debounced();
            return;
          }

          const absolutePath = join(absoluteRoot, filename.toString());
          const relativePath = normalizePath(relative(workspaceRoot, absolutePath));

          if (shouldSkipWatchPath(relativePath)) {
            return;
          }

          debounced(relativePath);
        },
      );

      watcher.on("error", (error) => {
        console.error(
          `[forge dev] watch error: ${createDiagnostic({
            severity: "error",
            code: FORGE_DEV_WATCH_FAILED,
            message: error.message,
          }).message}`,
        );
      });

      watchers.push(watcher);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to start file watcher";
      console.error(
        `[forge dev] watch error: ${createDiagnostic({
          severity: "error",
          code: FORGE_DEV_WATCH_FAILED,
          message,
        }).message}`,
      );
    }
  }

  return {
    stop: () => {
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
}
