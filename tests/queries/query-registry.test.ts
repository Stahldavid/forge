import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { cleanupWorkspace, scaffoldQueryWorkspace } from "./helpers.ts";

describe("query registry generation", () => {
  test("records listTickets and getTicket with auth metadata", async () => {
    const { root } = await scaffoldQueryWorkspace("query-registry");
    try {
      const raw = stripDeterministicHeader(
        readFileSync(join(root, GENERATED_DIR, "queryRegistry.json"), "utf8"),
      );
      const registry = JSON.parse(raw) as {
        queries: { name: string; file: string }[];
      };

      expect(registry.queries.map((q) => q.name).sort()).toEqual(["getTicket", "listTickets"]);

      const policyRaw = stripDeterministicHeader(
        readFileSync(join(root, GENERATED_DIR, "policyRegistry.json"), "utf8"),
      );
      const policyRegistry = JSON.parse(policyRaw) as {
        queryAuth: { queryName: string; auth: { kind: string; policy?: string } }[];
      };

      expect(policyRegistry.queryAuth.find((b) => b.queryName === "listTickets")?.auth).toEqual({
        kind: "policy",
        policy: "tickets.read",
      });

      const apiRaw = stripDeterministicHeader(
        readFileSync(join(root, GENERATED_DIR, "api.json"), "utf8"),
      );
      const api = JSON.parse(apiRaw) as { queries: Record<string, string> };
      expect(api.queries.listTickets).toBe("listTickets");
      expect(api.queries.getTicket).toBe("getTicket");
    } finally {
      cleanupWorkspace(root);
    }
  });
});
