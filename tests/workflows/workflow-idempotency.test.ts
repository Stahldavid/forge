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
import { startWorkflowRunsForPendingOutbox } from "../../src/forge/runtime/workflows/start-from-outbox.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldWorkflowWorkspace,
  writeTriageWorkflow,
} from "./helpers.ts";

describe("workflow idempotency", () => {
  test("same outbox event creates only one workflow run", async () => {
    const { workspace, workflowsDir } = scaffoldWorkflowWorkspace("wf-idem");
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
        args: { title: "idem" },
        db: adapter,
      });

      const first = await startWorkflowRunsForPendingOutbox(adapter, workspace);
      const second = await startWorkflowRunsForPendingOutbox(adapter, workspace);

      expect(first.started).toBe(1);
      expect(second.started).toBe(0);
      expect(second.skipped).toBe(1);

      const runs = await adapter.query(`SELECT COUNT(*)::int AS count FROM _forge_workflow_runs`);
      expect(Number(runs.rows[0]?.count)).toBe(1);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
