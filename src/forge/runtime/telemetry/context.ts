import type { DbAdapter, DbTransaction } from "../db/adapter.ts";
import { insertTelemetryEvent } from "./buffer.ts";
import { generateSpanId } from "./correlation.ts";
import { endTraceSpan, startTraceSpan } from "./spans.ts";
import type {
  ForgeTelemetryEnvelope,
  TelemetryContext,
  TelemetryEnvironment,
  TelemetryRuntimeKind,
} from "./types.ts";
import { flushPendingTelemetry } from "./flush.ts";

export interface CreateTelemetryContextOptions {
  adapter: DbAdapter;
  tx?: DbTransaction;
  traceId: string;
  requestId?: string;
  runtime: { kind: TelemetryRuntimeKind; name?: string };
  workflow?: ForgeTelemetryEnvelope["workflow"];
  outbox?: ForgeTelemetryEnvelope["outbox"];
  /** When true, events are written through tx (commands). When false, writes go to adapter immediately. */
  bufferInTransaction?: boolean;
  workspaceRoot?: string;
  /** Sinks to flush when flush() is called */
  sinks?: string[];
}

function resolveEnvironment(): TelemetryEnvironment {
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

function writeTarget(options: CreateTelemetryContextOptions): DbTransaction | DbAdapter {
  if (options.bufferInTransaction && options.tx) {
    return options.tx;
  }
  return options.adapter;
}

function baseEnvelope(
  options: CreateTelemetryContextOptions,
  type: ForgeTelemetryEnvelope["type"],
): Omit<ForgeTelemetryEnvelope, "event" | "exception" | "log" | "span"> {
  return {
    schemaVersion: "0.1",
    type,
    traceId: options.traceId,
    requestId: options.requestId,
    environment: resolveEnvironment(),
    runtime: options.runtime,
    ...(options.workflow ? { workflow: options.workflow } : {}),
    ...(options.outbox ? { outbox: options.outbox } : {}),
    createdAt: new Date().toISOString(),
  };
}

export function createTelemetryContext(
  options: CreateTelemetryContextOptions,
): TelemetryContext {
  const target = () => writeTarget(options);
  let currentSpanId: string | undefined;

  return {
    traceId: options.traceId,
    requestId: options.requestId,

    async capture(name, properties = {}) {
      const envelope: ForgeTelemetryEnvelope = {
        ...baseEnvelope(options, "event"),
        event: { name, properties },
      };
      await insertTelemetryEvent(target(), envelope);
    },

    async captureException(error, context = {}) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;

      const envelope: ForgeTelemetryEnvelope = {
        ...baseEnvelope(options, "exception"),
        event: undefined,
        exception: {
          name: errorName,
          message,
          stack,
        },
        ...(Object.keys(context).length > 0
          ? {
              log: {
                level: "error",
                message,
                fields: context,
              },
            }
          : {}),
      };
      await insertTelemetryEvent(target(), envelope);
    },

    async log(level, message, fields = {}) {
      const envelope: ForgeTelemetryEnvelope = {
        ...baseEnvelope(options, "log"),
        log: { level, message, fields },
      };
      await insertTelemetryEvent(target(), envelope);
    },

    async span(name, attributes = {}) {
      const spanId = generateSpanId();
      const parentSpanId = currentSpanId;
      currentSpanId = spanId;

      await startTraceSpan(target(), {
        traceId: options.traceId,
        spanId,
        parentSpanId,
        name,
        kind: options.runtime.kind,
        attributes,
      });

      const spanEnvelope: ForgeTelemetryEnvelope = {
        ...baseEnvelope(options, "span.start"),
        span: { spanId, parentSpanId, name, attributes },
      };
      await insertTelemetryEvent(target(), spanEnvelope);

      return {
        spanId,
        end: async (endAttributes = {}) => {
          await endTraceSpan(target(), {
            traceId: options.traceId,
            spanId,
            attributes: endAttributes,
          });

          const endEnvelope: ForgeTelemetryEnvelope = {
            ...baseEnvelope(options, "span.end"),
            span: { spanId, parentSpanId, name, attributes: endAttributes },
          };
          await insertTelemetryEvent(target(), endEnvelope);

          if (currentSpanId === spanId) {
            currentSpanId = parentSpanId;
          }
        },
      };
    },

    async flush(sink) {
      const sinks = sink ? [sink] : (options.sinks ?? ["local"]);
      for (const sinkName of sinks) {
        await flushPendingTelemetry(
          options.adapter,
          sinkName,
          options.workspaceRoot ?? process.cwd(),
        );
      }
    },
  };
}

export function createNoopTelemetryContext(traceId: string): TelemetryContext {
  const noop = async () => {
    /* no-op without db */
  };
  const noopSpan = async () => ({
    spanId: "noop",
    end: noop,
  });

  return {
    traceId,
    capture: noop,
    captureException: noop,
    log: noop,
    span: noopSpan,
    flush: noop,
  };
}
