import { describe, expect, test } from "bun:test";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import { buildSqlPlan } from "../../src/forge/compiler/data-graph/sql/ddl.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { createTelemetryContext } from "../../src/forge/runtime/telemetry/context.ts";
import { generateTraceId } from "../../src/forge/runtime/telemetry/correlation.ts";
import { fixtureWorkspaceRoot } from "../data-graph/helpers.ts";

describe("telemetry context", () => {
  test("capture buffers events in transaction", async () => {
    const adapter = createMemoryAdapter();
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [],
    });
    const plan = buildSqlPlan(buildDataGraph(appGraph));
    await applyMigrations(adapter, plan);

    const tx = await adapter.begin();
    const traceId = generateTraceId();
    const telemetry = createTelemetryContext({
      adapter,
      tx,
      traceId,
      runtime: { kind: "command", name: "createTicket" },
      bufferInTransaction: true,
    });

    await telemetry.capture("ticket_created", { ticketId: "1" });
    await tx.commit();

    const rows = await adapter.query(
      `SELECT trace_id, event_type FROM _forge_telemetry_events`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.trace_id).toBe(traceId);
    expect(rows.rows[0]?.event_type).toBe("event");
  });

  test("transaction rollback clears buffered telemetry", async () => {
    const adapter = createMemoryAdapter();
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [],
    });
    const plan = buildSqlPlan(buildDataGraph(appGraph));
    await applyMigrations(adapter, plan);

    const tx = await adapter.begin();
    const telemetry = createTelemetryContext({
      adapter,
      tx,
      traceId: generateTraceId(),
      runtime: { kind: "command", name: "createTicket" },
      bufferInTransaction: true,
    });

    await telemetry.capture("ticket_created", { ticketId: "1" });
    await tx.rollback();

    const rows = await adapter.query(`SELECT id FROM _forge_telemetry_events`);
    expect(rows.rows).toHaveLength(0);
  });
});
