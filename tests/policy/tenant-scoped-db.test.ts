import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTableMap } from "../../src/forge/compiler/data-graph/sql/serialize.ts";
import { buildSqlPlan } from "../../src/forge/compiler/data-graph/sql/ddl.ts";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import { adapterAsTransaction } from "../../src/forge/runtime/db/adapter.ts";
import { createGeneratedDbClient } from "../../src/forge/runtime/db/generated-client.ts";
import { cleanupWorkspace, scaffoldPolicyWorkspace } from "./helpers.ts";

describe("tenant scoped db", () => {
  test("scopes reads and writes to auth tenant", async () => {
    const { root, tenantA, tenantB } = await scaffoldPolicyWorkspace("tenant-scoped-db");
    try {
      const raw = stripDeterministicHeader(
        readFileSync(join(root, GENERATED_DIR, "tenantScope.json"), "utf8"),
      );
      const tenantScope = JSON.parse(raw) as { tables: { table: string }[] };
      expect(tenantScope.tables.some((table) => table.table === "tickets")).toBe(true);

      const adapter = createMemoryAdapter();
      const sqlPlan = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "sqlPlan.json"), "utf8"),
        ),
      ) as SqlPlan;
      await applyMigrations(adapter, sqlPlan);

      await adapter.query(`INSERT INTO tenants (id, name) VALUES ($1, $2)`, [tenantA, "A"]);
      await adapter.query(`INSERT INTO tenants (id, name) VALUES ($1, $2)`, [tenantB, "B"]);

      const created = await runEntry(root, "createTicket", {
        json: false,
        mock: false,
        db: adapter,
        args: { title: "scoped" },
        userId: "user-a",
        tenantId: tenantA,
        role: "member",
      });
      expect(created.ok).toBe(true);

      const tableMap = JSON.parse(
        stripDeterministicHeader(readFileSync(join(root, GENERATED_DIR, "db.json"), "utf8")),
      ).tableMap;

      const client = createGeneratedDbClient(adapterAsTransaction(adapter), tableMap, {
        auth: { kind: "user", userId: "user-b", tenantId: tenantB, role: "member" },
      });

      const rows = await client.tickets.all();
      expect(rows).toHaveLength(0);

      const crossTenantGet = await client.tickets.get(
        String((created.result as { id: string }).id),
      );
      expect(crossTenantGet).toBeNull();
    } finally {
      cleanupWorkspace(root);
    }
  });
});
