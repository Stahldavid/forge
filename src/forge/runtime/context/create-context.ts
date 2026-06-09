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
import { createAiContext } from "../ai/context.ts";
import type { AiContext } from "../ai/types.ts";
import { isMockAiEnabled } from "../ai/state.ts";

export interface ForgeContext {
  db: DbClient;
  emit: (eventType: string, payload: unknown) => Promise<void>;
  env: Record<string, string | undefined>;
  telemetry: TelemetryContext;
  auth: AuthContext;
  secrets: SecretsContext;
  config: ConfigContext;
  ai: AiContext;
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

function buildSecretsConfigAndAi(
  workspaceRoot: string | undefined,
  runtimeKind: RuntimeContext,
  store: RuntimeEnvStore,
  telemetry: TelemetryContext,
  options?: { mockAi?: boolean },
): {
  secrets: SecretsContext;
  config: ConfigContext;
  ai: AiContext;
  env: Record<string, string | undefined>;
} {
  const registry = workspaceRoot ? loadSecretRegistry(workspaceRoot) : null;
  const envSchema = workspaceRoot ? loadEnvSchema(workspaceRoot) : null;
  const bundle = createRuntimeSecretsBundle({
    store,
    registry,
    envSchema,
    runtimeKind,
  });

  const ai = createAiContext({
    secrets: bundle.secrets,
    telemetry,
    runtimeKind,
    mockAi: options?.mockAi ?? isMockAiEnabled(),
    envelope: {
      traceId: telemetry.traceId,
      tenantId:
        undefined,
    },
  });

  return {
    secrets: bundle.secrets,
    config: bundle.config,
    ai,
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
    mockAi?: boolean;
  },
): ForgeContext {
  const runtimeKind = options?.runtimeKind ?? "command";
  const store =
    options?.store ??
    (options?.workspaceRoot
      ? getRuntimeEnvStore(options.workspaceRoot)
      : getRuntimeEnvStore());
  const { secrets, config, ai, env } = buildSecretsConfigAndAi(
    options?.workspaceRoot,
    runtimeKind,
    store,
    telemetry,
    { mockAi: options?.mockAi },
  );

  return {
    db,
    env: options?.env ?? env,
    telemetry,
    auth,
    secrets,
    config,
    ai,
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
    mockAi?: boolean;
  },
): ForgeContext {
  const runtimeKind = options?.runtimeKind ?? "action";
  const store =
    options?.store ??
    (options?.workspaceRoot
      ? getRuntimeEnvStore(options.workspaceRoot)
      : getRuntimeEnvStore());
  const { secrets, config, ai, env } = buildSecretsConfigAndAi(
    options?.workspaceRoot,
    runtimeKind,
    store,
    telemetry,
    { mockAi: options?.mockAi },
  );

  return {
    db,
    env: options?.env ?? env,
    telemetry,
    auth,
    secrets,
    config,
    ai,
    emit: async () => {
      /* actions invoked by outbox worker do not emit */
    },
  };
}

export { createNoopTelemetryContext };
