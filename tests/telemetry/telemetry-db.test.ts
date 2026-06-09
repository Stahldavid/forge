import { describe, expect, test } from "bun:test";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import { buildSqlPlan } from "../../src/forge/compiler/data-graph/sql/ddl.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations, resetDatabase } from "../../src/forge/runtime/db/migrate.ts";
import { recordExceptionOutsideTx } from "../../src/forge/runtime/telemetry/buffer.ts";
import { generateTraceId } from "../../src/forge/runtime/telemetry/correlation.ts";
import { fixtureWorkspaceRoot } from "../data-graph/helpers.ts";

describe("telemetry db", () => {
  test("creates telemetry tables via migrations", async () => {
    const adapter = createMemoryAdapter();
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [],
    });
    const plan = buildSqlPlan(buildDataGraph(appGraph));
    await applyMigrations(adapter, plan);

    const tables = await adapter.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = tables.rows.map((row) => String(row.table_name));
    expect(names).toContain("_forge_telemetry_events");
    expect(names).toContain("_forge_trace_spans");
  });

  test("exception outside transaction persists after command rollback", async () => {
    const adapter = createMemoryAdapter();
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [],
    });
    const plan = buildSqlPlan(buildDataGraph(appGraph));
    await applyMigrations(adapter, plan);

    const traceId = generateTraceId();
    const tx = await adapter.begin();
    await tx.rollback();

    await recordExceptionOutsideTx(adapter, new Error("boom"), traceId, {
      kind: "command",
      name: "createTicket",
    });

    const rows = await adapter.query(
      `SELECT event_type, trace_id FROM _forge_telemetry_events`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.event_type).toBe("exception");
    expect(rows.rows[0]?.trace_id).toBe(traceId);
  });

  test("reset truncates telemetry tables", async () => {
    const adapter = createMemoryAdapter();
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [],
    });
    const plan = buildSqlPlan(buildDataGraph(appGraph));
    await applyMigrations(adapter, plan);

    await recordExceptionOutsideTx(adapter, new Error("boom"), generateTraceId(), {
      kind: "command",
      name: "x",
    });

    await resetDatabase(adapter, plan);

    const rows = await adapter.query(`SELECT id FROM _forge_telemetry_events`);
    expect(rows.rows).toHaveLength(0);
  });
});
