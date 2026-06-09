import { describe, expect, test } from "bun:test";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { adapterAsTransaction } from "../../src/forge/runtime/db/adapter.ts";
import { insertOutbox } from "../../src/forge/runtime/db/outbox.ts";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import { buildSqlPlan } from "../../src/forge/compiler/data-graph/sql/ddl.ts";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { fixtureWorkspaceRoot } from "../data-graph/helpers.ts";

describe("outbox", () => {
  test("inserts pending events", async () => {
    const adapter = createMemoryAdapter();
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [],
    });
    const plan = buildSqlPlan(buildDataGraph(appGraph));
    await applyMigrations(adapter, plan);

    const tx = adapterAsTransaction(adapter);
    const result = await insertOutbox(tx, "ticket.created", { id: "1" });
    expect(result.ok).toBe(true);

    const rows = await adapter.query(
      `SELECT event_type, status FROM _forge_outbox`,
    );
    expect(rows.rows[0]?.event_type).toBe("ticket.created");
    expect(rows.rows[0]?.status).toBe("pending");
  });
});
