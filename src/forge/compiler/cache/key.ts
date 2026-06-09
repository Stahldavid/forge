import type { PackageCacheKey } from "../types/lock.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";

export function buildPackageCacheKey(
  input: PackageCacheKey,
): PackageCacheKey {
  return {
    name: input.name,
    version: input.version,
    packageManager: input.packageManager,
    ...(input.packageIntegrity !== undefined
      ? { packageIntegrity: input.packageIntegrity }
      : {}),
    packageJsonHash: input.packageJsonHash,
    dtsFilesHash: input.dtsFilesHash,
    analyzerVersion: input.analyzerVersion,
    typescriptVersion: input.typescriptVersion,
    resolutionMode: input.resolutionMode,
    ...(input.recipeVersion !== undefined
      ? { recipeVersion: input.recipeVersion }
      : {}),
  };
}

export function serializePackageCacheKey(key: PackageCacheKey): string {
  return canonicalJson(key);
}

export function fingerprintPackageCacheKey(key: PackageCacheKey): string {
  return hashStable(serializePackageCacheKey(key));
}

export function cacheKeysEqual(
  a: PackageCacheKey,
  b: PackageCacheKey,
): boolean {
  return serializePackageCacheKey(a) === serializePackageCacheKey(b);
}

/**
 * Global lockfile hash is informational and intentionally excluded from cache keys.
 */
export function lockfileHashAffectsCache(_lockfileHash: string): boolean {
  return false;
}
