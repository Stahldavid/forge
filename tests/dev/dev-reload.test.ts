import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { ensureGeneratedForDev } from "../../src/forge/cli/dev.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("forge dev reload", () => {
  test("reload applies migrations after generated schema changes", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-reload-migrate");
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
        writeFileSync(
          join(workspace, "src", "forge", "schema.ts"),
          `
            import { defineTable } from "forge/schema";
            export const users = defineTable("users", { id: "string" });
            export const widgets = defineTable("widgets", { id: "string", title: "string" });
          `,
          "utf8",
        );
        const generated = await ensureGeneratedForDev(workspace);
        expect(generated.exitCode).toBe(0);
        expect(generated.changed).toContain("src/forge/_generated/dataGraph.json");

        const reload = await handle.reload("test");
        expect(reload.ok).toBe(true);
        expect(reload.migrated).toBe(true);

        const tables = await handle.state.adapter?.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
        );
        expect(tables?.rows.map((row) => String(row.table_name))).toContain("widgets");
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("db tables endpoint works with pglite catalog", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-reload-pglite-tables");
    try {
      expect((await run(defaultGenerateOptions(workspace))).exitCode).toBe(0);
      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        db: "pglite",
        worker: false,
      });

      try {
        const response = await fetch(`${handle.url}/db/tables`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { tables: string[] };
        expect(body.tables).toContain("users");
        expect(body.tables).toContain("_forge_migrations");
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
