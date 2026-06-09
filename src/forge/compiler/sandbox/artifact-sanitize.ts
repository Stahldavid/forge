import type { PackageApi } from "../types/package-graph.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import { secretLeakScan } from "./secret-scan.ts";

export function packageApiContainsSecretValues(
  api: PackageApi,
  knownSecretValues: Iterable<string> = [],
): boolean {
  const serialized = canonicalJson(api);
  return secretLeakScan(serialized, {
    knownSecretValues,
    includeHighEntropy: false,
  }).hasLeak;
}

/**
 * Ensures cached/emitted package analysis retains secret names only — never values.
 */
export function assertPackageApiSecretSafe(
  api: PackageApi,
  knownSecretValues: Iterable<string> = [],
): void {
  if (packageApiContainsSecretValues(api, knownSecretValues)) {
    throw new Error("package api artifact contains secret material");
  }
}
