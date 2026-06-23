import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { detectCtxAiUsage, parseAiCallsFromSlice } from "../../src/forge/compiler/ai-registry/parse.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("ai registry generation", () => {
  test("ignores ctx.ai mentions inside strings and comments", () => {
    const docsOnly = `
      // ctx.ai.generateText({ provider: "openai" })
      const docs = "Use ctx.ai.generateText({ provider, model, prompt }) in actions.";
      const markdown = \`ctx.ai.generateStructured({ provider, model, schema })\`;
    `;

    expect(detectCtxAiUsage(docsOnly)).toBe(false);
    expect(parseAiCallsFromSlice(docsOnly)).toEqual([]);

    const realCall = `
      await ctx.ai.generateText({
        provider: "gateway",
        model: "openai/gpt-4o-mini",
        prompt: "triage",
      });
    `;
    expect(detectCtxAiUsage(realCall)).toBe(true);
    expect(parseAiCallsFromSlice(realCall)).toContainEqual(
      expect.objectContaining({
        method: "generateText",
        provider: "gateway",
        model: "openai/gpt-4o-mini",
      }),
    );
  });

  test("emits aiRegistry, aiProviders, and aiModels artifacts", async () => {
    const workspace = scaffoldGenerateWorkspace("ai-registry");
    const workflowsDir = join(workspace, "src", "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(workflowsDir, "triage.ts"),
      `
        import { event, step, workflow } from "forge/server";
        export const triage = workflow({
          trigger: event("ticket.created"),
          steps: [
            step("triageWithAI", async (ctx) => {
              await ctx.ai.generateText({
                provider: "openai",
                model: "gpt-4o-mini",
                prompt: "triage",
                purpose: "ticket_triage",
              });
              await ctx.agent.run({
                provider: "gateway",
                model: "openai/gpt-5.4",
                instructions: "Use project-safe tools.",
                prompt: "finish",
                purpose: "agent_triage",
              });
              return { ok: true };
            }),
          ],
        });
      `,
      "utf8",
    );

    try {
      const result = await run(defaultGenerateOptions(workspace));
      expect(result.exitCode).toBe(0);
      expect(result.changed.some((p) => p.includes("aiRegistry.json"))).toBe(true);
      expect(result.changed.some((p) => p.includes("aiProviders.json"))).toBe(true);
      expect(result.changed.some((p) => p.includes("aiModels.json"))).toBe(true);
      const aiRegistry = JSON.parse(
        stripDeterministicHeader(
          await Bun.file(join(workspace, "src", "forge", "_generated", "aiRegistry.json")).text(),
        ),
      ) as { generations: Array<{ method: string; purpose?: string }> };
      expect(aiRegistry.generations).toContainEqual(
        expect.objectContaining({ method: "runAgent", purpose: "agent_triage" }),
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("emits Forge AI tools and agents", async () => {
    const workspace = scaffoldGenerateWorkspace("ai-tools-agents");
    const aiDir = join(workspace, "src", "ai");
    mkdirSync(aiDir, { recursive: true });
    writeFileSync(
      join(aiDir, "supportAgent.ts"),
      `
        import { agent, aiTool } from "forge/server";
        import { z } from "zod";

        export const lookupTicket = aiTool({
          description: "Look up a support ticket summary.",
          inputSchema: z.object({ ticketId: z.string() }),
          outputSchema: z.object({ title: z.string() }),
          risk: "read",
          strict: true,
          needsApproval: false,
          handler: async (_ctx, args) => ({ title: args.ticketId }),
        });

        export const supportAgent = agent({
          provider: "gateway",
          model: "openai/gpt-5.4",
          instructions: "Resolve support questions with project-safe tools.",
          tools: { lookupTicket },
          stopWhen: { kind: "stepCount", maxSteps: 6 },
        });
      `,
      "utf8",
    );

    try {
      const result = await run(defaultGenerateOptions(workspace));
      expect(result.exitCode).toBe(0);

      const aiRegistry = JSON.parse(
        stripDeterministicHeader(
          await Bun.file(join(workspace, "src", "forge", "_generated", "aiRegistry.json")).text(),
        ),
      ) as {
        tools: Array<{ name: string; risk: string; strict: boolean }>;
        agents: Array<{ name: string; model: string; tools: string[] }>;
      };

      expect(aiRegistry.tools).toContainEqual(
        expect.objectContaining({
          name: "lookupTicket",
          risk: "read",
          strict: true,
        }),
      );
      expect(aiRegistry.agents).toContainEqual(
        expect.objectContaining({
          name: "supportAgent",
          model: "openai/gpt-5.4",
          tools: ["lookupTicket"],
        }),
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
