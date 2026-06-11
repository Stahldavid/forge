import { describe, expect, test } from "bun:test";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldWorkflowWorkspace,
  writeTriageWorkflow,
} from "../workflows/helpers.ts";

async function waitFor<T>(
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 90_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await producer();
  while (!predicate(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    last = await producer();
  }
  return last;
}

describe("dev workflow worker", () => {
  test("forge dev --worker completes workflow after createTicket", async () => {
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
        db: "pglite",
        worker: true,
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

        const runsBody = await waitFor(
          async () => {
            const runs = await fetch(`${handle.url}/workflows/runs`);
            return (await runs.json()) as {
              runs: Array<{ status: string }>;
            };
          },
          (body) => body.runs.some((runRow) => runRow.status === "completed"),
        );
        expect(runsBody.runs.some((runRow) => runRow.status === "completed")).toBe(true);
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 120000);
});
