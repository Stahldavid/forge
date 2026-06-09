import type { DbClient } from "../db/generated-client.ts";
import type { DbTransaction } from "../db/adapter.ts";
import type { ActionSubscription } from "../../compiler/types/action-subscriptions.ts";
import type { TelemetryContext } from "../telemetry/types.ts";
import { createNoopTelemetryContext } from "../telemetry/context.ts";
import { insertOutbox } from "../db/outbox.ts";

export interface ForgeContext {
  db: DbClient;
  emit: (eventType: string, payload: unknown) => Promise<void>;
  env: Record<string, string | undefined>;
  telemetry: TelemetryContext;
}

export function createForgeContext(
  tx: DbTransaction,
  db: DbClient,
  subscriptions: ActionSubscription[],
  telemetry: TelemetryContext,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): ForgeContext {
  return {
    db,
    env,
    telemetry,
    emit: async (eventType, payload) => {
      const enriched =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? { ...(payload as Record<string, unknown>), traceId: telemetry.traceId }
          : { value: payload, traceId: telemetry.traceId };

      const result = await insertOutbox(tx, eventType, enriched, subscriptions);
      if (!result.ok) {
        throw new Error(result.diagnostic.message);
      }
    },
  };
}

export function createActionContext(
  db: DbClient,
  telemetry: TelemetryContext,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): ForgeContext {
  return {
    db,
    env,
    telemetry,
    emit: async () => {
      /* actions invoked by outbox worker do not emit */
    },
  };
}

export { createNoopTelemetryContext };
