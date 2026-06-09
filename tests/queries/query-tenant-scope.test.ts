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

describe("query tenant scope", () => {
  test("only returns rows for the caller tenant", async () => {
    const { root, tenantA, tenantB } = await scaffoldQueryWorkspace("query-tenant");
    try {
      const adapter = createMemoryAdapter();
      const sqlPlan = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "sqlPlan.json"), "utf8"),
        ),
      ) as SqlPlan;
      await applyMigrations(adapter, sqlPlan);

      await adapter.query(`INSERT INTO tenants (id, name) VALUES ($1, 'A'), ($2, 'B')`, [
        tenantA,
        tenantB,
      ]);
      await adapter.query(
        `INSERT INTO tickets (id, tenant_id, title, status) VALUES ($1, $2, 'a', 'open'), ($3, $4, 'b', 'open')`,
        ["t-a", tenantA, "t-b", tenantB],
      );

      const tableMap = JSON.parse(
        stripDeterministicHeader(readFileSync(join(root, GENERATED_DIR, "db.json"), "utf8")),
      ).tableMap;

      const resultA = await runQuery(
        root,
        "listTickets",
        { auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" } },
        { adapter, tableMap },
      );

      expect(resultA.ok).toBe(true);
      expect((resultA.result as unknown[]).length).toBe(1);
    } finally {
      cleanupWorkspace(root);
    }
  });
});
