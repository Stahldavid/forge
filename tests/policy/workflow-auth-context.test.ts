import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import { startWorkflowRunsForPendingOutbox } from "../../src/forge/runtime/workflows/start-from-outbox.ts";
import { cleanupWorkspace, scaffoldPolicyWorkspace } from "./helpers.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { defaultGenerateOptions } from "../orchestrator/helpers.ts";

describe("workflow auth context", () => {
  test("stores outbox auth snapshot on workflow run", async () => {
    const { root, tenantA } = await scaffoldPolicyWorkspace("workflow-auth");
    const workflowsDir = join(root, "src", "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(workflowsDir, "onTicketCreated.ts"),
      `
        import { event, step, workflow } from "forge/server";
        export const onTicketCreated = workflow({
          trigger: event("ticket.created"),
          steps: [
            step("noop", async (ctx) => ({ authKind: ctx.auth.kind })),
          ],
        });
      `,
      "utf8",
    );
    await run(defaultGenerateOptions(root));

    try {
      const adapter = createMemoryAdapter();
      const sqlPlan = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "sqlPlan.json"), "utf8"),
        ),
      ) as SqlPlan;
      await applyMigrations(adapter, sqlPlan);
      await adapter.query(`INSERT INTO tenants (id, name) VALUES ($1, $2)`, [tenantA, "A"]);

      const result = await runEntry(root, "createTicket", {
        json: false,
        mock: false,
        db: adapter,
        args: { title: "wf-auth" },
        userId: "user-a",
        tenantId: tenantA,
        role: "member",
      });
      expect(result.ok).toBe(true);

      await startWorkflowRunsForPendingOutbox(adapter, root);

      const runs = await adapter.query(`SELECT auth_context FROM _forge_workflow_runs LIMIT 1`);
      const authContext = runs.rows[0]?.auth_context;
      const parsed =
        typeof authContext === "string" ? JSON.parse(authContext) : authContext;

      expect(parsed?.kind).toBe("user");
      expect(parsed?.tenantId).toBe(tenantA);
    } finally {
      cleanupWorkspace(root);
    }
  });
});
