import { describe, expect, test } from "bun:test";
import { simulatePolicy } from "../../src/forge/runtime/auth/evaluate.ts";

describe("policy simulate", () => {
  const matrix = {
    schemaVersion: "1.0.0",
    generatorVersion: "test",
    inputHash: "test",
    entries: [
      { policy: "tickets.create", roles: ["owner", "admin", "member"] },
      { policy: "billing.manage", roles: ["owner", "admin"] },
    ],
  };

  test("allows member for tickets.create", () => {
    const result = simulatePolicy(matrix, "tickets.create", "member");
    expect(result.allowed).toBe(true);
  });

  test("denies member for billing.manage", () => {
    const result = simulatePolicy(matrix, "billing.manage", "member");
    expect(result.allowed).toBe(false);
  });
});
