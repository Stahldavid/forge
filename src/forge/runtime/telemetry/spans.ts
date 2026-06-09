import type { DbAdapter, DbTransaction } from "../db/adapter.ts";
import type { TelemetryRuntimeKind } from "./types.ts";

type QueryTarget = DbTransaction | DbAdapter;

export async function startTraceSpan(
  target: QueryTarget,
  input: {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: TelemetryRuntimeKind;
    attributes?: Record<string, unknown>;
    startedAt?: string;
  },
): Promise<void> {
  await target.query(
    `INSERT INTO _forge_trace_spans (trace_id, parent_span_id, span_id, name, kind, attributes, status, started_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'ok', $7)`,
    [
      input.traceId,
      input.parentSpanId ?? null,
      input.spanId,
      input.name,
      input.kind,
      JSON.stringify(input.attributes ?? {}),
      input.startedAt ?? new Date().toISOString(),
    ],
  );
}

export async function endTraceSpan(
  target: QueryTarget,
  input: {
    traceId: string;
    spanId: string;
    attributes?: Record<string, unknown>;
    error?: string;
    endedAt?: string;
  },
): Promise<void> {
  const status = input.error ? "error" : "ok";
  await target.query(
    `UPDATE _forge_trace_spans
     SET ended_at = $1, status = $2, error = $3,
         attributes = COALESCE(attributes, '{}'::jsonb) || $4::jsonb
     WHERE trace_id = $5 AND span_id = $6`,
    [
      input.endedAt ?? new Date().toISOString(),
      status,
      input.error ?? null,
      JSON.stringify(input.attributes ?? {}),
      input.traceId,
      input.spanId,
    ],
  );
}
