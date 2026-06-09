import { describe, expect, test } from "bun:test";
import { classifyForgeCallee } from "../../src/forge/compiler/app-graph/classify.ts";

describe("classifyForgeCallee", () => {
  test("maps known builder APIs to ForgeKind", () => {
    expect(classifyForgeCallee("defineTable")).toBe("schema.table");
    expect(classifyForgeCallee("query")).toBe("query");
    expect(classifyForgeCallee("liveQuery")).toBe("liveQuery");
    expect(classifyForgeCallee("command")).toBe("command");
    expect(classifyForgeCallee("endpoint")).toBe("endpoint");
    expect(classifyForgeCallee("policy")).toBe("policy");
    expect(classifyForgeCallee("workflow")).toBe("workflow");
    expect(classifyForgeCallee("agent")).toBe("agent");
    expect(classifyForgeCallee("telemetryEvent")).toBe("telemetryEvent");
  });

  test("returns null for unknown callees", () => {
    expect(classifyForgeCallee("fetch")).toBeNull();
    expect(classifyForgeCallee("defineTable2")).toBeNull();
  });

  test("is idempotent", () => {
    expect(classifyForgeCallee("command")).toBe(classifyForgeCallee("command"));
  });
});
