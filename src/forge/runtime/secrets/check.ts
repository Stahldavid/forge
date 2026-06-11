import { nodeFileSystem } from "../../compiler/fs/index.ts";
import { join } from "node:path";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../compiler/primitives/header.ts";
import type {
  EnvSchema,
  SecretRegistry,
} from "../../compiler/types/secret-registry.ts";
import { redactSecretValue } from "./env-loader.ts";
import type { RuntimeEnvStore } from "./types.ts";

export interface SecretsCheckResult {
  ok: boolean;
  missing: string[];
  present: { name: string; redacted: string }[];
}

export function loadSecretRegistry(workspaceRoot: string): SecretRegistry | null {
  const absolute = join(workspaceRoot, GENERATED_DIR, "secretRegistry.json");
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }

  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  return JSON.parse(raw) as SecretRegistry;
}

export function loadEnvSchema(workspaceRoot: string): EnvSchema | null {
  const absolute = join(workspaceRoot, GENERATED_DIR, "envSchema.json");
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }

  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  return JSON.parse(raw) as EnvSchema;
}

export function checkSecrets(
  store: RuntimeEnvStore,
  registry: SecretRegistry,
): SecretsCheckResult {
  const missing: string[] = [];
  const present: { name: string; redacted: string }[] = [];

  for (const entry of registry.secrets) {
    const value = store.resolve(entry.name);
    if (!value || value.length === 0) {
      if (entry.required) {
        missing.push(entry.name);
      }
      continue;
    }

    present.push({
      name: entry.name,
      redacted: redactSecretValue(value),
    });
  }

  return {
    ok: missing.length === 0,
    missing: missing.sort(),
    present: present.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function countMissingRequiredSecrets(
  store: RuntimeEnvStore,
  registry: SecretRegistry,
): number {
  return registry.secrets.filter((entry) => {
    if (!entry.required) {
      return false;
    }
    const value = store.resolve(entry.name);
    return !value || value.length === 0;
  }).length;
}
