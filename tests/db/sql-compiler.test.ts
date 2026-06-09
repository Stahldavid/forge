import { describe, expect, test } from "bun:test";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import { buildSqlPlan } from "../../src/forge/compiler/data-graph/sql/ddl.ts";
import { serializeSqlPlanJson } from "../../src/forge/compiler/data-graph/sql/serialize.ts";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { fixtureSource, fixtureWorkspaceRoot } from "../data-graph/helpers.ts";

describe("sql compiler", () => {
  test("maps DataGraph fields to SQL DDL", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [fixtureSource("object-config.ts")],
    });

    const dataGraph = buildDataGraph(appGraph);
    const plan = buildSqlPlan(dataGraph);

    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0]?.table).toBe("tickets");
    expect(plan.tables[0]?.sql).toContain("CREATE TABLE IF NOT EXISTS \"tickets\"");
    expect(plan.tables[0]?.sql).toContain("\"status\" text NOT NULL");
    expect(plan.systemTables).toHaveLength(2);
    expect(plan.migrationId).toMatch(/^migration_/);
    expect(plan.checksum.length).toBeGreaterThan(0);
  });

  test("serializes deterministically", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [fixtureSource("string-literal.ts")],
    });

    const plan = buildSqlPlan(buildDataGraph(appGraph));
    const first = serializeSqlPlanJson(plan);
    const second = serializeSqlPlanJson(buildSqlPlan(buildDataGraph(appGraph)));

    expect(first).toBe(second);
  });

  test("reports unsupported field types", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [
        {
          file: "src/forge/schema.ts",
          content: `
            import { defineTable } from "forge/server";
            export const bad = defineTable({
              name: "bad",
              fields: { value: "unknown_type" },
            });
          `,
        },
      ],
    });

    const plan = buildSqlPlan(buildDataGraph(appGraph));
    expect(
      plan.diagnostics.some(
        (diagnostic) => diagnostic.code === "FORGE_DB_UNSUPPORTED_FIELD_TYPE",
      ),
    ).toBe(true);
  });
});
