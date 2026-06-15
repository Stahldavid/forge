import { describe, expect, test } from "bun:test";
import { createAiContext } from "../../src/forge/runtime/ai/context.ts";
import { createSecretsContext } from "../../src/forge/runtime/secrets/create-context.ts";
import { createNoopTelemetryContext } from "../../src/forge/runtime/telemetry/context.ts";
import { enqueueMockAiResponse, resetMockAiQueue } from "../../src/forge/runtime/ai/mock.ts";
import { createActionContext } from "../../src/forge/runtime/context/create-context.ts";

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

  test("runAgent returns mock response in mock mode", async () => {
    resetMockAiQueue();
    enqueueMockAiResponse({ text: "agent done", usage: { totalTokens: 21 } });

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
      telemetry: createNoopTelemetryContext("trace-agent"),
      runtimeKind: "workflow",
      mockAi: true,
    });

    const result = await ai.runAgent({
      provider: "gateway",
      model: "openai/gpt-5.4",
      instructions: "Use project-safe tools.",
      prompt: "finish",
      maxSteps: 3,
    });

    expect(result.text).toBe("agent done");
    expect(result.provider).toBe("gateway");
    expect(result.steps).toBe(1);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });

  test("action context exposes ctx.agent.run alias", async () => {
    resetMockAiQueue();
    enqueueMockAiResponse({ text: "alias done", usage: { totalTokens: 17 } });

    const ctx = createActionContext(
      {} as never,
      createNoopTelemetryContext("trace-agent-alias"),
      { kind: "user", userId: "user_1", tenantId: "tenant_1", roles: ["member"], permissions: [] },
      {
        mockAi: true,
        runtimeKind: "workflow",
        store: {
          loadedFiles: [],
          resolve: () => undefined,
          snapshot: () => ({}),
        },
      },
    );

    const result = await ctx.agent.run({
      provider: "gateway",
      model: "openai/gpt-5.4",
      instructions: "Use project-safe tools.",
      prompt: "finish",
    });

    expect(result.text).toBe("alias done");
    expect(result.provider).toBe("gateway");
    expect(result.steps).toBe(1);
  });
});
