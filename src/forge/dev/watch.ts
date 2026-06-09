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
    normalized.includes(`/${segment}/`),
  );
}

export function createDebouncedCallback(
  debounceMs: number,
  callback: (changedCount: number) => void | Promise<void>,
): (increment?: number) => void {
  let pendingChanges = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (increment = 1) => {
    pendingChanges += increment;
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(async () => {
      const count = pendingChanges;
      pendingChanges = 0;
      timer = null;
      await callback(count);
    }, debounceMs);
  };
}

export function startDevWatch(
  workspaceRoot: string,
  onRegenerate: (changedCount: number) => void | Promise<void>,
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

          debounced();
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
