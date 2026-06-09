import { describe, expect, test } from "bun:test";
import { buildTableMap } from "../../src/forge/compiler/data-graph/sql/serialize.ts";
import { buildSqlPlan } from "../../src/forge/compiler/data-graph/sql/ddl.ts";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { createGeneratedDbClient } from "../../src/forge/runtime/db/generated-client.ts";
import { adapterAsTransaction } from "../../src/forge/runtime/db/adapter.ts";
import { fixtureSource, fixtureWorkspaceRoot } from "../data-graph/helpers.ts";

describe("generated db client", () => {
  test("supports CRUD helpers", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [fixtureSource("object-config.ts")],
    });
    const plan = buildSqlPlan(buildDataGraph(appGraph));
    const adapter = createMemoryAdapter();
    await applyMigrations(adapter, plan);

    const client = createGeneratedDbClient(adapterAsTransaction(adapter), buildTableMap(plan));
    const inserted = await client.tickets.insert({
      id: "00000000-0000-0000-0000-000000000001",
      status: "open",
    });

    expect(inserted.id).toBe("00000000-0000-0000-0000-000000000001");

    const fetched = await client.tickets.get("00000000-0000-0000-0000-000000000001");
    expect(fetched?.status).toBe("open");

    const listed = await client.tickets.all();
    expect(listed).toHaveLength(1);
  });
});
