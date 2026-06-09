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

describe("query run", () => {
  test("listTickets returns tenant-scoped rows", async () => {
    const { root, tenantA } = await scaffoldQueryWorkspace("query-run");
    try {
      const adapter = createMemoryAdapter();
      const sqlPlan = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "sqlPlan.json"), "utf8"),
        ),
      ) as SqlPlan;
      await applyMigrations(adapter, sqlPlan);

      await adapter.query(`INSERT INTO tenants (id, name) VALUES ($1, 'A')`, [tenantA]);
      await adapter.query(
        `INSERT INTO tickets (id, tenant_id, title, status) VALUES ($1, $2, 'one', 'open')`,
        ["t1", tenantA],
      );

      const result = await runQuery(
        root,
        "listTickets",
        {
          auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" },
        },
        {
          adapter,
          tableMap: JSON.parse(
            stripDeterministicHeader(readFileSync(join(root, GENERATED_DIR, "db.json"), "utf8")),
          ).tableMap,
        },
      );

      expect(result.ok).toBe(true);
      expect(result.traceId).toBeDefined();
      expect(Array.isArray(result.result)).toBe(true);
      expect((result.result as unknown[]).length).toBe(1);
    } finally {
      cleanupWorkspace(root);
    }
  });
});
