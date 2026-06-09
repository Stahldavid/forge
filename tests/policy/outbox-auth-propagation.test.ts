import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import { cleanupWorkspace, scaffoldPolicyWorkspace } from "./helpers.ts";

describe("outbox auth propagation", () => {
  test("persists auth snapshot on emit", async () => {
    const { root, tenantA } = await scaffoldPolicyWorkspace("outbox-auth");
    try {
      const adapter = createMemoryAdapter();
      const sqlPlan = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "sqlPlan.json"), "utf8"),
        ),
      ) as SqlPlan;
      await applyMigrations(adapter, sqlPlan);
      await adapter.query(`INSERT INTO tenants (id, name) VALUES ($1, $2)`, [tenantA, "A"]);

      const result = await runEntry(root, "createTicket", {
        json: false,
        mock: false,
        db: adapter,
        args: { title: "auth-test" },
        userId: "user-a",
        tenantId: tenantA,
        role: "member",
      });
      expect(result.ok).toBe(true);

      const outbox = await adapter.query(`SELECT auth_context FROM _forge_outbox LIMIT 1`);
      const authContext = outbox.rows[0]?.auth_context;
      const parsed =
        typeof authContext === "string" ? JSON.parse(authContext) : authContext;

      expect(parsed).toEqual({
        kind: "user",
        userId: "user-a",
        tenantId: tenantA,
        role: "member",
      });
    } finally {
      cleanupWorkspace(root);
    }
  });
});
