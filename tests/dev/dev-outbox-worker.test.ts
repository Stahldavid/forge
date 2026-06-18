import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("dev outbox worker", () => {
  test("forge dev outbox process endpoint processes delivery after createTicket", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-outbox-worker");
    const commandsDir = join(workspace, "src", "commands");
    const actionsDir = join(workspace, "src", "actions");
    mkdirSync(commandsDir, { recursive: true });
    mkdirSync(actionsDir, { recursive: true });

    writeFileSync(
      join(workspace, "src", "forge", "schema.ts"),
      `
        import { defineTable } from "forge/server";
        export const tickets = defineTable({
          name: "tickets",
          fields: { id: "uuid", title: "text" },
        });
      `,
      "utf8",
    );

    writeFileSync(
      join(commandsDir, "createTicket.ts"),
      `
        import { command } from "forge/server";
        export const createTicket = command({
          handler: async (ctx, args) => {
            const row = await ctx.db.tickets.insert({ title: args.title });
            await ctx.emit("ticket.created", { id: row.id, title: row.title });
            return row;
          },
        });
      `,
      "utf8",
    );

    writeFileSync(
      join(actionsDir, "captureTicketCreated.ts"),
      `
        import { action } from "forge/server";
        export const captureTicketCreated = action({
          event: "ticket.created",
          handler: async (_ctx, event) => ({ captured: true, ticketId: event.id }),
        });
      `,
      "utf8",
    );

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
          body: JSON.stringify({ args: { title: "worker-test" } }),
        });
        expect(invoke.status).toBe(200);

        const health = await fetch(`${handle.url}/health`);
        const healthBody = (await health.json()) as {
          outbox: { worker: string; pending: number; dead: number };
        };
        expect(healthBody.outbox.worker).toBe("stopped");

        const processed = await fetch(`${handle.url}/outbox/process`, { method: "POST" });
        expect(processed.status).toBe(200);
        const processedBody = (await processed.json()) as {
          batch: { outbox: { processed: number; failed: number; dead: number; claimed: number } };
        };
        expect(processedBody.batch.outbox.claimed).toBeGreaterThanOrEqual(1);
        expect(processedBody.batch.outbox.processed).toBeGreaterThanOrEqual(1);
        expect(processedBody.batch.outbox.failed).toBe(0);
        expect(processedBody.batch.outbox.dead).toBe(0);

        const outbox = await fetch(`${handle.url}/outbox`);
        const outboxBody = (await outbox.json()) as {
          summary: { processed: number; pending: number };
        };
        expect(outboxBody.summary.processed).toBeGreaterThanOrEqual(1);
        expect(outboxBody.summary.pending).toBe(0);
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 120000);
});
