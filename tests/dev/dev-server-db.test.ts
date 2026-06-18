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

describe("dev server db integration", () => {
  test("exposes db health and persists command invocations", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-server-db");
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
      join(commandsDir, "saveTicket.ts"),
      `
        import { command } from "forge/server";

        export const saveTicket = command({
          handler: async (ctx, args) => {
            const row = await ctx.db.tickets.insert({ title: args.title });
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

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        db: "memory",
      });

      try {
        const health = await fetch(`${handle.url}/health`);
        const healthBody = (await health.json()) as {
          db: { kind: string; connected: boolean };
        };
        expect(healthBody.db.kind).toBe("memory");
        expect(healthBody.db.connected).toBe(true);

        const invoke = await fetch(`${handle.url}/commands/saveTicket`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: { title: "from-http" } }),
        });

        expect(invoke.status).toBe(200);
        const invokeBody = (await invoke.json()) as {
          ok: boolean;
          result: { title: string };
        };
        expect(invokeBody.ok).toBe(true);
        expect(invokeBody.result.title).toBe("from-http");

        const tables = await fetch(`${handle.url}/db/tables`);
        const tablesBody = (await tables.json()) as { tables: string[] };
        expect(tablesBody.tables).toContain("tickets");
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
