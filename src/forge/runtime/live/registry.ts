import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../compiler/primitives/header.ts";
import type { LiveQueryRegistry } from "../../compiler/types/live-query-registry.ts";

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!existsSync(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader(readFileSync(absolute, "utf8"));
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
