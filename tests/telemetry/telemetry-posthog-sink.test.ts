import { describe, expect, test } from "bun:test";
import {
  sendToPosthog,
  setPosthogCaptureForTests,
} from "../../src/forge/runtime/telemetry/sinks/posthog.ts";
import type { ForgeTelemetryEnvelope } from "../../src/forge/runtime/telemetry/types.ts";

describe("telemetry posthog sink", () => {
  test("maps event envelope to capture mock", async () => {
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    setPosthogCaptureForTests(async (event, properties) => {
      captured.push({ event, properties });
    });

    const envelope: ForgeTelemetryEnvelope = {
      schemaVersion: "0.1",
      type: "event",
      traceId: "trace-ph",
      environment: "test",
      runtime: { kind: "action", name: "captureTicketCreated" },
      event: { name: "ticket_created_action", properties: { ticketId: "1" } },
      createdAt: new Date().toISOString(),
    };

    await sendToPosthog(envelope, process.cwd());
    expect(captured).toHaveLength(1);
    expect(captured[0]?.event).toBe("ticket_created_action");
    expect(captured[0]?.properties.traceId).toBe("trace-ph");

    setPosthogCaptureForTests(null);
  });
});
