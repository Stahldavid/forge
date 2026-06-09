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
import { loadWorkflowRegistry } from "../../src/forge/runtime/workflows/registry.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldWorkflowWorkspace,
  writeTriageWorkflow,
} from "./helpers.ts";

describe("workflow run create", () => {
  test("createWorkflowRun inserts run and step rows", async () => {
    const { workspace, workflowsDir } = scaffoldWorkflowWorkspace("wf-create");
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

      const { workflows } = loadWorkflowRegistry(workspace);
      const result = await createWorkflowRun(adapter, workflows, {
        workflowName: "triageTicketWorkflow",
        input: { id: "ticket-1", title: "demo" },
        triggerType: "manual",
        idempotencyKey: "triageTicketWorkflow:manual:test",
      });

      expect(result.created).toBe(true);
      expect(result.run.workflow_name).toBe("triageTicketWorkflow");

      const steps = await adapter.query(
        `SELECT step_name, step_index, status FROM _forge_workflow_steps WHERE run_id = $1 ORDER BY step_index`,
        [result.run.id],
      );
      expect(steps.rows).toHaveLength(3);
      expect(steps.rows[0]?.step_name).toBe("loadTicket");
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
