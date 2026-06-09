import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { createWorkflowRun } from "../../src/forge/runtime/workflows/create-run.ts";
import { cancelWorkflowRun } from "../../src/forge/runtime/workflows/cancel.ts";
import { processWorkflowBatch } from "../../src/forge/runtime/workflows/process.ts";
import { loadWorkflowRegistry } from "../../src/forge/runtime/workflows/registry.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldWorkflowWorkspace,
  writeTriageWorkflow,
} from "./helpers.ts";

describe("workflow cancel", () => {
  test("cancel stops pending steps from processing", async () => {
    const { workspace, workflowsDir } = scaffoldWorkflowWorkspace("wf-cancel");
    writeTriageWorkflow(workflowsDir);

    try {
      expect((await run(defaultGenerateOptions(workspace))).exitCode).toBe(0);

      const adapter = createMemoryAdapter();
      const sqlPlan = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, GENERATED_DIR, "sqlPlan.json"), "utf8"),
        ),
      ) as SqlPlan;
      await applyMigrations(adapter, sqlPlan);

      const dbJson = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, GENERATED_DIR, "db.json"), "utf8"),
        ),
      );

      const { workflows } = loadWorkflowRegistry(workspace);
      const created = await createWorkflowRun(adapter, workflows, {
        workflowName: "triageTicketWorkflow",
        input: { id: "ticket-cancel", title: "cancel" },
        triggerType: "manual",
        idempotencyKey: "triageTicketWorkflow:manual:cancel",
      });

      const canceled = await cancelWorkflowRun(adapter, created.run.id);
      expect(canceled).toBe(true);

      await processWorkflowBatch(adapter, workspace, dbJson.tableMap, { limit: 10 });

      const run = await adapter.query(
        `SELECT status FROM _forge_workflow_runs WHERE id = $1`,
        [created.run.id],
      );
      expect(run.rows[0]?.status).toBe("canceled");

      const steps = await adapter.query(
        `SELECT status FROM _forge_workflow_steps WHERE run_id = $1`,
        [created.run.id],
      );
      expect(steps.rows.every((row) => row.status === "skipped")).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
