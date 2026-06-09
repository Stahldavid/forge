import { describe, expect, test } from "bun:test";
import { createAiContext } from "../../src/forge/runtime/ai/context.ts";
import { createSecretsContext } from "../../src/forge/runtime/secrets/create-context.ts";
import { createNoopTelemetryContext } from "../../src/forge/runtime/telemetry/context.ts";
import { enqueueMockAiResponse, resetMockAiQueue } from "../../src/forge/runtime/ai/mock.ts";

describe("ai context", () => {
  test("generateText returns mock response in mock mode", async () => {
    resetMockAiQueue();
    enqueueMockAiResponse({ text: "urgent priority", usage: { totalTokens: 12 } });

    const secrets = createSecretsContext({
      store: {
        loadedFiles: [],
        resolve: () => undefined,
        snapshot: () => ({}),
      },
      registryNames: new Set(),
      runtimeKind: "workflow",
    });

    const ai = createAiContext({
      secrets,
      telemetry: createNoopTelemetryContext("trace-1"),
      runtimeKind: "workflow",
      mockAi: true,
    });

    const result = await ai.generateText({
      provider: "openai",
      model: "gpt-4o-mini",
      prompt: "triage",
      purpose: "ticket_triage",
    });

    expect(result.text).toBe("urgent priority");
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
