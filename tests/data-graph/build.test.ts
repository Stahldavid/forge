import { describe, expect, test } from "bun:test";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import {
  serializeDataGraphJson,
  serializeDataGraphTs,
} from "../../src/forge/compiler/orchestrator/serialize.ts";
import { fixtureSource, fixtureWorkspaceRoot } from "./helpers.ts";

describe("buildDataGraph", () => {
  test("extracts tables from schema.table symbols", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [fixtureSource("string-literal.ts")],
    });

    const dataGraph = buildDataGraph(appGraph);

    expect(dataGraph.tables).toHaveLength(1);
    expect(dataGraph.tables[0]?.name).toBe("users");
    expect(dataGraph.tables[0]?.exportName).toBe("users");
    expect(dataGraph.tables[0]?.fields).toEqual([
      { name: "email", type: "string" },
      { name: "id", type: "string" },
    ]);
    expect(dataGraph.schemaVersion).toBe("1.0.0");
    expect(dataGraph.analyzerVersion).toBe("0.1.0");
  });

  test("parses object config defineTable call style", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [fixtureSource("object-config.ts")],
    });

    const dataGraph = buildDataGraph(appGraph);

    expect(dataGraph.tables).toHaveLength(1);
    expect(dataGraph.tables[0]?.name).toBe("tickets");
    expect(dataGraph.tables[0]?.fields).toEqual([
      { name: "status", type: "string" },
    ]);
  });

  test("parses nullable field helper as optional schema type", async () => {
    const text = [
      'import { defineTable, nullable } from "forge/schema";',
      'export const reviews = defineTable("reviews", { reviewedAt: nullable("timestamp") });',
      "",
    ].join("\n");
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [{ path: "src/forge/schema.ts", text, contentHash: "nullable-timestamp" }],
    });

    const dataGraph = buildDataGraph(appGraph);

    expect(dataGraph.tables[0]?.fields).toContainEqual({ name: "reviewedAt", type: "timestamp?" });
  });

  test("warns on duplicate table names", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [fixtureSource("duplicate-tables.ts")],
    });

    const dataGraph = buildDataGraph(appGraph);

    expect(dataGraph.tables).toHaveLength(2);
    const dupWarnings = dataGraph.diagnostics.filter(
      (diagnostic) => diagnostic.code === "FORGE_DUP_TABLE",
    );
    expect(dupWarnings).toHaveLength(2);
  });

  test("warns when table name cannot be parsed", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [fixtureSource("unparseable.ts")],
    });

    const dataGraph = buildDataGraph(appGraph);

    expect(dataGraph.tables).toHaveLength(0);
    expect(
      dataGraph.diagnostics.some(
        (diagnostic) => diagnostic.code === "FORGE_DATA_SCHEMA_UNPARSEABLE",
      ),
    ).toBe(true);
  });

  test("serializes deterministically", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [
        fixtureSource("object-config.ts"),
        fixtureSource("string-literal.ts"),
      ],
    });

    const dataGraph = buildDataGraph(appGraph);
    const jsonA = serializeDataGraphJson(dataGraph);
    const jsonB = serializeDataGraphJson(buildDataGraph(appGraph));
    const ts = serializeDataGraphTs(dataGraph);

    expect(jsonA).toBe(jsonB);
    expect(ts).toContain("export const dataGraph");
    expect(ts).toContain('"tickets"');
    expect(ts).toContain('"users"');
  });
});
