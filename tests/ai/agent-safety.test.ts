import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

function readGeneratedJson<T>(workspace: string, artifact: string): T {
  return JSON.parse(
    stripDeterministicHeader(
      readFileSync(join(workspace, "src", "forge", "_generated", artifact), "utf8"),
    ),
  ) as T;
}

function readGeneratedText(workspace: string, artifact: string): string {
  return stripDeterministicHeader(
    readFileSync(join(workspace, "src", "forge", "_generated", artifact), "utf8"),
  );
}

describe("agent safety", () => {
  test("explicit AI tools preserve risk, approval, strictness, and stop conditions", async () => {
    const workspace = scaffoldGenerateWorkspace("agent-safety-tools");
    const aiDir = join(workspace, "src", "ai");
    mkdirSync(aiDir, { recursive: true });
    writeFileSync(
      join(aiDir, "supportAgent.ts"),
      `
        import { agent, aiTool } from "forge/server";
        import { z } from "zod";

        const requiresApproval = (args: { amount?: number }) => (args.amount ?? 0) > 100;

        export const lookupTicket = aiTool({
          description: "Read ticket summary.",
          inputSchema: z.object({ ticketId: z.string() }),
          outputSchema: z.object({ ok: z.boolean() }),
          risk: "read",
          strict: true,
          needsApproval: false,
          handler: async () => ({ ok: true }),
        });

        export const deleteTicket = aiTool({
          description: "Delete a ticket permanently.",
          inputSchema: z.object({ ticketId: z.string() }),
          outputSchema: z.object({ deleted: z.boolean() }),
          risk: "destructive",
          strict: true,
          needsApproval: true,
          handler: async () => ({ deleted: true }),
        });

        export const refundCustomer = aiTool({
          description: "Refund a customer conditionally.",
          inputSchema: z.object({ amount: z.number() }),
          outputSchema: z.object({ refunded: z.boolean() }),
          risk: "external",
          needsApproval: requiresApproval,
          handler: async () => ({ refunded: true }),
        });

        export const supportAgent = agent({
          provider: "gateway",
          model: "openai/gpt-5.4",
          instructions: "Use safe tools only.",
          tools: { lookupTicket, deleteTicket, refundCustomer },
          stopWhen: { kind: "stepCount", maxSteps: 4 },
        });
      `,
      "utf8",
    );

    try {
      const result = await run(defaultGenerateOptions(workspace));
      expect(result.exitCode).toBe(0);

      const aiRegistry = readGeneratedJson<{
        tools: Array<{
          name: string;
          risk: string;
          strict: boolean;
          needsApproval: boolean | "dynamic";
        }>;
        agents: Array<{ name: string; tools: string[]; stopWhen: unknown }>;
      }>(workspace, "aiRegistry.json");
      expect(aiRegistry.tools).toContainEqual(
        expect.objectContaining({
          name: "lookupTicket",
          risk: "read",
          strict: true,
          needsApproval: false,
        }),
      );
      expect(aiRegistry.tools).toContainEqual(
        expect.objectContaining({
          name: "deleteTicket",
          risk: "destructive",
          strict: true,
          needsApproval: true,
        }),
      );
      expect(aiRegistry.tools).toContainEqual(
        expect.objectContaining({
          name: "refundCustomer",
          risk: "external",
          needsApproval: "dynamic",
        }),
      );
      expect(aiRegistry.agents).toContainEqual(
        expect.objectContaining({
          name: "supportAgent",
          tools: ["deleteTicket", "lookupTicket", "refundCustomer"],
          stopWhen: { kind: "stepCount", maxSteps: 4 },
        }),
      );

      const contract = readGeneratedJson<{
        ai: {
          tools: Array<{ name: string; risk: string; needsApproval: boolean | "dynamic" }>;
          agents: Array<{ name: string; stopWhen: unknown }>;
        };
      }>(workspace, "agentContract.json");
      expect(contract.ai.tools).toContainEqual(
        expect.objectContaining({ name: "deleteTicket", risk: "destructive", needsApproval: true }),
      );
      expect(contract.ai.tools).toContainEqual(
        expect.objectContaining({ name: "refundCustomer", risk: "external", needsApproval: "dynamic" }),
      );
      expect(contract.ai.agents).toContainEqual(
        expect.objectContaining({ name: "supportAgent", stopWhen: { kind: "stepCount", maxSteps: 4 } }),
      );

      const agentTools = readGeneratedJson<{
        explicitTools: Array<{ name: string; risk: string; needsApproval: boolean | "dynamic" }>;
      }>(workspace, "agentTools.json");
      expect(agentTools.explicitTools).toContainEqual(
        expect.objectContaining({ name: "deleteTicket", risk: "destructive", needsApproval: true }),
      );
      expect(agentTools.explicitTools).toContainEqual(
        expect.objectContaining({ name: "refundCustomer", risk: "external", needsApproval: "dynamic" }),
      );

      const agentToolsMd = readGeneratedText(workspace, "agentTools.md");
      expect(agentToolsMd).toContain("Risk: destructive");
      expect(agentToolsMd).toContain("Needs approval: true");
      expect(agentToolsMd).toContain("Needs approval: dynamic");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
