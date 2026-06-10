import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import type { QueryRegistry } from "../types/query-registry.ts";
import type { RuntimeGraph } from "../types/runtime-graph.ts";
import type { WorkflowRegistry } from "../types/workflow-registry.ts";

export interface ApiSurface {
  schemaVersion: string;
  generatorVersion: string;
  inputHash: string;
  queries: Record<string, string>;
  commands: Record<string, string>;
  actions: Record<string, string>;
  workflows: Record<string, string>;
}

export function buildApiSurface(
  runtimeGraph: RuntimeGraph,
  queryRegistry: QueryRegistry,
  workflowRegistry: WorkflowRegistry,
): ApiSurface {
  const queries: Record<string, string> = {};
  for (const query of queryRegistry.queries) {
    queries[query.name] = query.name;
  }

  const commands: Record<string, string> = {};
  const actions: Record<string, string> = {};
  for (const entry of runtimeGraph.entries) {
    if (entry.kind === "command") {
      commands[entry.name] = entry.name;
    } else {
      actions[entry.name] = entry.name;
    }
  }

  const workflows: Record<string, string> = {};
  for (const workflow of workflowRegistry.workflows) {
    workflows[workflow.name] = workflow.name;
  }

  return {
    schemaVersion: "1.0.0",
    generatorVersion: GENERATOR_VERSION,
    inputHash: hashStable(
      canonicalJson({
        runtimeInputHash: runtimeGraph.inputHash,
        queryInputHash: queryRegistry.inputHash,
        workflowInputHash: workflowRegistry.inputHash,
      }),
    ),
    queries,
    commands,
    actions,
    workflows,
  };
}

export function serializeApiTs(surface: ApiSurface): string {
  return `export const api = ${JSON.stringify(
    {
      queries: surface.queries,
      commands: surface.commands,
      liveQueries: {},
      actions: surface.actions,
      workflows: surface.workflows,
    },
    null,
    2,
  )} as const;\n`;
}

export function serializeServerApiTs(surface: ApiSurface): string {
  return `import { api } from "./api.ts";

export const serverApi = {
  queries: api.queries,
  commands: api.commands,
  actions: api.actions,
  workflows: api.workflows,
} as const;
`;
}

export function serializeClientApiTs(surface: ApiSurface): string {
  return `import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
`;
}
