import { nodeFileSystem } from "../../compiler/fs/index.ts";
import { join } from "node:path";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../compiler/primitives/header.ts";
import type { LiveQueryRegistry } from "../../compiler/types/live-query-registry.ts";

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  return JSON.parse(raw) as T;
}

export function loadLiveQueryRegistry(workspaceRoot: string): {
  registry: LiveQueryRegistry | null;
  liveQueries: LiveQueryRegistry["liveQueries"];
} {
  const registry = readGeneratedJson<LiveQueryRegistry>(
    workspaceRoot,
    `${GENERATED_DIR}/liveQueryRegistry.json`,
  );
  return {
    registry,
    liveQueries: registry?.liveQueries ?? [],
  };
}
