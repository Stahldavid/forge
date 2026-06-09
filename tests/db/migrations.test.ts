import { describe, expect, test } from "bun:test";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import { buildSqlPlan } from "../../src/forge/compiler/data-graph/sql/ddl.ts";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import {
  applyMigrations,
  getMigrationStatus,
  resetDatabase,
} from "../../src/forge/runtime/db/migrate.ts";
import { fixtureSource, fixtureWorkspaceRoot } from "../data-graph/helpers.ts";

describe("migrations", () => {
  test("applies system and domain tables", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [fixtureSource("object-config.ts")],
    });
    const plan = buildSqlPlan(buildDataGraph(appGraph));
    const adapter = createMemoryAdapter();

    const diagnostics = await applyMigrations(adapter, plan);
    expect(diagnostics).toHaveLength(0);

    const status = await getMigrationStatus(adapter);
    expect(status.applied.some((record) => record.id === plan.migrationId)).toBe(true);
  });

  test("reset drops and reapplies domain tables", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [fixtureSource("object-config.ts")],
    });
    const plan = buildSqlPlan(buildDataGraph(appGraph));
    const adapter = createMemoryAdapter();

    await applyMigrations(adapter, plan);
    const diagnostics = await resetDatabase(adapter, plan);
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toHaveLength(0);
  });
});
