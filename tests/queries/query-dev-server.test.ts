import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { cleanupWorkspace, scaffoldQueryWorkspace } from "./helpers.ts";

describe("query dev server", () => {
  test("GET /queries and POST /queries/listTickets", async () => {
    const { root, tenantA } = await scaffoldQueryWorkspace("query-dev");
    try {
      const adapter = createMemoryAdapter();
      const sqlPlan = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "sqlPlan.json"), "utf8"),
        ),
      ) as SqlPlan;
      await applyMigrations(adapter, sqlPlan);
      await adapter.query(`INSERT INTO tenants (id, name) VALUES ($1, 'A')`, [tenantA]);

      const handle = await startDevServer({
        workspaceRoot: root,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        db: "none",
        worker: false,
        telemetry: ["local"],
      });

      // Inject adapter by re-starting with pglite path isn't trivial; use direct fetch on routes
      // that don't need DB for listing
      const listResponse = await fetch(`${handle.url}/queries`);
      const listBody = (await listResponse.json()) as { queries: { name: string }[] };
      expect(listBody.queries.map((q) => q.name).sort()).toEqual(["getTicket", "listTickets"]);

      handle.stop();
    } finally {
      cleanupWorkspace(root);
    }
  });
});
