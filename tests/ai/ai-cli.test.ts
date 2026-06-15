import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { runAiCommand, summarizeAiTrace } from "../../src/forge/cli/ai.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("forge ai cli", () => {
  test("parses ai trace and summarizes AI telemetry events", () => {
    const parsed = parseCli(["ai", "trace", "trace-ai-1", "--db", "pglite", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "ai",
      subcommand: "trace",
      traceId: "trace-ai-1",
      db: "pglite",
      json: true,
    });

    const summary = summarizeAiTrace("trace-ai-1", {
      events: [
        {
          id: 1,
          status: "pending",
          created_at: "2026-01-01T00:00:00.000Z",
          payload: {
            event: {
              name: "forge.ai.agent.started",
              properties: { provider: "gateway", model: "openai/gpt-5.4" },
            },
          },
        },
        {
          id: 2,
          status: "pending",
          created_at: "2026-01-01T00:00:01.000Z",
          payload: {
            event: {
              name: "forge.ai.tool.completed",
              properties: { tool: "lookupTicket", status: "completed" },
            },
          },
        },
        {
          id: 3,
          status: "pending",
          created_at: "2026-01-01T00:00:02.000Z",
          payload: {
            event: {
              name: "forge.policy.denied",
              properties: {},
            },
          },
        },
      ],
      spans: [],
    });

    expect(summary.events.map((event) => event.name)).toEqual([
      "forge.ai.agent.started",
      "forge.ai.tool.completed",
    ]);
    expect(summary.agents).toHaveLength(1);
    expect(summary.tools).toHaveLength(1);
  });

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
