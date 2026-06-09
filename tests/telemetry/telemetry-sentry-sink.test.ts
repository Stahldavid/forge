import { describe, expect, test } from "bun:test";
import {
  sendToSentry,
  setSentryCaptureForTests,
} from "../../src/forge/runtime/telemetry/sinks/sentry.ts";
import type { ForgeTelemetryEnvelope } from "../../src/forge/runtime/telemetry/types.ts";

describe("telemetry sentry sink", () => {
  test("maps exception envelope to capture mock", async () => {
    const captured: Array<{ message: string; context?: Record<string, unknown> }> = [];
    setSentryCaptureForTests(async (error, context) => {
      captured.push({ message: error.message, context });
    });

    const envelope: ForgeTelemetryEnvelope = {
      schemaVersion: "0.1",
      type: "exception",
      traceId: "trace-se",
      environment: "test",
      runtime: { kind: "command", name: "createTicket" },
      exception: { message: "boom", name: "Error" },
      createdAt: new Date().toISOString(),
    };

    await sendToSentry(envelope, process.cwd());
    expect(captured).toHaveLength(1);
    expect(captured[0]?.message).toBe("boom");
    expect(captured[0]?.context?.traceId).toBe("trace-se");

    setSentryCaptureForTests(null);
  });
});
