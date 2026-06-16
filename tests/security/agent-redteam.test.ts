import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runAiCommand } from "../../src/forge/cli/ai.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("security assurance: agent redteam", () => {
  test("parseCli accepts forge ai redteam", () => {
    const parsed = parseCli(["ai", "redteam", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({ kind: "ai", subcommand: "redteam" });
  });

  test("parseCli accepts model-level redteam flags", () => {
    const parsed = parseCli([
      "ai",
      "redteam",
      "--model-level",
      "--live",
      "--provider",
      "gateway",
      "--model",
      "openai/gpt-5.4",
      "--json",
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "ai",
      subcommand: "redteam",
      modelLevel: true,
      live: true,
      provider: "gateway",
      model: "openai/gpt-5.4",
    });
  });

  test("passes safe generated and explicit tool metadata", async () => {
    const workspace = scaffoldGenerateWorkspace("security-agent-redteam-safe");
    const aiDir = join(workspace, "src", "ai");
    mkdirSync(aiDir, { recursive: true });
    writeFileSync(
      join(aiDir, "safeAgent.ts"),
      `
        import { agent, aiTool } from "forge/server";
        import { z } from "zod";

        export const lookupTicket = aiTool({
          description: "Read ticket summary.",
          inputSchema: z.object({ ticketId: z.string() }),
          risk: "read",
          needsApproval: false,
          strict: true,
          handler: async () => ({ ok: true }),
        });

        export const refundCustomer = aiTool({
          description: "Refund a customer.",
          inputSchema: z.object({ amount: z.number() }),
          risk: "external",
          needsApproval: true,
          strict: true,
          handler: async () => ({ ok: true }),
        });

        export const supportAgent = agent({
          provider: "gateway",
          model: "openai/gpt-5.4",
          instructions: "Use tools conservatively.",
          tools: { lookupTicket, refundCustomer },
          stopWhen: { kind: "stepCount", maxSteps: 3 },
        });
      `,
      "utf8",
    );

    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const result = await runAiCommand({
        subcommand: "redteam",
        workspaceRoot: workspace,
        json: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.data).toMatchObject({
        kind: "agent-redteam",
        ok: true,
        assurance: "structural-redteam",
      });
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("runs deterministic model-level prompt-injection probes without live provider calls", async () => {
    const workspace = scaffoldGenerateWorkspace("security-agent-redteam-model-level");
    const aiDir = join(workspace, "src", "ai");
    mkdirSync(aiDir, { recursive: true });
    writeFileSync(
      join(aiDir, "safeAgent.ts"),
      `
        import { agent, aiTool } from "forge/server";
        import { z } from "zod";

        export const lookupTicket = aiTool({
          description: "Read ticket summary.",
          inputSchema: z.object({ ticketId: z.string() }),
          risk: "read",
          needsApproval: false,
          strict: true,
          handler: async () => ({ ok: true }),
        });

        export const refundCustomer = aiTool({
          description: "Refund a customer.",
          inputSchema: z.object({ amount: z.number() }),
          risk: "external",
          needsApproval: true,
          strict: true,
          handler: async () => ({ ok: true }),
        });

        export const supportAgent = agent({
          provider: "gateway",
          model: "openai/gpt-5.4",
          instructions: "Use tools conservatively.",
          tools: { lookupTicket, refundCustomer },
          stopWhen: { kind: "stepCount", maxSteps: 3 },
        });
      `,
      "utf8",
    );

    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const result = await runAiCommand({
        subcommand: "redteam",
        workspaceRoot: workspace,
        json: true,
        modelLevel: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.data).toMatchObject({
        kind: "agent-redteam",
        ok: true,
        assurance: "model-level-mock",
        mode: {
          structural: true,
          modelLevel: true,
          modelExecution: "mock",
        },
      });
      const data = result.data as { modelScenarios?: Array<{ id: string; status: string; toolCalls: string[] }> };
      expect(data.modelScenarios?.map((scenario) => scenario.id)).toEqual([
        "model-prompt-injection",
        "model-secret-exfiltration",
        "model-approval-bypass",
        "model-cross-tenant",
        "model-indirect-tool-injection",
      ]);
      expect(data.modelScenarios?.every((scenario) => scenario.status === "passed")).toBe(true);
      expect(data.modelScenarios?.every((scenario) => scenario.toolCalls.length === 0)).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("fails unsafe approval, secret-like tool, and unbounded agent metadata", async () => {
    const workspace = scaffoldGenerateWorkspace("security-agent-redteam-unsafe");
    const aiDir = join(workspace, "src", "ai");
    mkdirSync(aiDir, { recursive: true });
    writeFileSync(
      join(aiDir, "unsafeAgent.ts"),
      `
        import { agent, aiTool } from "forge/server";
        import { z } from "zod";

        export const deleteTicket = aiTool({
          description: "Delete a ticket permanently.",
          inputSchema: z.object({ ticketId: z.string() }),
          risk: "destructive",
          needsApproval: false,
          handler: async () => ({ ok: true }),
        });

        export const revealApiKey = aiTool({
          description: "Reveal an API key.",
          inputSchema: z.object({}),
          risk: "read",
          needsApproval: false,
          handler: async () => ({ ok: true }),
        });

        export const unsafeAgent = agent({
          provider: "gateway",
          model: "openai/gpt-5.4",
          instructions: "Do everything.",
          tools: { deleteTicket, revealApiKey },
        });
      `,
      "utf8",
    );

    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const result = await runAiCommand({
        subcommand: "redteam",
        workspaceRoot: workspace,
        json: true,
      });
      expect(result.exitCode).toBe(1);
      expect(result.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("FORGE_AI_REDTEAM_FAILED");
      expect(JSON.stringify(result.data)).toContain("approval-bypass");
      expect(JSON.stringify(result.data)).toContain("secret-extraction-surface");
      expect(JSON.stringify(result.data)).toContain("excessive-agency");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
