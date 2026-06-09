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

  test("returns null for non-defineTable slices", () => {
    expect(parseDefineTableSlice('query("users")')).toBeNull();
  });
});
