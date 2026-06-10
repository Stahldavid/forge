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
import { runWorkerTick } from "../../src/forge/runtime/workflows/process.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldWorkflowWorkspace,
  writeTriageWorkflow,
} from "./helpers.ts";

describe("workflow process", () => {
  test("steps execute in order and persist outputs", async () => {
    const { workspace, workflowsDir } = scaffoldWorkflowWorkspace("wf-process");
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

      await runEntry(workspace, "createTicket", {
        json: false,
        mock: false,
        args: { title: "workflow-process" },
        db: adapter,
      });

      const runtimeGraph = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, GENERATED_DIR, "runtimeGraph.json"), "utf8"),
        ),
      );
      const dbJson = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, GENERATED_DIR, "db.json"), "utf8"),
        ),
      );

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const tick = await runWorkerTick(
          adapter,
          workspace,
          dbJson.tableMap,
          runtimeGraph.entries,
          { limit: 10 },
        );
        if (tick.workflowBatch.completed >= 1) {
          break;
        }
      }

      const runResult = await adapter.query(
        `SELECT status FROM _forge_workflow_runs ORDER BY id DESC LIMIT 1`,
      );
      expect(runResult.rows[0]?.status).toBe("completed");

      const steps = await adapter.query(
        `SELECT step_name, status, output FROM _forge_workflow_steps ORDER BY step_index`,
      );
      expect(steps.rows.every((row) => row.status === "completed")).toBe(true);
      expect(steps.rows[2]?.step_name).toBe("captureAnalytics");
      expect(steps.rows[2]?.output).toBeTruthy();
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
