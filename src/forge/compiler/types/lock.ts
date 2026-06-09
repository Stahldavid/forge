import type { CapabilitySet, SecretRequirement } from "./capability.ts";
import type { PackageManager, RuntimeContext } from "./runtime.ts";

export interface PackageCacheKey {
  name: string;
  version: string;
  packageManager: PackageManager;
  packageIntegrity?: string;
  packageJsonHash: string;
  dtsFilesHash: string;
  analyzerVersion: string;
  typescriptVersion: string;
  resolutionMode: "nodenext" | "bundler";
  recipeVersion?: string;
}

export interface ForgeLockEntry {
  name: string;
  version: string;
  recipeVersion?: string;
  runtimeContexts: RuntimeContext[];
  capabilities: CapabilitySet;
  secrets: SecretRequirement[];
  generatedFiles: string[];
  contentChecksum: string;
}

export interface ForgeLock {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  lockfileHash: string;
  packageManager: PackageManager;
  recipeVersion?: string;
  packages: ForgeLockEntry[];
}
