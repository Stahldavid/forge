import { nodeFileSystem } from "../../compiler/fs/index.ts";
import { join } from "node:path";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../compiler/primitives/header.ts";
import type { AiRegistry } from "../../compiler/types/ai-registry.ts";
import type { SecretRegistry } from "../../compiler/types/secret-registry.ts";
import type { RuntimeEnvStore } from "../secrets/types.ts";
import { resolveProviderSecret } from "./providers.ts";
import type { ForgeAiProvider } from "./types.ts";

export function loadAiRegistry(workspaceRoot: string): AiRegistry | null {
  const path = join(workspaceRoot, GENERATED_DIR, "aiRegistry.json");
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  const raw = stripDeterministicHeader((nodeFileSystem.readText(path) ?? ""));
  return JSON.parse(raw) as AiRegistry;
}

export function loadAiProviders(workspaceRoot: string) {
  const registry = loadAiRegistry(workspaceRoot);
  return registry?.providers ?? [];
}

export function loadAiModels(workspaceRoot: string) {
  const path = join(workspaceRoot, GENERATED_DIR, "aiModels.json");
  if (!nodeFileSystem.exists(path)) {
    return [];
  }
  const raw = stripDeterministicHeader((nodeFileSystem.readText(path) ?? ""));
  const parsed = JSON.parse(raw) as { models: unknown[] };
  return parsed.models;
}

export interface AiCheckResult {
  ok: boolean;
  providers: Array<{
    id: ForgeAiProvider;
    secretName: string;
    configured: boolean;
  }>;
  missing: string[];
}

export function checkAiProviders(
  store: RuntimeEnvStore,
  registry: AiRegistry | null,
  secretRegistry: SecretRegistry | null,
): AiCheckResult {
  const providers = registry?.providers ?? [];
  const present = new Set<string>();
  const missing: string[] = [];

  const rows = providers.map((provider) => {
    const value = store.resolve(provider.secretName);
    const configured = value !== undefined && value.length > 0;
    if (configured) {
      present.add(provider.secretName);
    } else if (
      secretRegistry?.secrets.find((s) => s.name === provider.secretName)?.required
    ) {
      missing.push(provider.secretName);
    }

    return {
      id: provider.id,
      secretName: provider.secretName,
      configured,
    };
  });

  return {
    ok: missing.length === 0,
    providers: rows,
    missing,
  };
}

export function providerConfigured(
  store: RuntimeEnvStore,
  provider: ForgeAiProvider,
): boolean {
  const secret = resolveProviderSecret(provider);
  const value = store.resolve(secret);
  return value !== undefined && value.length > 0;
}
