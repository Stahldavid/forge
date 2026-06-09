import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import { FORGE_DB_OUTBOX_WRITE_FAILED } from "../../compiler/diagnostics/codes.ts";
import type { ActionSubscription } from "../../compiler/types/action-subscriptions.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { DbTransaction } from "../db/adapter.ts";

export interface OutboxInsertResult {
  outboxId: number;
}

export async function insertOutbox(
  tx: DbTransaction,
  eventType: string,
  payload: unknown,
  subscriptions: ActionSubscription[],
  authContext?: unknown,
): Promise<
  { ok: true; outboxId: number } | { ok: false; diagnostic: Diagnostic }
> {
  try {
    const outboxResult = await tx.query(
      `INSERT INTO _forge_outbox (event_type, payload, auth_context) VALUES ($1, $2::jsonb, $3::jsonb) RETURNING id`,
      [eventType, JSON.stringify(payload), JSON.stringify(authContext ?? null)],
    );

    const outboxId = Number(outboxResult.rows[0]?.id);
    if (!Number.isFinite(outboxId)) {
      throw new Error("outbox insert did not return id");
    }

    const matching = subscriptions.filter(
      (subscription) => subscription.eventType === eventType,
    );

    for (const subscription of matching) {
      await tx.query(
        `INSERT INTO _forge_outbox_deliveries (outbox_id, action_name, status) VALUES ($1, $2, 'pending')`,
        [outboxId, subscription.actionName],
      );
    }

    return { ok: true, outboxId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "outbox write failed";
    return {
      ok: false,
      diagnostic: createDiagnostic({
        severity: "error",
        code: FORGE_DB_OUTBOX_WRITE_FAILED,
        message,
      }),
    };
  }
}
