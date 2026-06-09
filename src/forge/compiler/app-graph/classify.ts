import type { ForgeKind } from "../types/app-graph.ts";
import { FORGE_BUILDER_APIS } from "./forge-apis.ts";

/**
 * Classify a Forge builder callee into exactly one ForgeKind, or null when
 * the callee is not a known Forge builder API.
 */
export function classifyForgeCallee(callee: string): ForgeKind | null {
  return FORGE_BUILDER_APIS[callee] ?? null;
}
