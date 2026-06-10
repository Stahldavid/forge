import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

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

describe("dev outbox worker", () => {
  test("forge dev --worker processes delivery after createTicket", async () => {
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
        db: "pglite",
        worker: true,
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
        expect(healthBody.outbox.worker).toBe("running");

        const outboxBody = await waitFor(
          async () => {
            const outbox = await fetch(`${handle.url}/outbox`);
            return (await outbox.json()) as {
              summary: { processed: number; pending: number };
            };
          },
          (body) => body.summary.processed >= 1 && body.summary.pending === 0,
        );
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
