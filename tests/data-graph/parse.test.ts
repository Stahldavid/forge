import { describe, expect, test } from "bun:test";
import { parseDefineTableSlice } from "../../src/forge/compiler/data-graph/parse.ts";

describe("parseDefineTableSlice", () => {
  test("parses string literal table name with fields", () => {
    const parsed = parseDefineTableSlice(
      'defineTable("users", { id: "string", email: "string" })',
    );
    expect(parsed).toEqual({
      tableName: "users",
      fields: [
        { name: "email", type: "string" },
        { name: "id", type: "string" },
      ],
    });
  });

  test("parses object config with name property", () => {
    const parsed = parseDefineTableSlice(
      'defineTable({ name: "tickets", status: "string" })',
    );
    expect(parsed).toEqual({
      tableName: "tickets",
      fields: [{ name: "status", type: "string" }],
    });
  });

  test("preserves field named name in explicit fields object", () => {
    const parsed = parseDefineTableSlice(
      'defineTable({ name: "projects", fields: { id: "uuid", name: "text" } })',
    );
    expect(parsed).toEqual({
      tableName: "projects",
      fields: [
        { name: "id", type: "uuid" },
        { name: "name", type: "text" },
      ],
    });
  });

  test("preserves field named name in string literal table style", () => {
    const parsed = parseDefineTableSlice(
      'defineTable("projects", { id: "uuid", name: "text" })',
    );
    expect(parsed).toEqual({
      tableName: "projects",
      fields: [
        { name: "id", type: "uuid" },
        { name: "name", type: "text" },
      ],
    });
  });

  test("returns null for non-defineTable slices", () => {
    expect(parseDefineTableSlice('query("users")')).toBeNull();
  });
});
