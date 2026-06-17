import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import type { QueryRegistry } from "../types/query-registry.ts";
import type { LiveQueryRegistry } from "../types/live-query-registry.ts";
import type { RuntimeGraph } from "../types/runtime-graph.ts";
import type { WorkflowRegistry } from "../types/workflow-registry.ts";
import type { ForgeExternalServiceGraph } from "../external-manifest/types.ts";

export interface ApiExternalEntry {
  service: string;
  name: string;
  kind: "command" | "query";
  language: string;
  framework?: string;
  transport: string;
}

export interface ApiSurface {
  schemaVersion: string;
  generatorVersion: string;
  inputHash: string;
  queries: Record<string, string>;
  commands: Record<string, string>;
  liveQueries: Record<string, string>;
  actions: Record<string, string>;
  workflows: Record<string, string>;
  external?: {
    services: Record<string, string>;
    commands: Record<string, ApiExternalEntry>;
    queries: Record<string, ApiExternalEntry>;
  };
}

export function buildApiSurface(
  runtimeGraph: RuntimeGraph,
  queryRegistry: QueryRegistry,
  liveQueryRegistry: LiveQueryRegistry,
  workflowRegistry: WorkflowRegistry,
  externalServices?: ForgeExternalServiceGraph,
): ApiSurface {
  const queries: Record<string, string> = {};
  for (const query of queryRegistry.queries) {
    queries[query.name] = query.name;
  }

  const liveQueries: Record<string, string> = {};
  for (const liveQuery of liveQueryRegistry.liveQueries) {
    liveQueries[liveQuery.name] = liveQuery.name;
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

  const external = {
    services: {} as Record<string, string>,
    commands: {} as Record<string, ApiExternalEntry>,
    queries: {} as Record<string, ApiExternalEntry>,
  };
  for (const service of externalServices?.services ?? []) {
    external.services[service.name] = service.name;
    for (const entry of service.entries) {
      const qualifiedName = `${service.name}.${entry.name}`;
      const surfaceEntry = {
        service: service.name,
        name: entry.name,
        kind: entry.kind,
        language: service.language,
        ...(service.framework ? { framework: service.framework } : {}),
        transport: service.transport,
      };
      if (entry.kind === "command") {
        external.commands[qualifiedName] = surfaceEntry;
      } else {
        external.queries[qualifiedName] = surfaceEntry;
      }
    }
  }

  return {
    schemaVersion: "1.0.0",
    generatorVersion: GENERATOR_VERSION,
    inputHash: hashStable(
      canonicalJson({
        runtimeInputHash: runtimeGraph.inputHash,
        queryInputHash: queryRegistry.inputHash,
        liveQueryInputHash: liveQueryRegistry.inputHash,
        workflowInputHash: workflowRegistry.inputHash,
        externalInputHash: externalServices?.inputHash ?? "",
      }),
    ),
    queries,
    commands,
    liveQueries,
    actions,
    workflows,
    external,
  };
}

export function serializeApiTs(surface: ApiSurface): string {
  const external = surface.external ?? { services: {}, commands: {}, queries: {} };
  return `export const api = ${JSON.stringify(
    {
      queries: surface.queries,
      commands: surface.commands,
      liveQueries: surface.liveQueries,
      actions: surface.actions,
      workflows: surface.workflows,
      external,
    },
    null,
    2,
  )} as const;\n`;
}

export function serializeServerApiTs(_surface: ApiSurface): string {
  return `import { api } from "./api.ts";

export const serverApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  actions: api.actions,
  workflows: api.workflows,
  external: api.external,
} as const;
`;
}

export function serializeClientApiTs(_surface: ApiSurface): string {
  return `import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  external: api.external,
} as const;
`;
}
