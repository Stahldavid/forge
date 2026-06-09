import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import {
  FORGE_TELEMETRY_SINK_FAILED,
  FORGE_TELEMETRY_UNKNOWN_SINK,
} from "../../compiler/diagnostics/codes.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { DbAdapter } from "../db/adapter.ts";
import type { ForgeTelemetryEnvelope } from "./types.ts";
import { writeLocalJsonl } from "./sinks/local-jsonl.ts";
import { sendToPosthog } from "./sinks/posthog.ts";
import { sendToSentry } from "./sinks/sentry.ts";

export interface FlushResult {
  processed: number;
  failed: number;
  diagnostics: Diagnostic[];
}

function parseEnvelope(payload: unknown): ForgeTelemetryEnvelope {
  if (typeof payload === "string") {
    return JSON.parse(payload) as ForgeTelemetryEnvelope;
  }
  return payload as ForgeTelemetryEnvelope;
}

async function dispatchToSink(
  sink: string,
  envelope: ForgeTelemetryEnvelope,
  workspaceRoot: string,
): Promise<void> {
  switch (sink) {
    case "local":
      await writeLocalJsonl(envelope, workspaceRoot);
      return;
    case "posthog":
      await sendToPosthog(envelope, workspaceRoot);
      return;
    case "sentry":
      await sendToSentry(envelope, workspaceRoot);
      return;
    default:
      throw new Error(`unknown telemetry sink '${sink}'`);
  }
}

export async function flushPendingTelemetry(
  adapter: DbAdapter,
  sink: string,
  workspaceRoot: string,
  limit = 100,
): Promise<FlushResult> {
  const diagnostics: Diagnostic[] = [];
  let processed = 0;
  let failed = 0;

  const pending = await adapter.query(
    `SELECT id, payload, attempts, max_attempts FROM _forge_telemetry_events
     WHERE status = 'pending' AND next_attempt_at <= now()
     ORDER BY id
     LIMIT $1`,
    [limit],
  );

  for (const row of pending.rows) {
    const id = Number(row.id);
    const attempts = Number(row.attempts ?? 0);
    const maxAttempts = Number(row.max_attempts ?? 5);

    try {
      const envelope = parseEnvelope(row.payload);
      await dispatchToSink(sink, envelope, workspaceRoot);

      await adapter.query(
        `UPDATE _forge_telemetry_events
         SET status = 'processed', sink = $1, processed_at = now(), last_error = NULL
         WHERE id = $2`,
        [sink, id],
      );
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "telemetry sink failed";
      const nextAttempts = attempts + 1;

      if (message.includes("unknown telemetry sink")) {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: FORGE_TELEMETRY_UNKNOWN_SINK,
            message,
          }),
        );
        failed += 1;
        break;
      }

      if (nextAttempts >= maxAttempts) {
        await adapter.query(
          `UPDATE _forge_telemetry_events
           SET status = 'failed', sink = $1, attempts = $2, last_error = $3, processed_at = now()
           WHERE id = $4`,
          [sink, nextAttempts, message, id],
        );
      } else {
        const nextAttemptAt = new Date(Date.now() + nextAttempts * 1_000).toISOString();
        await adapter.query(
          `UPDATE _forge_telemetry_events
           SET attempts = $1, last_error = $2, next_attempt_at = $3, sink = $4
           WHERE id = $5`,
          [nextAttempts, message, nextAttemptAt, sink, id],
        );
      }

      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: FORGE_TELEMETRY_SINK_FAILED,
          message: `telemetry sink '${sink}' failed for event ${id}: ${message}`,
        }),
      );
      failed += 1;
    }
  }

  return { processed, failed, diagnostics };
}

export async function getTelemetrySummary(adapter: DbAdapter): Promise<{
  pending: number;
  failed: number;
  processed: number;
}> {
  const result = await adapter.query(
    `SELECT status, COUNT(*)::int AS count FROM _forge_telemetry_events GROUP BY status`,
  );

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[String(row.status)] = Number(row.count);
  }

  return {
    pending: counts.pending ?? 0,
    failed: counts.failed ?? 0,
    processed: counts.processed ?? 0,
  };
}

export async function listTelemetryEvents(
  adapter: DbAdapter,
  limit = 100,
): Promise<Record<string, unknown>[]> {
  const result = await adapter.query(
    `SELECT id, trace_id, event_type, payload, status, sink, attempts, last_error, created_at, processed_at
     FROM _forge_telemetry_events
     ORDER BY id DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function inspectTrace(
  adapter: DbAdapter,
  traceId: string,
): Promise<{
  events: Record<string, unknown>[];
  spans: Record<string, unknown>[];
}> {
  const events = await adapter.query(
    `SELECT id, trace_id, event_type, payload, status, created_at
     FROM _forge_telemetry_events WHERE trace_id = $1 ORDER BY id`,
    [traceId],
  );
  const spans = await adapter.query(
    `SELECT id, trace_id, parent_span_id, span_id, name, kind, attributes, status, started_at, ended_at, error
     FROM _forge_trace_spans WHERE trace_id = $1 ORDER BY started_at`,
    [traceId],
  );

  return {
    events: events.rows,
    spans: spans.rows,
  };
}

export async function clearTelemetryEvents(adapter: DbAdapter): Promise<number> {
  const events = await adapter.query(`DELETE FROM _forge_telemetry_events`);
  await adapter.query(`DELETE FROM _forge_trace_spans`);
  return events.rowCount;
}
