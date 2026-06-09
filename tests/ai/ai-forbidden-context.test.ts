import { describe, expect, test } from "bun:test";
import { createAiContext } from "../../src/forge/runtime/ai/context.ts";
import { createSecretsContext } from "../../src/forge/runtime/secrets/create-context.ts";
import { createNoopTelemetryContext } from "../../src/forge/runtime/telemetry/context.ts";
import { FORGE_AI_FORBIDDEN_CONTEXT } from "../../src/forge/compiler/diagnostics/codes.ts";
import { runCheckCommand } from "../../src/forge/cli/commands.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("ai forbidden context", () => {
  test("runtime ctx.ai throws in command context", async () => {
    const secrets = createSecretsContext({
      store: {
        loadedFiles: [],
        resolve: () => "sk-test",
        snapshot: () => ({ OPENAI_API_KEY: "sk-test" }),
      },
      registryNames: new Set(),
      runtimeKind: "command",
    });

    const ai = createAiContext({
      secrets,
      telemetry: createNoopTelemetryContext("trace-1"),
      runtimeKind: "command",
    });

    await expect(
      ai.generateText({
        provider: "openai",
        model: "gpt-4o-mini",
        prompt: "nope",
      }),
    ).rejects.toMatchObject({ code: FORGE_AI_FORBIDDEN_CONTEXT });
  });

  test("forge check flags ctx.ai in command source", async () => {
    const workspace = scaffoldGenerateWorkspace("ai-forbidden");
    writeFileSync(
      join(workspace, "src", "forge", "commands.ts"),
      `
        import { command } from "forge/server";
        export const bad = command({
          handler: async (ctx) => {
            await ctx.ai.generateText({
              provider: "openai",
              model: "gpt-4o-mini",
              prompt: "bad",
            });
          },
        });
      `,
      "utf8",
    );

    try {
      await run(defaultGenerateOptions(workspace));
      const result = await runCheckCommand(workspace);
      expect(
        result.errors.some((d) => d.code === FORGE_AI_FORBIDDEN_CONTEXT),
      ).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
