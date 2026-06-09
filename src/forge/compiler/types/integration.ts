import type { CapabilitySet, SecretRequirement } from "./capability.ts";
import type { RuntimeContext } from "./runtime.ts";

export interface PackageRecipe {
  packageName: string;
  role?: string;
  supportedVersionRange?: string;
  contexts?: { allowed: RuntimeContext[]; denied: RuntimeContext[] };
}

export interface IntegrationRecipe {
  alias: string;
  packages: PackageRecipe[];
  supportedVersionRange: string;
  recipeVersion: string;
  contexts: { allowed: RuntimeContext[]; denied: RuntimeContext[] };
  capabilities: CapabilitySet;
  secrets: SecretRequirement[];
  adapters: string[];
  testkits: string[];
  docs: string[];
  importRewrites?: { from: string; to: string }[];
}
