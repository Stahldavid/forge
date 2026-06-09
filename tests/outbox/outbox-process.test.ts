import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import { processOutboxBatch } from "../../src/forge/runtime/outbox/process.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

function scaffoldOutboxWorkspace(prefix: string) {
  const workspace = scaffoldGenerateWorkspace(prefix);
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

  return { workspace, actionsDir };
}

describe("outbox process", () => {
  test("process --once runs subscribed action and marks delivery processed", async () => {
    const { workspace, actionsDir } = scaffoldOutboxWorkspace("outbox-process");

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
        args: { title: "process-me" },
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

      const batch = await processOutboxBatch(
        adapter,
        workspace,
        dbJson.tableMap,
        runtimeGraph.entries,
        { limit: 10 },
      );

      expect(batch.claimed).toBe(1);
      expect(batch.processed).toBe(1);

      const deliveries = await adapter.query(
        `SELECT status FROM _forge_outbox_deliveries`,
      );
      expect(deliveries.rows[0]?.status).toBe("processed");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("multiple actions for same event each get deliveries", async () => {
    const { workspace, actionsDir } = scaffoldOutboxWorkspace("outbox-multi");

    writeFileSync(
      join(actionsDir, "captureA.ts"),
      `
        import { action } from "forge/server";
        export const captureA = action({
          event: "ticket.created",
          handler: async () => ({ a: true }),
        });
      `,
      "utf8",
    );

    writeFileSync(
      join(actionsDir, "captureB.ts"),
      `
        import { action } from "forge/server";
        export const captureB = action({
          event: "ticket.created",
          handler: async () => ({ b: true }),
        });
      `,
      "utf8",
    );

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
        args: { title: "multi" },
        db: adapter,
      });

      const deliveries = await adapter.query(
        `SELECT action_name FROM _forge_outbox_deliveries ORDER BY action_name`,
      );
      expect(deliveries.rows).toHaveLength(2);
      expect(deliveries.rows.map((row) => row.action_name)).toEqual(["captureA", "captureB"]);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
