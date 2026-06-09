import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import { processWorkflowBatch } from "../../src/forge/runtime/workflows/process.ts";
import { startWorkflowRunsForPendingOutbox } from "../../src/forge/runtime/workflows/start-from-outbox.ts";
import { retryWorkflowRun } from "../../src/forge/runtime/workflows/retry-run.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldWorkflowWorkspace,
  writeTriageWorkflow,
} from "./helpers.ts";

describe("workflow retry", () => {
  test("step failure retries then goes dead after max attempts", async () => {
    const { workspace, workflowsDir } = scaffoldWorkflowWorkspace("wf-retry");
    writeTriageWorkflow(workflowsDir, { failingStep: "triageWithAI" });

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

      await runEntry(workspace, "createTicket", {
        json: false,
        mock: false,
        args: { title: "retry-me" },
        db: adapter,
      });
      await startWorkflowRunsForPendingOutbox(adapter, workspace);

      const runs = await adapter.query(
        `SELECT id FROM _forge_workflow_runs ORDER BY id DESC LIMIT 1`,
      );
      const runId = Number(runs.rows[0]?.id);
      expect(Number.isFinite(runId)).toBe(true);

      let step = await adapter.query(
        `SELECT status, attempts FROM _forge_workflow_steps WHERE run_id = $1 AND step_name = 'loadTicket'`,
        [runId],
      );

      for (let attempt = 0; attempt < 6; attempt += 1) {
        await processWorkflowBatch(adapter, workspace, dbJson.tableMap, { limit: 10 });
        step = await adapter.query(
          `SELECT status, attempts FROM _forge_workflow_steps WHERE run_id = $1 AND step_name = 'triageWithAI'`,
          [runId],
        );
        if (step.rows[0]?.status === "dead") {
          break;
        }
      }

      expect(step.rows[0]?.status).toBe("dead");

      await retryWorkflowRun(adapter, runId, "triageWithAI");
      await processWorkflowBatch(adapter, workspace, dbJson.tableMap, { limit: 10 });

      const retried = await adapter.query(
        `SELECT status FROM _forge_workflow_steps WHERE run_id = $1 AND step_name = 'triageWithAI'`,
        [runId],
      );
      expect(["pending", "running", "dead", "completed"]).toContain(retried.rows[0]?.status);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
