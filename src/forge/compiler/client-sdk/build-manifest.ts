import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import type { ApiSurface } from "../api-surface/build.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { resolveByPackageName } from "../recipes/registry.ts";

export interface ClientManifest {
  schemaVersion: string;
  generatorVersion: string;
  inputHash: string;
  queries: string[];
  commands: string[];
  liveQueries: string[];
  transport: {
    queries: string;
    commands: string;
    liveQueries: string;
    externalQueries: string;
    externalCommands: string;
  };
  react: {
    entrypoint: string;
    hooks: string[];
  };
  vue: {
    entrypoint: string;
    composables: string[];
  };
  excluded: {
    actions: string[];
    workflows: string[];
    serverAdapters: string[];
    serverPackages: string[];
  };
}

export interface ReactManifest {
  schemaVersion: string;
  generatorVersion: string;
  inputHash: string;
  entrypoint: string;
  hooks: string[];
  queries: string[];
  commands: string[];
  liveQueries: string[];
  clientSafe: true;
}

export interface VueManifest {
  schemaVersion: string;
  generatorVersion: string;
  inputHash: string;
  entrypoint: string;
  composables: string[];
  queries: string[];
  commands: string[];
  liveQueries: string[];
  clientSafe: true;
}

const SERVER_ADAPTER_SUFFIX = ".server.ts";

function collectServerAdapters(classified: ClassifiedPackage[]): string[] {
  const adapters = new Set<string>();
  for (const pkg of classified) {
    const recipe = pkg.recipe ?? resolveByPackageName(pkg.api.name);
    if (!recipe?.adapters) {
      continue;
    }
    for (const adapter of recipe.adapters) {
      if (adapter.endsWith(SERVER_ADAPTER_SUFFIX) || adapter.includes(".server.")) {
        adapters.add(adapter);
      }
    }
  }
  return [...adapters].sort();
}

function collectServerPackages(classified: ClassifiedPackage[]): string[] {
  const packages = new Set<string>();
  for (const pkg of classified) {
    const recipe = pkg.recipe ?? resolveByPackageName(pkg.api.name);
    if (!recipe) {
      continue;
    }
    if (recipe.contexts.denied.includes("client")) {
      packages.add(pkg.api.name);
    }
  }
  return [...packages].sort();
}

export function buildClientManifest(
  surface: ApiSurface,
  classified: ClassifiedPackage[],
): ClientManifest {
  const queries = Object.keys(surface.queries).sort();
  const commands = Object.keys(surface.commands).sort();
  const liveQueries = Object.keys(surface.liveQueries).sort();
  const actions = Object.keys(surface.actions).sort();
  const workflows = Object.keys(surface.workflows).sort();

  return {
    schemaVersion: "1.0.0",
    generatorVersion: GENERATOR_VERSION,
    inputHash: hashStable(
      canonicalJson({
        apiInputHash: surface.inputHash,
        queries,
        commands,
        liveQueries,
      }),
    ),
    queries,
    commands,
    liveQueries,
    transport: {
      queries: "POST /queries/:name",
      commands: "POST /commands/:name",
      liveQueries: "GET /live/:name",
      externalQueries: "POST /external/:service/queries/:name",
      externalCommands: "POST /external/:service/commands/:name",
    },
    react: {
      entrypoint: "src/forge/_generated/react.ts",
      hooks: [
        "ForgeProvider",
        "useForgeClient",
        "useAuth",
        "useQuery",
        "useCommand",
        "useLiveQuery",
      ],
    },
    vue: {
      entrypoint: "src/forge/_generated/vue.ts",
      composables: [
        "provideForge",
        "useForgeClient",
        "useForgeAuth",
        "useForgeQuery",
        "useForgeCommand",
        "useForgeLiveQuery",
      ],
    },
    excluded: {
      actions,
      workflows,
      serverAdapters: collectServerAdapters(classified),
      serverPackages: collectServerPackages(classified),
    },
  };
}

export function buildReactManifest(clientManifest: ClientManifest): ReactManifest {
  const hooks = [
    "ForgeProvider",
    "useForgeClient",
    "useAuth",
    "useQuery",
    "useCommand",
    "useLiveQuery",
  ];

  return {
    schemaVersion: "1.0.0",
    generatorVersion: GENERATOR_VERSION,
    inputHash: hashStable(
      canonicalJson({
        clientInputHash: clientManifest.inputHash,
        hooks,
      }),
    ),
    entrypoint: "src/forge/_generated/react.ts",
    hooks,
    queries: clientManifest.queries,
    commands: clientManifest.commands,
    liveQueries: clientManifest.liveQueries,
    clientSafe: true,
  };
}

export function buildVueManifest(clientManifest: ClientManifest): VueManifest {
  const composables = [
    "provideForge",
    "useForgeClient",
    "useForgeAuth",
    "useForgeQuery",
    "useForgeCommand",
    "useForgeLiveQuery",
  ];

  return {
    schemaVersion: "1.0.0",
    generatorVersion: GENERATOR_VERSION,
    inputHash: hashStable(
      canonicalJson({
        clientInputHash: clientManifest.inputHash,
        composables,
      }),
    ),
    entrypoint: "src/forge/_generated/vue.ts",
    composables,
    queries: clientManifest.queries,
    commands: clientManifest.commands,
    liveQueries: clientManifest.liveQueries,
    clientSafe: true,
  };
}
