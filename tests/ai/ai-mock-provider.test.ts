import { describe, expect, test } from "bun:test";
import {
  createMockAiProvider,
  dequeueMockAiResponse,
} from "../../src/forge/runtime/ai/mock.ts";
import { estimateCostUsd } from "../../src/forge/runtime/ai/cost-estimator.ts";

describe("ai mock provider", () => {
  test("createMockAiProvider queues deterministic responses", () => {
    const mock = createMockAiProvider();
    mock.enqueue({ text: "first" });
    mock.enqueue({ text: "second" });

    expect(dequeueMockAiResponse().text).toBe("first");
    expect(dequeueMockAiResponse().text).toBe("second");
    mock.reset();
    expect(dequeueMockAiResponse().text).toBe("mock-ai-response");
  });

  test("known model returns cost estimate, unknown returns undefined", () => {
    const known = estimateCostUsd("openai", "gpt-4o-mini", {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });
    expect(known).toBeGreaterThan(0);

    const unknown = estimateCostUsd("openai", "unknown-model", {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });
    expect(unknown).toBeUndefined();
  });
});
