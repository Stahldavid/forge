import type { DbClient } from "../db/generated-client.ts";
import type { DbTransaction } from "../db/adapter.ts";
import { insertOutbox } from "../db/outbox.ts";

export interface ForgeContext {
  db: DbClient;
  emit: (eventType: string, payload: unknown) => Promise<void>;
  env: Record<string, string | undefined>;
}

export function createForgeContext(
  tx: DbTransaction,
  db: DbClient,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): ForgeContext {
  return {
    db,
    env,
    emit: async (eventType, payload) => {
      const result = await insertOutbox(tx, eventType, payload);
      if (!result.ok) {
        throw new Error(result.diagnostic.message);
      }
    },
  };
}
