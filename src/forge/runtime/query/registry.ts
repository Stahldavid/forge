import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../compiler/primitives/header.ts";
import type { QueryRegistry } from "../../compiler/types/query-registry.ts";

export function loadQueryRegistry(workspaceRoot: string): {
  registry: QueryRegistry | null;
  queries: QueryRegistry["queries"];
} {
  const absolute = join(workspaceRoot, GENERATED_DIR, "queryRegistry.json");
  if (!existsSync(absolute)) {
    return { registry: null, queries: [] };
  }

  const raw = stripDeterministicHeader(readFileSync(absolute, "utf8"));
  const registry = JSON.parse(raw) as QueryRegistry;
  return { registry, queries: registry.queries ?? [] };
}
