import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import { buildSqlPlan } from "../../src/forge/compiler/data-graph/sql/ddl.ts";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { adapterAsTransaction } from "../../src/forge/runtime/db/adapter.ts";
import { insertOutbox } from "../../src/forge/runtime/db/outbox.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import { fixtureWorkspaceRoot } from "../data-graph/helpers.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("outbox", () => {
  test("inserts event and pending deliveries", async () => {
    const adapter = createMemoryAdapter();
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [],
    });
    const plan = buildSqlPlan(buildDataGraph(appGraph));
    await applyMigrations(adapter, plan);

    const subscriptions = [
      {
        eventType: "ticket.created",
        actionName: "captureTicketCreated",
        exportName: "captureTicketCreated",
        file: "src/actions/captureTicketCreated.ts",
        symbolId: "sym-1",
      },
    ];

    const tx = adapterAsTransaction(adapter);
    const result = await insertOutbox(tx, "ticket.created", { id: "1" }, subscriptions);
    expect(result.ok).toBe(true);

    const rows = await adapter.query(`SELECT event_type FROM _forge_outbox`);
    expect(rows.rows[0]?.event_type).toBe("ticket.created");

    const deliveries = await adapter.query(
      `SELECT action_name, status FROM _forge_outbox_deliveries`,
    );
    expect(deliveries.rows).toHaveLength(1);
    expect(deliveries.rows[0]?.action_name).toBe("captureTicketCreated");
    expect(deliveries.rows[0]?.status).toBe("pending");
  });

  test("createTicket emits outbox event and delivery rows", async () => {
    const workspace = scaffoldGenerateWorkspace("outbox-create-ticket");
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
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const subs = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, GENERATED_DIR, "actionSubscriptions.json"), "utf8"),
        ),
      );
      expect(
        subs.subscriptions.some(
          (subscription: { actionName: string }) =>
            subscription.actionName === "captureTicketCreated",
        ),
      ).toBe(true);

      const adapter = createMemoryAdapter();
      const sqlPlan = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, GENERATED_DIR, "sqlPlan.json"), "utf8"),
        ),
      ) as SqlPlan;
      await applyMigrations(adapter, sqlPlan);

      const result = await runEntry(workspace, "createTicket", {
        json: false,
        mock: false,
        args: { title: "outbox-test" },
        db: adapter,
      });
      expect(result.ok).toBe(true);

      const outbox = await adapter.query(`SELECT event_type FROM _forge_outbox`);
      expect(outbox.rows).toHaveLength(1);

      const deliveries = await adapter.query(
        `SELECT action_name FROM _forge_outbox_deliveries`,
      );
      expect(deliveries.rows).toHaveLength(1);
      expect(deliveries.rows[0]?.action_name).toBe("captureTicketCreated");
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
