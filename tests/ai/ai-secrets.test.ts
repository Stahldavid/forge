import { describe, expect, test } from "bun:test";
import { createAiContext } from "../../src/forge/runtime/ai/context.ts";
import { createSecretsContext } from "../../src/forge/runtime/secrets/create-context.ts";
import { createNoopTelemetryContext } from "../../src/forge/runtime/telemetry/context.ts";
import { FORGE_AI_SECRET_MISSING } from "../../src/forge/compiler/diagnostics/codes.ts";

describe("ai secrets", () => {
  test("missing OPENAI_API_KEY throws FORGE_AI_SECRET_MISSING", async () => {
    delete process.env.FORGE_MOCK_AI;
    const secrets = createSecretsContext({
      store: {
        loadedFiles: [],
        resolve: () => undefined,
        snapshot: () => ({}),
      },
      registryNames: new Set(["OPENAI_API_KEY"]),
      runtimeKind: "action",
      requiredSecrets: [{ name: "OPENAI_API_KEY", required: true }],
    });

    const ai = createAiContext({
      secrets,
      telemetry: createNoopTelemetryContext("trace-1"),
      runtimeKind: "action",
      mockAi: false,
    });

    await expect(
      ai.generateText({
        provider: "openai",
        model: "gpt-4o-mini",
        prompt: "hello",
      }),
    ).rejects.toMatchObject({ code: FORGE_AI_SECRET_MISSING });
  });
});
