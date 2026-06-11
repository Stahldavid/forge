import { nodeFileSystem } from "../../compiler/fs/index.ts";
import { join } from "node:path";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../compiler/primitives/header.ts";
import type { QueryRegistry } from "../../compiler/types/query-registry.ts";

export function loadQueryRegistry(workspaceRoot: string): {
  registry: QueryRegistry | null;
  queries: QueryRegistry["queries"];
} {
  const absolute = join(workspaceRoot, GENERATED_DIR, "queryRegistry.json");
  if (!nodeFileSystem.exists(absolute)) {
    return { registry: null, queries: [] };
  }

  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  const registry = JSON.parse(raw) as QueryRegistry;
  return { registry, queries: registry.queries ?? [] };
}
