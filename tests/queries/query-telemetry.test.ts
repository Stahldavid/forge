import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runQuery } from "../../src/forge/runtime/query/run-query.ts";
import { cleanupWorkspace, scaffoldQueryWorkspace } from "./helpers.ts";

describe("query telemetry", () => {
  test("emits forge.query.started and forge.query.completed with traceId", async () => {
    const { root, tenantA } = await scaffoldQueryWorkspace("query-telemetry");
    try {
      const adapter = createMemoryAdapter();
      const sqlPlan = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "sqlPlan.json"), "utf8"),
        ),
      ) as SqlPlan;
      await applyMigrations(adapter, sqlPlan);

      await adapter.query(`INSERT INTO tenants (id, name) VALUES ($1, 'A')`, [tenantA]);

      const tableMap = JSON.parse(
        stripDeterministicHeader(readFileSync(join(root, GENERATED_DIR, "db.json"), "utf8")),
      ).tableMap;

      const result = await runQuery(
        root,
        "listTickets",
        { auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" } },
        { adapter, tableMap },
      );

      expect(result.ok).toBe(true);
      expect(result.traceId).toBeDefined();

      const rows = await adapter.query(
        `SELECT payload FROM _forge_telemetry_events WHERE trace_id = $1`,
        [result.traceId],
      );
      const names = rows.rows.map((row) => {
        const payload =
          typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
        return payload?.event?.name as string;
      });

      expect(names).toContain("forge.query.started");
      expect(names).toContain("forge.query.completed");
    } finally {
      cleanupWorkspace(root);
    }
  });
});
