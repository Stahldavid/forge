import type { SecretRequirement } from "../types/capability.ts";
import type { IntegrationRecipe } from "../types/integration.ts";
import type { PackageApi } from "../types/package-graph.ts";
import { secret } from "../recipes/helpers.ts";
import { gatherSignals } from "./signals.ts";

export function detectSecrets(
  api: PackageApi,
  recipe?: IntegrationRecipe,
): SecretRequirement[] {
  const found = new Map<string, SecretRequirement>();

  if (recipe) {
    for (const s of recipe.secrets) {
      found.set(s.envVar, { ...s });
    }
  }

  const signals = gatherSignals(api);
  for (const evidence of signals.envSecretEvidence) {
    const envVar = evidence.replace(/^env:/, "");
    if (!found.has(envVar)) {
      found.set(envVar, secret(envVar, true, "signature"));
    }
  }

  for (const ep of api.entrypoints) {
    for (const exp of ep.exports) {
      if (!exp.jsdoc) continue;
      for (const tag of exp.jsdoc.tags) {
        if (tag.tag !== "env" && tag.tag !== "secret") continue;
        const name = tag.text.trim().split(/\s+/)[0];
        if (name && /^[A-Z][A-Z0-9_]*$/.test(name) && !found.has(name)) {
          found.set(name, secret(name, true, "jsdoc"));
        }
      }
    }
  }

  return [...found.values()].sort((a, b) => a.envVar.localeCompare(b.envVar));
}
