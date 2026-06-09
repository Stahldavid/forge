import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { cleanupWorkspace, scaffoldPolicyWorkspace } from "./helpers.ts";

describe("command auth metadata", () => {
  test("records auth requirement per command", async () => {
    const { root } = await scaffoldPolicyWorkspace("command-auth");
    try {
      const raw = stripDeterministicHeader(
        readFileSync(join(root, GENERATED_DIR, "policyRegistry.json"), "utf8"),
      );
      const registry = JSON.parse(raw) as {
        commandAuth: { commandName: string; auth: { kind: string; policy?: string } }[];
      };

      expect(registry.commandAuth.find((b) => b.commandName === "manageBilling")?.auth).toEqual({
        kind: "policy",
        policy: "billing.manage",
      });
    } finally {
      cleanupWorkspace(root);
    }
  });
});
