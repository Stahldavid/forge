import { describe, expect, test } from "bun:test";
import { FORGE_TELEMETRY_SECRET_REDACTED } from "../../src/forge/compiler/diagnostics/codes.ts";
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
});
