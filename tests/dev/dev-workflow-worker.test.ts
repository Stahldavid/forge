import { describe, expect, test } from "bun:test";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldWorkflowWorkspace,
  writeTriageWorkflow,
} from "../workflows/helpers.ts";

describe("dev workflow worker", () => {
  test("forge dev workflow process endpoint completes workflow after createTicket", async () => {
    const { workspace, workflowsDir } = scaffoldWorkflowWorkspace("dev-wf-worker");
    writeTriageWorkflow(workflowsDir);

    try {
      expect((await run(defaultGenerateOptions(workspace))).exitCode).toBe(0);

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        db: "memory",
        worker: false,
      });

      try {
        const invoke = await fetch(`${handle.url}/commands/createTicket`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: { title: "workflow-worker" } }),
        });
        expect(invoke.status).toBe(200);

        const health = await fetch(`${handle.url}/health`);
        const healthBody = (await health.json()) as {
          workflows: { running: number; pending: number; dead: number };
        };
        expect(healthBody.workflows).toBeDefined();

        type ProcessBody = {
          ok: boolean;
          batch: { workflowBatch: { completed: number; runsStarted: number } };
        };
        let runsStarted = 0;
        let completed = 0;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const processed = await fetch(`${handle.url}/workflows/process`, { method: "POST" });
          expect(processed.status).toBe(200);
          const body = await processed.json() as ProcessBody;
          runsStarted += body.batch.workflowBatch.runsStarted;
          completed += body.batch.workflowBatch.completed;
          if (completed > 0) {
            break;
          }
        }

        expect(runsStarted).toBeGreaterThanOrEqual(1);
        expect(completed).toBeGreaterThanOrEqual(1);

        const runs = await fetch(`${handle.url}/workflows/runs`);
        const runsBody = (await runs.json()) as {
          runs: Array<{ status: string }>;
        };
        expect(runsBody.runs.some((runRow) => runRow.status === "completed")).toBe(true);
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 120000);
});
