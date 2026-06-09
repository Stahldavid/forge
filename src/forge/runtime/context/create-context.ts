import type { DbClient } from "../db/generated-client.ts";
import type { DbTransaction } from "../db/adapter.ts";
import type { ActionSubscription } from "../../compiler/types/action-subscriptions.ts";
import type { TelemetryContext } from "../telemetry/types.ts";
import type { AuthContext } from "../auth/types.ts";
import type { RuntimeContext } from "../../compiler/types/runtime.ts";
import { snapshotAuth } from "../auth/types.ts";
import { createNoopTelemetryContext } from "../telemetry/context.ts";
import { insertOutbox } from "../db/outbox.ts";
import type { ConfigContext, SecretsContext } from "../secrets/types.ts";
import type { RuntimeEnvStore } from "../secrets/types.ts";
import { loadEnvFiles } from "../secrets/env-loader.ts";
import { loadEnvSchema, loadSecretRegistry } from "../secrets/check.ts";
import { createRuntimeSecretsBundle } from "../secrets/runtime-bundle.ts";

export interface ForgeContext {
  db: DbClient;
  emit: (eventType: string, payload: unknown) => Promise<void>;
  env: Record<string, string | undefined>;
  telemetry: TelemetryContext;
  auth: AuthContext;
  secrets: SecretsContext;
  config: ConfigContext;
}

let sharedEnvStore: RuntimeEnvStore | null = null;

export function initializeRuntimeEnv(
  workspaceRoot: string,
  envFiles?: string[],
): RuntimeEnvStore {
  const { store } = loadEnvFiles({ workspaceRoot, envFiles });
  sharedEnvStore = store;
  return store;
}

export function getRuntimeEnvStore(workspaceRoot?: string): RuntimeEnvStore {
  if (sharedEnvStore) {
    return sharedEnvStore;
  }

  if (workspaceRoot) {
    return initializeRuntimeEnv(workspaceRoot);
  }

  return {
    loadedFiles: [],
    resolve(name: string): string | undefined {
      return process.env[name];
    },
    snapshot(): Record<string, string | undefined> {
      return { ...process.env };
    },
  };
}

function buildSecretsAndConfig(
  workspaceRoot: string | undefined,
  runtimeKind: RuntimeContext,
  store: RuntimeEnvStore,
): { secrets: SecretsContext; config: ConfigContext; env: Record<string, string | undefined> } {
  const registry = workspaceRoot ? loadSecretRegistry(workspaceRoot) : null;
  const envSchema = workspaceRoot ? loadEnvSchema(workspaceRoot) : null;
  const bundle = createRuntimeSecretsBundle({
    store,
    registry,
    envSchema,
    runtimeKind,
  });

  return {
    secrets: bundle.secrets,
    config: bundle.config,
    env: store.snapshot(),
  };
}

export function createForgeContext(
  tx: DbTransaction,
  db: DbClient,
  subscriptions: ActionSubscription[],
  telemetry: TelemetryContext,
  auth: AuthContext,
  options?: {
    env?: Record<string, string | undefined>;
    runtimeKind?: RuntimeContext;
    workspaceRoot?: string;
    store?: RuntimeEnvStore;
  },
): ForgeContext {
  const runtimeKind = options?.runtimeKind ?? "command";
  const store =
    options?.store ??
    (options?.workspaceRoot
      ? getRuntimeEnvStore(options.workspaceRoot)
      : getRuntimeEnvStore());
  const { secrets, config, env } = buildSecretsAndConfig(
    options?.workspaceRoot,
    runtimeKind,
    store,
  );

  return {
    db,
    env: options?.env ?? env,
    telemetry,
    auth,
    secrets,
    config,
    emit: async (eventType, payload) => {
      const enriched =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? { ...(payload as Record<string, unknown>), traceId: telemetry.traceId }
          : { value: payload, traceId: telemetry.traceId };

      const result = await insertOutbox(
        tx,
        eventType,
        enriched,
        subscriptions,
        snapshotAuth(auth),
      );
      if (!result.ok) {
        throw new Error(result.diagnostic.message);
      }
    },
  };
}

export function createActionContext(
  db: DbClient,
  telemetry: TelemetryContext,
  auth: AuthContext,
  options?: {
    env?: Record<string, string | undefined>;
    workspaceRoot?: string;
    store?: RuntimeEnvStore;
    runtimeKind?: RuntimeContext;
  },
): ForgeContext {
  const runtimeKind = options?.runtimeKind ?? "action";
  const store =
    options?.store ??
    (options?.workspaceRoot
      ? getRuntimeEnvStore(options.workspaceRoot)
      : getRuntimeEnvStore());
  const { secrets, config, env } = buildSecretsAndConfig(
    options?.workspaceRoot,
    runtimeKind,
    store,
  );

  return {
    db,
    env: options?.env ?? env,
    telemetry,
    auth,
    secrets,
    config,
    emit: async () => {
      /* actions invoked by outbox worker do not emit */
    },
  };
}

export { createNoopTelemetryContext };
