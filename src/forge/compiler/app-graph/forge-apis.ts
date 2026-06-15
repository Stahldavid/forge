import type { ForgeKind } from "../types/app-graph.ts";
import type { RuntimeContext } from "../types/runtime.ts";

/** Forge builder callee names mapped to semantic kinds. */
export const FORGE_BUILDER_APIS: Readonly<Record<string, ForgeKind>> = {
  defineTable: "schema.table",
  query: "query",
  liveQuery: "liveQuery",
  command: "command",
  action: "action",
  endpoint: "endpoint",
  policy: "policy",
  definePolicies: "policy",
  workflow: "workflow",
  agent: "agent",
  aiTool: "aiTool",
  telemetryEvent: "telemetryEvent",
};

/** Runtime contexts declared by Forge entrypoint kinds in a module. */
export const FORGE_KIND_TO_CONTEXT: Readonly<
  Partial<Record<ForgeKind, RuntimeContext>>
> = {
  command: "command",
  action: "action",
  query: "query",
  liveQuery: "liveQuery",
  endpoint: "endpoint",
  workflow: "workflow",
};
