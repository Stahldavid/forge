import { describe, expect, test } from "bun:test";
import {
  FORGE_TELEMETRY_PAYLOAD_TRUNCATED,
  FORGE_TELEMETRY_SECRET_REDACTED,
} from "../../src/forge/compiler/diagnostics/codes.ts";
import { scrubEnvelopePayload } from "../../src/forge/runtime/telemetry/scrubber.ts";

describe("telemetry scrubber", () => {
  test("redacts secret-like keys", () => {
    const { value, diagnostics } = scrubEnvelopePayload({
      schemaVersion: "0.1",
      type: "event",
      traceId: "abc",
      environment: "test",
      runtime: { kind: "command" },
      createdAt: new Date().toISOString(),
      event: {
        name: "login",
        properties: {
          password: "secret123",
          apiKey: "key",
          title: "hello",
        },
      },
    });

    const props = (value.event as { properties: Record<string, unknown> }).properties;
    expect(props.password).toBe("[REDACTED]");
    expect(props.apiKey).toBe("[REDACTED]");
    expect(props.title).toBe("hello");
    expect(diagnostics.some((d) => d.code === FORGE_TELEMETRY_SECRET_REDACTED)).toBe(true);
  });

  test("redacts nested agent tool payload secrets", () => {
    const { value, diagnostics } = scrubEnvelopePayload({
      schemaVersion: "0.1",
      type: "event",
      traceId: "agent-trace",
      environment: "test",
      runtime: { kind: "action" },
      createdAt: new Date().toISOString(),
      event: {
        name: "forge.ai.tool.started",
        properties: {
          tool: "deleteTicket",
          args: {
            authorization: "Bearer sk-live-never-emit",
            title: "safe ticket title",
            nested: {
              sessionToken: "session-never-emit",
            },
          },
        },
      },
    });

    const props = (value.event as { properties: Record<string, unknown> }).properties;
    const args = props.args as {
      authorization: string;
      title: string;
      nested: { sessionToken: string };
    };
    expect(args.authorization).toBe("[REDACTED]");
    expect(args.title).toBe("safe ticket title");
    expect(args.nested.sessionToken).toBe("[REDACTED]");
    expect(diagnostics.some((d) => d.code === FORGE_TELEMETRY_SECRET_REDACTED)).toBe(true);
  });

  test("summarizes oversized payloads without parsing truncated JSON", () => {
    const { value, diagnostics } = scrubEnvelopePayload({
      schemaVersion: "0.1",
      type: "event",
      traceId: "large-payload",
      environment: "test",
      runtime: { kind: "command" },
      createdAt: new Date().toISOString(),
      event: {
        name: "forge.large",
        properties: {
          artifacts: Array.from({ length: 200 }, (_, index) => ({
            path: `src/forge/_generated/artifact-${index}.json`,
            hash: "a".repeat(64),
          })),
        },
      },
    });

    const truncated = value as Record<string, unknown>;
    expect(truncated.truncated).toBe(true);
    expect(typeof truncated.hash).toBe("string");
    expect(truncated.summary).toMatchObject({
      event: { type: "object" },
    });
    expect(JSON.stringify(value)).not.toContain("artifact-199");
    expect(diagnostics.some((d) => d.code === FORGE_TELEMETRY_PAYLOAD_TRUNCATED)).toBe(true);
  });
});
