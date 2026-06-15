import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("ai dev server", () => {
  test("/health reports ai mode and providers", async () => {
    const workspace = scaffoldGenerateWorkspace("ai-dev");
    try {
      mkdirSync(join(workspace, "src", "ai"), { recursive: true });
      writeFileSync(
        join(workspace, "src", "ai", "supportAgent.ts"),
        `
          import { agent, aiTool } from "forge/server";
          import { z } from "zod";

          export const localContext = aiTool({
            description: "Return local context.",
            inputSchema: z.object({ topic: z.string().optional() }),
            risk: "read",
            needsApproval: false,
            handler: async (_ctx, input) => ({ topic: input.topic ?? "general" }),
          });

          export const supportAgent = agent({
            provider: "gateway",
            model: "openai/gpt-5.4",
            instructions: "Answer with the named support agent.",
            tools: { localContext },
            stopWhen: { kind: "stepCount", maxSteps: 3 },
          });
        `,
        "utf8",
      );
      await run(defaultGenerateOptions(workspace));

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        mockAi: true,
        json: false,
        db: "none",
      });

      try {
        const response = await fetch(`${handle.url}/health`);
        const body = (await response.json()) as {
          ai: { enabled: boolean; mode: string; providers: unknown[] };
        };

        expect(body.ai.enabled).toBe(true);
        expect(body.ai.mode).toBe("mock");
        expect(Array.isArray(body.ai.providers)).toBe(true);

        const agent = await fetch(`${handle.url}/ai/agents/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "gateway",
            model: "openai/gpt-5.4",
            agent: "supportAgent",
            instructions: "Reply briefly.",
            prompt: "ping",
            maxSteps: 2,
          }),
        });
        const agentBody = (await agent.json()) as {
          ok: boolean;
          traceId?: string;
          result?: { text?: string };
          tools?: string[];
        };
        expect(agent.status).toBe(200);
        expect(agentBody.ok).toBe(true);
        expect(agentBody.traceId).toBeDefined();
        expect(agentBody.result?.text).toBeString();
        expect(agentBody.tools).toContain("localContext");
        expect(agentBody.tools).toContain("forge_query_getUser");

        const chat = await fetch(`${handle.url}/ai/agents/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const chatBody = (await chat.json()) as {
          ok: boolean;
          diagnostics?: Array<{ message: string; fixHint?: string }>;
        };
        expect(chat.status).toBe(400);
        expect(chatBody.ok).toBe(false);
        expect(chatBody.diagnostics?.[0]?.message).toContain("UI messages");
        expect(chatBody.diagnostics?.[0]?.fixHint).toContain("@ai-sdk/react");
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
