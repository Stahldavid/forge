import type { ForgeLock, ForgeLockEntry } from "../types/lock.ts";
import type { SecretRequirement } from "../types/capability.ts";
import {
  compareBytes,
  serializeCanonical,
  stableSortByPath,
  stableSortStrings,
} from "../primitives/index.ts";

function compareLockEntries(a: ForgeLockEntry, b: ForgeLockEntry): number {
  return compareBytes(a.name, b.name);
}

function compareSecrets(a: SecretRequirement, b: SecretRequirement): number {
  return compareBytes(a.envVar, b.envVar);
}

function stableSortLockEntries(entries: ForgeLockEntry[]): ForgeLockEntry[] {
  return [...entries].sort(compareLockEntries);
}

function stableSortSecrets(secrets: SecretRequirement[]): SecretRequirement[] {
  return [...secrets].sort(compareSecrets);
}

function canonicalizeLockEntry(entry: ForgeLockEntry): ForgeLockEntry {
  return {
    name: entry.name,
    version: entry.version,
    ...(entry.recipeVersion !== undefined
      ? { recipeVersion: entry.recipeVersion }
      : {}),
    runtimeContexts: stableSortStrings([...entry.runtimeContexts]),
    capabilities: {
      ...entry.capabilities,
      secrets: stableSortSecrets([...entry.capabilities.secrets]),
    },
    secrets: stableSortSecrets([...entry.secrets]),
    generatedFiles: stableSortByPath([...entry.generatedFiles]),
    contentChecksum: entry.contentChecksum,
  };
}

/**
 * Deterministic forge.lock serialization (no deterministic header).
 */
export function serializeForgeLock(lock: ForgeLock): string {
  const canonical: ForgeLock = {
    schemaVersion: lock.schemaVersion,
    generatorVersion: lock.generatorVersion,
    analyzerVersion: lock.analyzerVersion,
    inputHash: lock.inputHash,
    lockfileHash: lock.lockfileHash,
    packageManager: lock.packageManager,
    ...(lock.recipeVersion !== undefined
      ? { recipeVersion: lock.recipeVersion }
      : {}),
    packages: stableSortLockEntries(lock.packages).map(canonicalizeLockEntry),
  };

  return serializeCanonical(canonical);
}
