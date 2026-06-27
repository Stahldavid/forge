import { describe, expect, test } from "bun:test";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import { buildSqlPlan } from "../../src/forge/compiler/data-graph/sql/ddl.ts";
import {
  buildTableMap,
  serializeSqlPlanJson,
} from "../../src/forge/compiler/data-graph/sql/serialize.ts";
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
    expect(plan.systemTables).toHaveLength(10);
    expect(plan.systemTables.map((entry) => entry.sql).join("\n")).toContain(
      "_forge_live_invalidations",
    );
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
    expect(JSON.parse(first).diagnostics).toEqual(plan.diagnostics);
  });

  test("orders tables before dependents with inline foreign keys", () => {
    const plan = buildSqlPlan({
      schemaVersion: "1.0.0",
      generatorVersion: "test",
      analyzerVersion: "test",
      inputHash: "test",
      diagnostics: [],
      tables: [
        {
          id: "appBlueprints",
          name: "appBlueprints",
          symbolId: "appBlueprints",
          exportName: "appBlueprints",
          file: "schema.ts",
          fields: [
            { name: "projectId", type: "ref:projects" },
            { name: "title", type: "text" },
          ],
        },
        {
          id: "projects",
          name: "projects",
          symbolId: "projects",
          exportName: "projects",
          file: "schema.ts",
          fields: [
            { name: "tenantId", type: "ref:tenants" },
            { name: "title", type: "text" },
          ],
        },
        {
          id: "tenants",
          name: "tenants",
          symbolId: "tenants",
          exportName: "tenants",
          file: "schema.ts",
          fields: [{ name: "name", type: "text" }],
        },
      ],
    });

    expect(plan.tables.map((table) => table.table)).toEqual([
      "tenants",
      "projects",
      "app_blueprints",
    ]);
  });

  test("exposes original table names as db client aliases", () => {
    const plan = buildSqlPlan({
      schemaVersion: "1.0.0",
      generatorVersion: "test",
      analyzerVersion: "test",
      inputHash: "test",
      diagnostics: [],
      tables: [
        {
          id: "appBlueprints",
          name: "appBlueprints",
          symbolId: "appBlueprints",
          exportName: "appBlueprints",
          file: "schema.ts",
          fields: [{ name: "title", type: "text" }],
        },
      ],
    });
    const tableMap = buildTableMap(plan);

    expect(tableMap.appBlueprints?.tableName).toBe("app_blueprints");
    expect(tableMap.app_blueprints?.tableName).toBe("app_blueprints");
  });

  test("resolves camelCase ref targets to canonical SQL table names", () => {
    const plan = buildSqlPlan({
      schemaVersion: "1.0.0",
      generatorVersion: "test",
      analyzerVersion: "test",
      inputHash: "test",
      diagnostics: [],
      tables: [
        {
          id: "accessRequests",
          name: "access_requests",
          symbolId: "accessRequests",
          exportName: "accessRequests",
          file: "src/forge/schema.ts",
          fields: [
            { name: "id", type: "uuid" },
            { name: "title", type: "text" },
          ],
        },
        {
          id: "evidenceDocuments",
          name: "evidence_documents",
          symbolId: "evidenceDocuments",
          exportName: "evidenceDocuments",
          file: "src/forge/schema.ts",
          fields: [
            { name: "id", type: "uuid" },
            { name: "requestId", type: "ref:accessRequests" },
            { name: "title", type: "text" },
          ],
        },
      ],
    });

    const evidenceTable = plan.tables.find((table) => table.table === "evidence_documents");
    expect(plan.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(evidenceTable?.sql).toContain(
      '"request_id" uuid NOT NULL REFERENCES "access_requests" ("id")',
    );
  });

  test("reports unknown ref targets before generating invalid SQL", () => {
    const plan = buildSqlPlan({
      schemaVersion: "1.0.0",
      generatorVersion: "test",
      analyzerVersion: "test",
      inputHash: "test",
      diagnostics: [],
      tables: [
        {
          id: "evidenceDocuments",
          name: "evidence_documents",
          symbolId: "evidenceDocuments",
          exportName: "evidenceDocuments",
          file: "src/forge/schema.ts",
          fields: [
            { name: "id", type: "uuid" },
            { name: "requestId", type: "ref:accessRequests" },
            { name: "title", type: "text" },
          ],
        },
      ],
    });

    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "FORGE_DB_INVALID_SQL_PLAN",
        severity: "error",
        message: expect.stringContaining("unknown ref target 'accessRequests'"),
      }),
    );
    expect(plan.tables.find((table) => table.table === "evidence_documents")?.sql).not.toContain(
      "accessrequests",
    );
  });

  test("preserves source fields named name in SQL and runtime table map", () => {
    const plan = buildSqlPlan({
      schemaVersion: "1.0.0",
      generatorVersion: "test",
      analyzerVersion: "test",
      inputHash: "test",
      diagnostics: [],
      tables: [
        {
          id: "tenants",
          name: "tenants",
          symbolId: "tenants",
          exportName: "tenants",
          file: "schema.ts",
          fields: [
            { name: "id", type: "uuid" },
            { name: "name", type: "text" },
          ],
        },
      ],
    });
    const table = plan.tables.find((entry) => entry.table === "tenants");
    const tableMap = buildTableMap(plan);

    expect(table?.columns?.map((column) => column.fieldName ?? column.name)).toContain("name");
    expect(table?.sql).toContain("\"name\" text NOT NULL");
    expect(tableMap.tenants?.columns.map((column) => column.fieldName ?? column.name)).toContain("name");
  });

  test("rejects text id fields instead of silently choosing another primary key", () => {
    const plan = buildSqlPlan({
      schemaVersion: "1.0.0",
      generatorVersion: "test",
      analyzerVersion: "test",
      inputHash: "test",
      diagnostics: [],
      tables: [
        {
          id: "approvalRequests",
          name: "approvalRequests",
          symbolId: "approvalRequests",
          exportName: "approvalRequests",
          file: "src/forge/schema.ts",
          fields: [
            { name: "id", type: "text" },
            { name: "amount", type: "number" },
            { name: "title", type: "text" },
          ],
        },
      ],
    });

    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "FORGE_DB_INVALID_SQL_PLAN",
        severity: "warning",
        file: "src/forge/schema.ts",
      }),
    );
    expect(plan.tables[0]?.columns?.find((column) => column.name === "amount")?.primaryKey).not.toBe(true);
  });

  test("emits nullable timestamp columns for optional timestamp fields", () => {
    const plan = buildSqlPlan({
      schemaVersion: "1.0.0",
      generatorVersion: "test",
      analyzerVersion: "test",
      inputHash: "test",
      diagnostics: [],
      tables: [
        {
          id: "reviews",
          name: "reviews",
          symbolId: "reviews",
          exportName: "reviews",
          file: "src/forge/schema.ts",
          fields: [
            { name: "id", type: "uuid" },
            { name: "reviewedAt", type: "timestamp?" },
          ],
        },
      ],
    });

    expect(plan.tables[0]?.sql).toContain('"reviewed_at" timestamptz');
    expect(plan.tables[0]?.sql).not.toContain('"reviewed_at" timestamptz NOT NULL');
    expect(plan.tables[0]?.columns?.find((column) => column.name === "id")?.nullable).toBe(false);
  });

  test("reports unsupported field types", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [fixtureSource("bad-field.ts")],
    });

    const plan = buildSqlPlan(buildDataGraph(appGraph));
    expect(
      plan.diagnostics.some(
        (diagnostic) => diagnostic.code === "FORGE_DB_UNSUPPORTED_FIELD_TYPE",
      ),
    ).toBe(true);
  });
});
