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

describe("outbox dead letter", () => {
  test("max attempts moves delivery to dead", async () => {
    const workspace = scaffoldGenerateWorkspace("outbox-dead");
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
            await ctx.emit("ticket.created", { id: row.id });
            return row;
          },
        });
      `,
      "utf8",
    );

    writeFileSync(
      join(actionsDir, "alwaysFail.ts"),
      `
        import { action } from "forge/server";
        export const alwaysFail = action({
          event: "ticket.created",
          handler: async () => { throw new Error("always fails"); },
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
        args: { title: "dead-letter" },
        db: adapter,
      });

      await adapter.query(
        `UPDATE _forge_outbox_deliveries SET max_attempts = $1 WHERE id = $2`,
        [2, Number((await adapter.query(`SELECT id FROM _forge_outbox_deliveries`)).rows[0]?.id)],
      );

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

      await processOutboxBatch(adapter, workspace, dbJson.tableMap, runtimeGraph.entries);
      await processOutboxBatch(adapter, workspace, dbJson.tableMap, runtimeGraph.entries);

      const delivery = await adapter.query(
        `SELECT status, attempts FROM _forge_outbox_deliveries`,
      );
      expect(delivery.rows[0]?.status).toBe("dead");
      expect(Number(delivery.rows[0]?.attempts)).toBeGreaterThanOrEqual(2);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
