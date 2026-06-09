import type { RuntimeClassification } from "../types/classification.ts";
import type { PackageApi } from "../types/package-graph.ts";
import type { IntegrationRecipe } from "../types/integration.ts";
import type { RuntimeMatrix, RuntimeMatrixEntry } from "../types/runtime-matrix.ts";
import { compareBytes } from "../primitives/compare.ts";
import { RECIPE_SCHEMA_VERSION } from "../recipes/definitions.ts";
import { resolveByPackageName } from "../recipes/registry.ts";

export interface ClassifiedPackage {
  api: PackageApi;
  classification: RuntimeClassification;
  recipe?: IntegrationRecipe;
}

export function buildRuntimeMatrix(
  packages: ClassifiedPackage[],
): RuntimeMatrix {
  const entries: RuntimeMatrixEntry[] = packages.map(
    ({ api, classification, recipe }) => {
      const resolved = recipe ?? resolveByPackageName(api.name);
      return {
        alias: resolved?.alias ?? api.name,
        packageName: api.name,
        compatible: [...classification.compatible],
        incompatible: [...classification.incompatible],
        rationale: { ...classification.rationale },
        perEntrypoint: [...classification.perEntrypoint],
      };
    },
  );

  entries.sort((a, b) => compareBytes(a.packageName, b.packageName));

  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    entries,
  };
}

export function lookupMatrixEntry(
  matrix: RuntimeMatrix,
  packageName: string,
): RuntimeMatrixEntry | undefined {
  return matrix.entries.find((e) => e.packageName === packageName);
}
