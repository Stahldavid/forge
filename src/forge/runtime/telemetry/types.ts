export type TelemetryEnvelopeType =
  | "event"
  | "exception"
  | "log"
  | "span.start"
  | "span.end"
  | "workflow_step";

export type TelemetryEnvironment = "dev" | "test" | "preview" | "prod";

export type TelemetryRuntimeKind =
  | "command"
  | "action"
  | "workflow"
  | "endpoint"
  | "dev"
  | "query";

export interface ForgeTelemetryEnvelope {
  schemaVersion: "0.1";
  type: TelemetryEnvelopeType;
  traceId: string;
  requestId?: string;
  environment: TelemetryEnvironment;
  runtime: { kind: TelemetryRuntimeKind; name?: string };
  workflow?: { runId?: string; stepName?: string };
  outbox?: { eventId?: string; deliveryId?: string };
  release?: { releaseId?: string; deployId?: string; environment?: string };
  event?: { name: string; properties: Record<string, unknown> };
  exception?: { name?: string; message: string; stack?: string };
  log?: { level: string; message: string; fields?: Record<string, unknown> };
  span?: {
    spanId: string;
    parentSpanId?: string;
    name: string;
    attributes?: Record<string, unknown>;
  };
  createdAt: string;
}

export interface TelemetrySpanHandle {
  spanId: string;
  end: (attributes?: Record<string, unknown>) => Promise<void>;
}

export interface TelemetryContext {
  traceId: string;
  requestId?: string;
  capture: (name: string, properties?: Record<string, unknown>) => Promise<void>;
  captureException: (
    error: unknown,
    context?: Record<string, unknown>,
  ) => Promise<void>;
  log: (
    level: string,
    message: string,
    fields?: Record<string, unknown>,
  ) => Promise<void>;
  span: (
    name: string,
    attributes?: Record<string, unknown>,
  ) => Promise<TelemetrySpanHandle>;
  flush: (sink?: string) => Promise<void>;
}
