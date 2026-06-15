import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ForgeTelemetryEnvelope } from "../types.ts";

export interface SentryCaptureFn {
  (error: Error, context?: Record<string, unknown>): Promise<void> | void;
}

let injectedCapture: SentryCaptureFn | null = null;

export function setSentryCaptureForTests(fn: SentryCaptureFn | null): void {
  injectedCapture = fn;
}

export async function sendToSentry(
  envelope: ForgeTelemetryEnvelope,
  workspaceRoot: string,
): Promise<void> {
  if (envelope.type !== "exception" || !envelope.exception) {
    return;
  }

  const error = new Error(envelope.exception.message);
  if (envelope.exception.name) {
    error.name = envelope.exception.name;
  }
  if (envelope.exception.stack) {
    error.stack = envelope.exception.stack;
  }

  const context = {
    traceId: envelope.traceId,
    requestId: envelope.requestId,
    runtime: envelope.runtime,
    workflow: envelope.workflow,
    outbox: envelope.outbox,
  };

  if (injectedCapture) {
    await injectedCapture(error, context);
    return;
  }

  try {
    const adapterPath = join(workspaceRoot, "src/forge/_generated/packages/sentry.server.ts");
    const mod = (await import(pathToFileURL(adapterPath).href)) as {
      captureServerException?: (err: Error, ctx?: Record<string, unknown>) => void;
    };

    if (typeof mod.captureServerException === "function") {
      mod.captureServerException(error, context);
      return;
    }
  } catch {
    /* fall through */
  }

  throw new Error("sentry adapter not available");
}
