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
  excluded: {
    actions: string[];
    workflows: string[];
    serverAdapters: string[];
    serverPackages: string[];
  };
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
      }),
    ),
    queries,
    commands,
    liveQueries: [],
    excluded: {
      actions,
      workflows,
      serverAdapters: collectServerAdapters(classified),
      serverPackages: collectServerPackages(classified),
    },
  };
}
