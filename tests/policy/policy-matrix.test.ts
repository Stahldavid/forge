import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { cleanupWorkspace, scaffoldPolicyWorkspace } from "./helpers.ts";

describe("permission matrix", () => {
  test("maps roles to policies", async () => {
    const { root } = await scaffoldPolicyWorkspace("policy-matrix");
    try {
      const raw = stripDeterministicHeader(
        readFileSync(join(root, GENERATED_DIR, "permissionMatrix.json"), "utf8"),
      );
      const matrix = JSON.parse(raw) as {
        entries: { policy: string; roles: string[] }[];
      };

      const billing = matrix.entries.find((entry) => entry.policy === "billing.manage");
      expect(billing?.roles).toEqual(["admin", "owner"]);

      const create = matrix.entries.find((entry) => entry.policy === "tickets.create");
      expect(create?.roles).toEqual(["admin", "member", "owner"]);
    } finally {
      cleanupWorkspace(root);
    }
  });
});
