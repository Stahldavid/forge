import type { DbClient } from "../db/generated-client.ts";
import type { DbTransaction } from "../db/adapter.ts";
import type { ActionSubscription } from "../../compiler/types/action-subscriptions.ts";
import type { TelemetryContext } from "../telemetry/types.ts";
import type { AuthContext } from "../auth/types.ts";
import { snapshotAuth } from "../auth/types.ts";
import { createNoopTelemetryContext } from "../telemetry/context.ts";
import { insertOutbox } from "../db/outbox.ts";

export interface ForgeContext {
  db: DbClient;
  emit: (eventType: string, payload: unknown) => Promise<void>;
  env: Record<string, string | undefined>;
  telemetry: TelemetryContext;
  auth: AuthContext;
}

export function createForgeContext(
  tx: DbTransaction,
  db: DbClient,
  subscriptions: ActionSubscription[],
  telemetry: TelemetryContext,
  auth: AuthContext,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): ForgeContext {
  return {
    db,
    env,
    telemetry,
    auth,
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
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): ForgeContext {
  return {
    db,
    env,
    telemetry,
    auth,
    emit: async () => {
      /* actions invoked by outbox worker do not emit */
    },
  };
}

export { createNoopTelemetryContext };
