import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("ai registry generation", () => {
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
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
