import type { DbClient } from "../db/generated-client.ts";
import type { DbTransaction } from "../db/adapter.ts";
import type { ActionSubscription } from "../../compiler/types/action-subscriptions.ts";
import { insertOutbox } from "../db/outbox.ts";

export interface ForgeContext {
  db: DbClient;
  emit: (eventType: string, payload: unknown) => Promise<void>;
  env: Record<string, string | undefined>;
}

export function createForgeContext(
  tx: DbTransaction,
  db: DbClient,
  subscriptions: ActionSubscription[],
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): ForgeContext {
  return {
    db,
    env,
    emit: async (eventType, payload) => {
      const result = await insertOutbox(tx, eventType, payload, subscriptions);
      if (!result.ok) {
        throw new Error(result.diagnostic.message);
      }
    },
  };
}

export function createActionContext(
  db: DbClient,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): ForgeContext {
  return {
    db,
    env,
    emit: async () => {
      /* actions invoked by outbox worker do not emit */
    },
  };
}
