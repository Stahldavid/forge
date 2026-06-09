import { forgeDupSymbol } from "../diagnostics/create.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import type { ForgeSymbol } from "../types/app-graph.ts";

/**
 * Emit FORGE_DUP_SYMBOL warnings for stable-id collisions without discarding symbols.
 */
export function detectDuplicateSymbols(symbols: ForgeSymbol[]): Diagnostic[] {
  const groups = new Map<string, ForgeSymbol[]>();

  for (const symbol of symbols) {
    const list = groups.get(symbol.id) ?? [];
    list.push(symbol);
    groups.set(symbol.id, list);
  }

  const diagnostics: Diagnostic[] = [];

  for (const group of groups.values()) {
    if (group.length <= 1) {
      continue;
    }
    for (const symbol of group) {
      diagnostics.push(forgeDupSymbol(symbol.qualifiedName, symbol.file));
    }
  }

  return diagnostics;
}
