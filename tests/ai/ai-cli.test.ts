import { describe, expect, test } from "bun:test";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { runAiCommand } from "../../src/forge/cli/ai.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("forge ai cli", () => {
  test(
    "providers and test --mock succeed after generate",
    async () => {
    const workspace = scaffoldGenerateWorkspace("ai-cli");
    try {
      await run(defaultGenerateOptions(workspace));

      const providers = await runAiCommand({
        subcommand: "providers",
        workspaceRoot: workspace,
        json: true,
      });
      expect(providers.exitCode).toBe(0);

      const test = await runAiCommand({
        subcommand: "test",
        workspaceRoot: workspace,
        json: true,
        provider: "openai",
        model: "gpt-4o-mini",
        prompt: "hello",
        mock: true,
      });
      expect(test.exitCode).toBe(0);
      expect((test.data as { text: string }).text).toContain("mock:");
    } finally {
      cleanupWorkspace(workspace);
    }
    },
    30_000,
  );
});
