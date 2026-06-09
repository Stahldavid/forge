import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { cleanupWorkspace, scaffoldPolicyWorkspace } from "./helpers.ts";

describe("policy registry", () => {
  test("emits policies and command auth bindings", async () => {
    const { root, tenantA: _a, tenantB: _b } = await scaffoldPolicyWorkspace("policy-registry");
    try {
      const raw = stripDeterministicHeader(
        readFileSync(join(root, GENERATED_DIR, "policyRegistry.json"), "utf8"),
      );
      const registry = JSON.parse(raw) as {
        policies: { name: string; roles: string[] }[];
        commandAuth: { commandName: string; auth: { kind: string; policy?: string } }[];
      };

      expect(registry.policies.map((policy) => policy.name).sort()).toEqual([
        "billing.manage",
        "tickets.create",
        "tickets.read",
      ]);

      const createTicket = registry.commandAuth.find(
        (binding) => binding.commandName === "createTicket",
      );
      expect(createTicket?.auth).toEqual({ kind: "policy", policy: "tickets.create" });

      const openCommand = registry.commandAuth.find(
        (binding) => binding.commandName === "openCommand",
      );
      expect(openCommand?.auth.kind).toBe("public");
    } finally {
      cleanupWorkspace(root);
    }
  });
});
