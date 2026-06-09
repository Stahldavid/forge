import type {
  LocalImport,
  ModuleGraph,
  ModuleNode,
  PackageImport,
} from "../../src/forge/compiler/types/app-graph.ts";
import type { RuntimeContext } from "../../src/forge/compiler/types/runtime.ts";
import type {
  RuntimeMatrix,
  RuntimeMatrixEntry,
} from "../../src/forge/compiler/types/runtime-matrix.ts";
import { moduleIdForFile } from "../../src/forge/compiler/app-graph/module-graph.ts";
import { RECIPE_SCHEMA_VERSION } from "../../src/forge/compiler/recipes/definitions.ts";
import { classify, buildRuntimeMatrix } from "../../src/forge/compiler/classifier/index.ts";
import { resolveRecipe } from "../../src/forge/compiler/recipes/index.ts";
import { makeExport, makePackageApi } from "../helpers/package-api.ts";

export function makeModuleNode(
  file: string,
  options: {
    declaredContexts?: RuntimeContext[];
    packageImports?: PackageImport[];
    localImports?: LocalImport[];
    effectiveContexts?: RuntimeContext[];
  } = {},
): ModuleNode {
  return {
    id: moduleIdForFile(file),
    file,
    directPackageImports: options.packageImports ?? [],
    localImports: options.localImports ?? [],
    declaredContexts: options.declaredContexts ?? [],
    effectiveContexts: options.effectiveContexts ?? [],
  };
}

export function linkModules(from: ModuleNode, to: ModuleNode): void {
  from.localImports.push({
    toModuleId: to.id,
    span: { start: 0, end: 1 },
  });
}

export function stripeMatrix(): RuntimeMatrix {
  const api = makePackageApi({
    name: "stripe",
    entrypoints: [
      {
        subpath: ".",
        conditions: ["import", "types"],
        patternBacked: false,
        dtsPath: "index.d.ts",
        exports: [makeExport("Stripe", "class Stripe { constructor(apiKey: string) }")],
      },
    ],
  });
  return buildRuntimeMatrix([
    {
      api,
      classification: classify(api, resolveRecipe("stripe")!),
      recipe: resolveRecipe("stripe")!,
    },
  ]);
}

export function unmanagedMatrix(): RuntimeMatrix {
  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    entries: [],
  };
}

export function customMatrixEntry(
  entry: Partial<RuntimeMatrixEntry> & Pick<RuntimeMatrixEntry, "packageName">,
): RuntimeMatrix {
  const full: RuntimeMatrixEntry = {
    alias: entry.alias ?? entry.packageName,
    packageName: entry.packageName,
    compatible: entry.compatible ?? ["server", "action"],
    incompatible: entry.incompatible ?? ["command"],
    rationale: entry.rationale ?? {
      command: "blocked for test",
      shared: "ok",
      client: "ok",
      server: "ok",
      query: "ok",
      liveQuery: "ok",
      action: "ok",
      workflow: "ok",
      endpoint: "ok",
      edge: "ok",
      test: "ok",
      build: "ok",
    },
    perEntrypoint: entry.perEntrypoint ?? [],
  };

  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    entries: [full],
  };
}

export function graphFromNodes(nodes: ModuleNode[]): ModuleGraph {
  return { nodes };
}
