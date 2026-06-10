import type { DbAdapter, DbTransaction } from "../db/adapter.ts";
import type { ForgeTelemetryEnvelope } from "./types.ts";
import { scrubEnvelopePayload } from "./scrubber.ts";

type QueryTarget = DbTransaction | DbAdapter;

async function runQuery(
  target: QueryTarget,
  sql: string,
  params: unknown[],
) {
  return target.query(sql, params);
}

export async function insertTelemetryEvent(
  target: QueryTarget,
  envelope: ForgeTelemetryEnvelope,
): Promise<number> {
  const { value } = scrubEnvelopePayload(envelope as unknown as Record<string, unknown>);
  const eventName =
    typeof value.event === "object" &&
    value.event !== null &&
    "name" in value.event
      ? String((value.event as { name: unknown }).name)
      : undefined;

  const result = await runQuery(
    target,
    `INSERT INTO _forge_telemetry_events (trace_id, event_type, payload, status)
     VALUES ($1, $2, $3::jsonb, 'pending')
     RETURNING id`,
    [value.traceId, eventName ?? value.type, JSON.stringify(value)],
  );

  const id = Number(result.rows[0]?.id);
  if (!Number.isFinite(id)) {
    throw new Error("telemetry insert did not return id");
  }
  return id;
}

export async function recordExceptionOutsideTx(
  adapter: DbAdapter,
  error: unknown,
  traceId: string,
  runtime: ForgeTelemetryEnvelope["runtime"],
  correlation: {
    requestId?: string;
    deliveryId?: string;
    workflow?: ForgeTelemetryEnvelope["workflow"];
  } = {},
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const name = error instanceof Error ? error.name : undefined;

  const envelope: ForgeTelemetryEnvelope = {
    schemaVersion: "0.1",
    type: "exception",
    traceId,
    requestId: correlation.requestId,
    environment: resolveEnvironment(),
    runtime,
    ...(correlation.workflow ? { workflow: correlation.workflow } : {}),
    ...(correlation.deliveryId
      ? { outbox: { deliveryId: correlation.deliveryId } }
      : {}),
    exception: { name, message, stack },
    createdAt: new Date().toISOString(),
  };

  await insertTelemetryEvent(adapter, envelope);
}

function resolveEnvironment(): ForgeTelemetryEnvelope["environment"] {
  const raw = process.env.FORGE_ENV ?? process.env.NODE_ENV ?? "dev";
  if (raw === "production" || raw === "prod") {
    return "prod";
  }
  if (raw === "test") {
    return "test";
  }
  if (raw === "preview") {
    return "preview";
  }
  return "dev";
}
