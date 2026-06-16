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

describe("security assurance: agent tools", () => {
  test("auto-tools expose approval and read/write risk boundaries", async () => {
    const workspace = scaffoldGenerateWorkspace("security-agent-auto-tools");

    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const registry = readGeneratedJson<{
        autoTools: Array<{
          needsApproval: boolean;
          readOnly: boolean;
          risk: "read" | "write";
          sourceKind: "command" | "query" | "liveQuery";
        }>;
      }>(workspace, "agentTools.json");

      const commandTool = registry.autoTools.find((tool) => tool.sourceKind === "command");
      const queryTool = registry.autoTools.find((tool) => tool.sourceKind === "query");
      const liveQueryTool = registry.autoTools.find((tool) => tool.sourceKind === "liveQuery");

      expect(commandTool).toMatchObject({
        needsApproval: true,
        readOnly: false,
        risk: "write",
      });
      expect(queryTool).toMatchObject({
        needsApproval: false,
        readOnly: true,
        risk: "read",
      });
      expect(liveQueryTool).toMatchObject({
        needsApproval: false,
        readOnly: true,
        risk: "read",
      });
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("destructive and external explicit tools retain approval metadata", async () => {
    const workspace = scaffoldGenerateWorkspace("security-agent-explicit-tools");
    const aiDir = join(workspace, "src", "ai");
    mkdirSync(aiDir, { recursive: true });
    writeFileSync(
      join(aiDir, "dangerousTools.ts"),
      `
        import { agent, aiTool } from "forge/server";
        import { z } from "zod";

        export const deleteTicket = aiTool({
          description: "Delete ticket permanently.",
          inputSchema: z.object({ ticketId: z.string() }),
          risk: "destructive",
          needsApproval: true,
          handler: async () => ({ ok: true }),
        });

        export const refundCustomer = aiTool({
          description: "Refund a customer with policy approval.",
          inputSchema: z.object({ amount: z.number() }),
          risk: "external",
          needsApproval: (args: { amount?: number }) => (args.amount ?? 0) > 0,
          handler: async () => ({ ok: true }),
        });

        export const safetyAgent = agent({
          provider: "gateway",
          model: "openai/gpt-5.4",
          instructions: "Use tools only with approval.",
          tools: { deleteTicket, refundCustomer },
          stopWhen: { kind: "stepCount", maxSteps: 3 },
        });
      `,
      "utf8",
    );

    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const contract = readGeneratedJson<{
        ai: {
          agents: Array<{ name: string; stopWhen: unknown }>;
          tools: Array<{ name: string; needsApproval: boolean | "dynamic"; risk: string }>;
        };
      }>(workspace, "agentContract.json");

      expect(contract.ai.tools).toContainEqual(
        expect.objectContaining({
          name: "deleteTicket",
          needsApproval: true,
          risk: "destructive",
        }),
      );
      expect(contract.ai.tools).toContainEqual(
        expect.objectContaining({
          name: "refundCustomer",
          needsApproval: "dynamic",
          risk: "external",
        }),
      );
      expect(contract.ai.agents).toContainEqual(
        expect.objectContaining({
          name: "safetyAgent",
          stopWhen: { kind: "stepCount", maxSteps: 3 },
        }),
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
