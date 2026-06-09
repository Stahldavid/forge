import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("command persistence", () => {
  test("persists ticket row and outbox event", async () => {
    const workspace = scaffoldGenerateWorkspace("command-persistence");
    const commandsDir = join(workspace, "src", "commands");
    mkdirSync(commandsDir, { recursive: true });

    writeFileSync(
      join(workspace, "src", "forge", "schema.ts"),
      `
        import { defineTable } from "forge/server";
        export const tickets = defineTable({
          name: "tickets",
          fields: {
            id: "uuid",
            title: "text",
            status: "text",
          },
        });
      `,
      "utf8",
    );

    writeFileSync(
      join(commandsDir, "persistTicket.ts"),
      `
        import { command } from "forge/server";

        export const persistTicket = command({
          handler: async (ctx, args) => {
            const row = await ctx.db.tickets.insert({
              title: args.title,
              status: "open",
            });
            await ctx.emit("ticket.created", { id: row.id });
            return row;
          },
        });
      `,
      "utf8",
    );

    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const adapter = createMemoryAdapter();
      const sqlPlan = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, GENERATED_DIR, "sqlPlan.json"), "utf8"),
        ),
      ) as SqlPlan;
      await applyMigrations(adapter, sqlPlan);

      const result = await runEntry(workspace, "persistTicket", {
        json: false,
        mock: false,
        args: { title: "hello" },
        db: adapter,
      });

      expect(result.exitCode).toBe(0);
      expect(result.ok).toBe(true);

      const tickets = await adapter.query(`SELECT title FROM tickets`);
      expect(tickets.rows).toHaveLength(1);

      const outbox = await adapter.query(`SELECT event_type FROM _forge_outbox`);
      expect(outbox.rows[0]?.event_type).toBe("ticket.created");
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
