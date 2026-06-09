import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { processWorkflowStep } from "../../src/forge/runtime/workflows/process-step.ts";
import { loadWorkflowRegistry } from "../../src/forge/runtime/workflows/registry.ts";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import { buildSqlPlan } from "../../src/forge/compiler/data-graph/sql/ddl.ts";
import { enqueueMockAiResponse, resetMockAiQueue } from "../../src/forge/runtime/ai/mock.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldWorkflowWorkspace,
  writeTriageWorkflow,
} from "../workflows/helpers.ts";

describe("ai workflow integration", () => {
  test("triageWithAI uses ctx.ai in mock mode", async () => {
    const { workspace, workflowsDir } = scaffoldWorkflowWorkspace("ai-workflow");
    writeFileSync(
      join(workflowsDir, "triageTicketWorkflow.ts"),
      `
        import { event, step, workflow } from "forge/server";
        export const triageTicketWorkflow = workflow({
          trigger: event("ticket.created"),
          steps: [
            step("loadTicket", async (ctx) => ({ ticket: { title: "urgent outage" } })),
            step("triageWithAI", async (ctx) => {
              const result = await ctx.ai.generateText({
                provider: "openai",
                model: "gpt-4o-mini",
                prompt: "triage",
                purpose: "ticket_triage",
              });
              return { priority: result.text.includes("urgent") ? "high" : "normal" };
            }),
            step("captureAnalytics", async (ctx) => ({ captured: true })),
          ],
        });
      `,
      "utf8",
    );

    try {
      await run(defaultGenerateOptions(workspace));
      resetMockAiQueue();
      enqueueMockAiResponse({ text: "urgent", usage: { totalTokens: 10 } });

      const appGraph = await buildAppGraph({ workspaceRoot: workspace, sources: [] });
      const sqlPlan = buildSqlPlan(buildDataGraph(appGraph));
      const adapter = createMemoryAdapter();
      await applyMigrations(adapter, sqlPlan);

      const { workflows } = loadWorkflowRegistry(workspace);
      const workflow = workflows.find((w) => w.name === "triageTicketWorkflow");
      expect(workflow).toBeDefined();

      await adapter.query(
        `INSERT INTO _forge_workflow_runs (workflow_name, status, input, auth_context)
         VALUES ('triageTicketWorkflow', 'running', '{"id":"1"}', '{"kind":"system"}')
         RETURNING id`,
      );
      const runRow = await adapter.query(`SELECT * FROM _forge_workflow_runs LIMIT 1`);
      const runId = Number(runRow.rows[0]?.id);

      await adapter.query(
        `INSERT INTO _forge_workflow_steps (run_id, step_name, step_index, status, max_attempts)
         VALUES ($1, 'triageWithAI', 1, 'pending', 3)`,
        [runId],
      );
      const stepRow = await adapter.query(
        `SELECT * FROM _forge_workflow_steps WHERE run_id = $1`,
        [runId],
      );

      const result = await processWorkflowStep(
        adapter,
        workspace,
        {},
        workflow!,
        {
          id: runId,
          workflow_name: "triageTicketWorkflow",
          status: "running",
          input: { id: "1" },
          auth_context: { kind: "system" },
        },
        {
          id: Number(stepRow.rows[0]?.id),
          run_id: runId,
          step_name: "triageWithAI",
          step_index: 1,
          status: "pending",
          attempts: 0,
          max_attempts: 3,
          output: null,
          last_error: null,
        },
        true,
      );

      if (!result.ok) {
        throw new Error(result.error ?? "workflow step failed");
      }
      expect((result.output as { priority: string }).priority).toBe("high");
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
