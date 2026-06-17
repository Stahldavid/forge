import type { CapabilitySet, SecretRequirement } from "../types/capability.ts";
import type { RuntimeClassification } from "../types/classification.ts";
import type { ExportClassification } from "../types/package-graph.ts";
import type { IntegrationRecipe } from "../types/integration.ts";
import type { PackageApi } from "../types/package-graph.ts";
import { compareBytes } from "../primitives/compare.ts";
import { resolveByPackageName } from "../recipes/registry.ts";
import { detectCapabilities } from "./capabilities.ts";
import { partitionContexts } from "./contexts.ts";
import { detectSecrets } from "./secrets.ts";
import { gatherSignals, type PackageSignals } from "./signals.ts";

export interface RuntimeClassifier {
  classify(api: PackageApi, recipe?: IntegrationRecipe): RuntimeClassification;
  detectCapabilities(api: PackageApi, recipe?: IntegrationRecipe): CapabilitySet;
  detectSecrets(api: PackageApi, recipe?: IntegrationRecipe): SecretRequirement[];
}

function resolveRecipeForApi(
  api: PackageApi,
  recipe?: IntegrationRecipe,
): IntegrationRecipe | undefined {
  return recipe ?? resolveByPackageName(api.name) ?? undefined;
}

function classifyExport(
  api: PackageApi,
  entrypoint: string,
  exportName: string,
  recipe: IntegrationRecipe | undefined,
  caps: CapabilitySet,
  alias: string,
  signals: PackageSignals,
): ExportClassification {
  const { compatible, incompatible } = partitionContexts(
    recipe,
    caps,
    signals,
    api.name,
  );

  return {
    alias,
    packageName: api.name,
    entrypoint,
    exportName,
    compatible,
    incompatible,
    capabilities: caps,
  };
}

export function classify(
  api: PackageApi,
  recipe?: IntegrationRecipe,
): RuntimeClassification {
  const resolvedRecipe = resolveRecipeForApi(api, recipe);
  const signals = gatherSignals(api);
  const caps = detectCapabilities(api, resolvedRecipe, signals);
  const capsWithSecrets: CapabilitySet = {
    ...caps,
    secrets: detectSecrets(api, resolvedRecipe, signals),
  };
  const alias = resolvedRecipe?.alias ?? api.name;

  const { compatible, incompatible, rationale } = partitionContexts(
    resolvedRecipe,
    capsWithSecrets,
    signals,
    api.name,
  );

  const perEntrypoint: ExportClassification[] = [];
  for (const ep of api.entrypoints) {
    for (const exp of ep.exports) {
      perEntrypoint.push(
        classifyExport(
          api,
          ep.subpath,
          exp.name,
          resolvedRecipe,
          capsWithSecrets,
          alias,
          signals,
        ),
      );
    }
    if (ep.exports.length === 0) {
      perEntrypoint.push(
        classifyExport(
          api,
          ep.subpath,
          "*",
          resolvedRecipe,
          capsWithSecrets,
          alias,
          signals,
        ),
      );
    }
  }

  if (api.entrypoints.length === 0) {
    perEntrypoint.push(
      classifyExport(
        api,
        ".",
        "*",
        resolvedRecipe,
        capsWithSecrets,
        alias,
        signals,
      ),
    );
  }

  perEntrypoint.sort((a, b) => {
    const ep = compareBytes(a.entrypoint, b.entrypoint);
    if (ep !== 0) return ep;
    return compareBytes(a.exportName, b.exportName);
  });

  return {
    compatible,
    incompatible,
    rationale,
    perEntrypoint,
  };
}

export function createRuntimeClassifier(): RuntimeClassifier {
  return {
    classify,
    detectCapabilities,
    detectSecrets,
  };
}
