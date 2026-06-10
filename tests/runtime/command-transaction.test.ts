import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("command transaction rollback", () => {
  test("rolls back row and outbox when handler throws", async () => {
    const workspace = scaffoldGenerateWorkspace("command-rollback");
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
          },
        });
      `,
      "utf8",
    );

    writeFileSync(
      join(commandsDir, "failingTicket.ts"),
      `
        import { command } from "forge/server";

        export const failingTicket = command({
          handler: async (ctx, args) => {
            await ctx.db.tickets.insert({ title: args.title });
            await ctx.emit("ticket.created", { title: args.title });
            throw new Error("boom");
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

      const result = await runEntry(workspace, "failingTicket", {
        json: false,
        mock: false,
        args: { title: "rollback-me" },
        db: adapter,
      });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);

      const tickets = await adapter.query(`SELECT * FROM tickets`);
      expect(tickets.rows).toHaveLength(0);

      const outbox = await adapter.query(`SELECT * FROM _forge_outbox`);
      expect(outbox.rows).toHaveLength(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
