import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { detectCapabilities } from "../classifier/capabilities.ts";
import { detectSecrets } from "../classifier/secrets.ts";
import { resolveByPackageName } from "../recipes/registry.ts";
import type { PackageApi } from "../types/package-graph.ts";
import type { RuntimeContext } from "../types/runtime.ts";
import type {
  ExportChange,
  PackageApiDiff,
  RuntimeDiff,
  SignatureChange,
} from "./types.ts";

function exportKey(entrypoint: string, exportName: string): string {
  return `${entrypoint}\0${exportName}`;
}

function flattenExports(api: PackageApi): Map<string, ExportChange & { signature: string }> {
  const flattened = new Map<string, ExportChange & { signature: string }>();
  for (const entrypoint of api.entrypoints) {
    for (const exported of entrypoint.exports) {
      const signature = [exported.signature, ...(exported.declarations ?? [])]
        .filter(Boolean)
        .join("\n");
      flattened.set(exportKey(entrypoint.subpath, exported.name), {
        entrypoint: entrypoint.subpath,
        exportName: exported.name,
        kind: exported.kind,
        signature,
      });
    }
  }
  return flattened;
}

export function comparePackageApi(current: PackageApi, target: PackageApi): PackageApiDiff {
  const before = flattenExports(current);
  const after = flattenExports(target);
  const removedExports: ExportChange[] = [];
  const addedExports: ExportChange[] = [];
  const changedSignatures: SignatureChange[] = [];

  for (const [key, exported] of before) {
    const next = after.get(key);
    if (!next) {
      removedExports.push({
        entrypoint: exported.entrypoint,
        exportName: exported.exportName,
        kind: exported.kind,
      });
      continue;
    }

    if (next.signature !== exported.signature) {
      changedSignatures.push({
        entrypoint: exported.entrypoint,
        exportName: exported.exportName,
        before: exported.signature,
        after: next.signature,
        affectedCallsites: [],
      });
    }
  }

  for (const [key, exported] of after) {
    if (!before.has(key)) {
      addedExports.push({
        entrypoint: exported.entrypoint,
        exportName: exported.exportName,
        kind: exported.kind,
      });
    }
  }

  const beforeEntrypoints = new Set(current.entrypoints.map((entrypoint) => entrypoint.subpath));
  const afterEntrypoints = new Set(target.entrypoints.map((entrypoint) => entrypoint.subpath));
  const changedEntrypoints = [
    ...[...beforeEntrypoints]
      .filter((entrypoint) => !afterEntrypoints.has(entrypoint))
      .map((entrypoint) => ({ entrypoint, kind: "removed" as const })),
    ...[...afterEntrypoints]
      .filter((entrypoint) => !beforeEntrypoints.has(entrypoint))
      .map((entrypoint) => ({ entrypoint, kind: "added" as const })),
  ].sort((a, b) => `${a.kind}:${a.entrypoint}`.localeCompare(`${b.kind}:${b.entrypoint}`));

  return {
    removedExports: removedExports.sort((a, b) =>
      `${a.entrypoint}:${a.exportName}`.localeCompare(`${b.entrypoint}:${b.exportName}`),
    ),
    addedExports: addedExports.sort((a, b) =>
      `${a.entrypoint}:${a.exportName}`.localeCompare(`${b.entrypoint}:${b.exportName}`),
    ),
    changedSignatures: changedSignatures.sort((a, b) =>
      `${a.entrypoint}:${a.exportName}`.localeCompare(`${b.entrypoint}:${b.exportName}`),
    ),
    changedEntrypoints,
    changedJSDoc: [],
    typeResolutionChanges: [],
  };
}

function compatibleSet(classified: ClassifiedPackage | undefined): RuntimeContext[] {
  return [...(classified?.classification.compatible ?? [])].sort();
}

function secretNames(classified: ClassifiedPackage | undefined): string[] {
  if (!classified) {
    return [];
  }
  const recipe = classified.recipe ?? resolveByPackageName(classified.api.name);
  return detectSecrets(classified.api, recipe ?? undefined)
    .map((secret) => `${secret.envVar}:${secret.required ? "required" : "optional"}`)
    .sort();
}

function capabilityNames(classified: ClassifiedPackage | undefined): string[] {
  if (!classified) {
    return [];
  }
  const recipe = classified.recipe ?? resolveByPackageName(classified.api.name);
  const capabilities = detectCapabilities(classified.api, recipe ?? undefined);
  return Object.entries(capabilities)
    .filter(([, value]) => {
      return (
        typeof value === "object" &&
        "status" in value &&
        (value.status === "required" || value.status === "forbidden")
      );
    })
    .map(([name, value]) => `${name}:${"status" in value ? value.status : "unknown"}`)
    .sort();
}

function difference<T>(a: T[], b: T[]): T[] {
  const other = new Set(b);
  return a.filter((item) => !other.has(item)).sort();
}

export function compareRuntime(
  current: ClassifiedPackage | undefined,
  target: ClassifiedPackage | undefined,
): RuntimeDiff {
  const currentContexts = compatibleSet(current);
  const targetContexts = compatibleSet(target);
  const currentSecrets = secretNames(current);
  const targetSecrets = secretNames(target);
  const currentCapabilities = capabilityNames(current);
  const targetCapabilities = capabilityNames(target);
  const recipeChanged = (current?.recipe?.recipeVersion ?? undefined) !==
    (target?.recipe?.recipeVersion ?? current?.recipe?.recipeVersion ?? undefined);

  return {
    capabilitiesChanged:
      difference(targetCapabilities, currentCapabilities).length > 0 ||
      difference(currentCapabilities, targetCapabilities).length > 0,
    addedCapabilities: difference(targetCapabilities, currentCapabilities).map((name) => ({
      name: name.split(":")[0] ?? name,
      after: name.split(":")[1],
    })),
    removedCapabilities: difference(currentCapabilities, targetCapabilities).map((name) => ({
      name: name.split(":")[0] ?? name,
      before: name.split(":")[1],
    })),
    contextCompatibilityChanged:
      difference(currentContexts, targetContexts).length > 0 ||
      difference(targetContexts, currentContexts).length > 0,
    contextsNowDenied: difference(currentContexts, targetContexts),
    contextsNowAllowed: difference(targetContexts, currentContexts),
    secretChanges: {
      added: difference(targetSecrets, currentSecrets).map((secret) => secret.split(":")[0] ?? secret),
      removed: difference(currentSecrets, targetSecrets).map((secret) => secret.split(":")[0] ?? secret),
      changedRequired: targetSecrets
        .filter((secret) => currentSecrets.includes(`${secret.split(":")[0]}:optional`) && secret.endsWith(":required"))
        .map((secret) => secret.split(":")[0] ?? secret)
        .sort(),
    },
    recipeChanged,
    ...(current?.recipe?.recipeVersion ? { previousRecipeVersion: current.recipe.recipeVersion } : {}),
    ...(target?.recipe?.recipeVersion ? { nextRecipeVersion: target.recipe.recipeVersion } : {}),
  };
}
