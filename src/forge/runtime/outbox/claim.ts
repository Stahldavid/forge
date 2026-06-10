import type { DbAdapter } from "../db/adapter.ts";
import type { ClaimedDelivery, OutboxDeliveryRow } from "./types.ts";

function rowToDelivery(row: Record<string, unknown>): OutboxDeliveryRow {
  return {
    id: Number(row.id),
    outbox_id: Number(row.outbox_id),
    action_name: String(row.action_name),
    status: String(row.status) as OutboxDeliveryRow["status"],
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
    next_attempt_at: String(row.next_attempt_at),
    locked_at: row.locked_at != null ? String(row.locked_at) : null,
    locked_by: row.locked_by != null ? String(row.locked_by) : null,
    last_error: row.last_error != null ? String(row.last_error) : null,
    processed_at: row.processed_at != null ? String(row.processed_at) : null,
    created_at: String(row.created_at),
  };
}

export async function claimPendingDeliveries(
  adapter: DbAdapter,
  limit: number,
  workerId: string,
): Promise<ClaimedDelivery[]> {
  const pending = await adapter.query(
    `SELECT id, outbox_id, action_name, status, attempts, max_attempts, next_attempt_at, locked_at, locked_by, last_error, processed_at, created_at
     FROM _forge_outbox_deliveries
     WHERE status = 'pending' AND next_attempt_at <= now()
     ORDER BY id
     LIMIT $1`,
    [limit],
  );

  const claimed: ClaimedDelivery[] = [];

  for (const row of pending.rows) {
    const deliveryId = Number(row.id);
    const claimResult = await adapter.query(
      `UPDATE _forge_outbox_deliveries
       SET status = 'processing', locked_at = now(), locked_by = $1
       WHERE id = $2 AND status = 'pending'`,
      [workerId, deliveryId],
    );

    if (claimResult.rowCount === 0) {
      continue;
    }

    const eventResult = await adapter.query(
      `SELECT o.id, o.event_type, o.payload, o.auth_context, o.created_at
       FROM _forge_outbox o
       WHERE o.id = $1`,
      [Number(row.outbox_id)],
    );

    const eventRow = eventResult.rows[0];
    if (!eventRow) {
      continue;
    }

    let payload: unknown = eventRow.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = eventRow.payload;
      }
    }

    let authContext: unknown = eventRow.auth_context;
    if (typeof authContext === "string") {
      try {
        authContext = JSON.parse(authContext);
      } catch {
        authContext = eventRow.auth_context;
      }
    }

    claimed.push({
      ...rowToDelivery(row),
      event_type: String(eventRow.event_type),
      payload,
      auth_context: authContext,
    });
  }

  return claimed;
}

export async function markDeliveryProcessed(
  adapter: DbAdapter,
  deliveryId: number,
): Promise<void> {
  await adapter.query(
    `UPDATE _forge_outbox_deliveries
     SET status = 'processed', processed_at = now(), locked_at = NULL, locked_by = NULL
     WHERE id = $1`,
    [deliveryId],
  );
}

export async function markDeliveryRetry(
  adapter: DbAdapter,
  deliveryId: number,
  attempts: number,
  lastError: string,
  nextAttemptAt: string,
): Promise<void> {
  await adapter.query(
    `UPDATE _forge_outbox_deliveries
     SET status = 'pending', attempts = $1, last_error = $2, next_attempt_at = $3, locked_at = NULL, locked_by = NULL
     WHERE id = $4`,
    [attempts, lastError, nextAttemptAt, deliveryId],
  );
}

export async function markDeliveryDead(
  adapter: DbAdapter,
  deliveryId: number,
  lastError: string,
  attempts?: number,
): Promise<void> {
  if (attempts !== undefined) {
    await adapter.query(
      `UPDATE _forge_outbox_deliveries
       SET status = 'dead', attempts = $1, last_error = $2, locked_at = NULL, locked_by = NULL
       WHERE id = $3`,
      [attempts, lastError, deliveryId],
    );
    return;
  }

  await adapter.query(
    `UPDATE _forge_outbox_deliveries
     SET status = 'dead', last_error = $1, locked_at = NULL, locked_by = NULL
     WHERE id = $2`,
    [lastError, deliveryId],
  );
}

export async function resetDeliveryForRetry(
  adapter: DbAdapter,
  deliveryId: number,
): Promise<boolean> {
  const result = await adapter.query(
    `UPDATE _forge_outbox_deliveries
     SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL, locked_at = NULL, locked_by = NULL, processed_at = NULL
     WHERE id = $1`,
    [deliveryId],
  );
  return result.rowCount > 0;
}
