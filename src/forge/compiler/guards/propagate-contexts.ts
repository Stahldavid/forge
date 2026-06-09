import type { ModuleGraph, ModuleNode } from "../types/app-graph.ts";
import type { RuntimeContext } from "../types/runtime.ts";
import { stableSortStrings } from "../primitives/sort.ts";

function unionContexts(
  existing: RuntimeContext[],
  added: RuntimeContext[],
): RuntimeContext[] {
  const set = new Set<RuntimeContext>(existing);
  for (const context of added) {
    set.add(context);
  }
  return stableSortStrings([...set]) as RuntimeContext[];
}

/**
 * Seed each module with its declared contexts, then propagate each Forge entrypoint's
 * declared contexts over the local import graph (transitive closure via localImports).
 */
export function propagateContexts(moduleGraph: ModuleGraph): void {
  const byId = new Map<string, ModuleNode>();
  for (const node of moduleGraph.nodes) {
    byId.set(node.id, node);
    node.effectiveContexts = unionContexts([], node.declaredContexts);
  }

  for (const entry of moduleGraph.nodes) {
    if (entry.declaredContexts.length === 0) {
      continue;
    }

    const stack = [...entry.localImports.map((link) => link.toModuleId)];
    const seen = new Set<string>();

    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);

      const node = byId.get(id);
      if (node == null) {
        continue;
      }

      node.effectiveContexts = unionContexts(
        node.effectiveContexts,
        entry.declaredContexts,
      );

      for (const link of node.localImports) {
        stack.push(link.toModuleId);
      }
    }
  }
}
