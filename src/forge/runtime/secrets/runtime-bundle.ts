import type { RuntimeContext } from "../../compiler/types/runtime.ts";
import type { RuntimeEnvStore } from "./types.ts";
import {
  createConfigContext,
  createSecretsContext,
} from "./create-context.ts";
import type { ConfigContext, SecretsContext } from "./types.ts";
import type { EnvSchema, SecretRegistry } from "../../compiler/types/secret-registry.ts";

export interface RuntimeSecretsBundle {
  secrets: SecretsContext;
  config: ConfigContext;
  store: RuntimeEnvStore;
}

export function createRuntimeSecretsBundle(input: {
  store: RuntimeEnvStore;
  registry: SecretRegistry | null;
  envSchema: EnvSchema | null;
  runtimeKind: RuntimeContext;
}): RuntimeSecretsBundle {
  const registryNames = new Set(
    input.registry?.secrets.map((entry) => entry.name) ?? [],
  );

  const secrets = createSecretsContext({
    store: input.store,
    registryNames,
    runtimeKind: input.runtimeKind,
    requiredSecrets: input.registry?.secrets.map((entry) => ({
      name: entry.name,
      required: entry.required,
    })),
  });

  const config = createConfigContext({
    store: input.store,
    schema: input.envSchema?.variables ?? [],
    runtimeKind: input.runtimeKind,
  });

  return {
    secrets,
    config,
    store: input.store,
  };
}
