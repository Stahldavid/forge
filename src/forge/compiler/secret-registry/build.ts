import { detectSecrets } from "../classifier/secrets.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { resolveByPackageName } from "../recipes/registry.ts";
import type {
  ConfigRegistry,
  EnvSchema,
  EnvVariable,
  SecretRegistry,
  SecretRegistryEntry,
} from "../types/secret-registry.ts";
import type { RuntimeContext } from "../types/runtime.ts";

const SECRET_CONTEXTS: RuntimeContext[] = [
  "server",
  "action",
  "workflow",
  "endpoint",
  "test",
  "build",
];

const CONFIG_CONTEXTS: RuntimeContext[] = [
  "server",
  "action",
  "workflow",
  "endpoint",
  "command",
];

function isPublicEnvVar(name: string): boolean {
  return name.startsWith("NEXT_PUBLIC_") || name.startsWith("PUBLIC_");
}

export function buildSecretRegistry(classified: ClassifiedPackage[]): SecretRegistry {
  const entries = new Map<string, SecretRegistryEntry>();

  for (const pkg of classified) {
    const recipe = pkg.recipe ?? resolveByPackageName(pkg.api.name) ?? undefined;
    const secrets = detectSecrets(pkg.api, recipe);
    const integration = recipe?.alias ?? pkg.api.name;

    for (const secretReq of secrets) {
      if (isPublicEnvVar(secretReq.envVar)) {
        continue;
      }

      const existing = entries.get(secretReq.envVar);
      entries.set(secretReq.envVar, {
        name: secretReq.envVar,
        required: existing?.required || secretReq.required,
        source: secretReq.detectedFrom === "recipe" ? "recipe" : secretReq.detectedFrom,
        integration: existing?.integration ?? integration,
        allowedContexts: SECRET_CONTEXTS,
        public: false,
      });
    }
  }

  return {
    secrets: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function buildEnvSchema(registry: SecretRegistry): EnvSchema {
  const variables: EnvVariable[] = registry.secrets.map((entry) => ({
    name: entry.name,
    kind: "secret" as const,
    required: entry.required,
    source: entry.source,
    integration: entry.integration,
    public: entry.public,
  }));

  return {
    variables: variables.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function buildConfigRegistry(registry: SecretRegistry): ConfigRegistry {
  const configs = registry.secrets
    .filter((entry) => entry.public || !entry.required)
    .map((entry) => ({
      name: entry.name,
      required: entry.required,
      source: entry.source,
      integration: entry.integration,
    }));

  return {
    configs: configs.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function augmentEnvSchemaWithPublicVars(
  schema: EnvSchema,
  classified: ClassifiedPackage[],
): EnvSchema {
  const variables = new Map(schema.variables.map((variable) => [variable.name, variable]));

  for (const pkg of classified) {
    const recipe = pkg.recipe ?? resolveByPackageName(pkg.api.name) ?? undefined;
    for (const secretReq of detectSecrets(pkg.api, recipe)) {
      if (!isPublicEnvVar(secretReq.envVar)) {
        continue;
      }

      variables.set(secretReq.envVar, {
        name: secretReq.envVar,
        kind: "config",
        required: secretReq.required,
        source: secretReq.detectedFrom,
        integration: recipe?.alias ?? pkg.api.name,
        public: true,
      });
    }
  }

  return {
    variables: [...variables.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export { SECRET_CONTEXTS, CONFIG_CONTEXTS, isPublicEnvVar };
