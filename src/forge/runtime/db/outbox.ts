import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import { FORGE_DB_OUTBOX_WRITE_FAILED } from "../../compiler/diagnostics/codes.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { DbTransaction } from "./adapter.ts";

export async function insertOutbox(
  tx: DbTransaction,
  eventType: string,
  payload: unknown,
): Promise<{ ok: true } | { ok: false; diagnostic: Diagnostic }> {
  try {
    await tx.query(
      `INSERT INTO _forge_outbox (event_type, payload, status) VALUES ($1, $2::jsonb, 'pending')`,
      [eventType, JSON.stringify(payload)],
    );
    return { ok: true };
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
