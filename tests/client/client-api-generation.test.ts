import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { cleanupWorkspace, scaffoldClientWorkspace } from "./helpers.ts";

describe("client api generation", () => {
  test("api.ts includes queries, commands, and liveQueries", async () => {
    const { root } = await scaffoldClientWorkspace("client-api-gen");
    try {
      const apiTs = readFileSync(join(root, GENERATED_DIR, "api.ts"), "utf8");
      expect(apiTs).toContain("listTickets");
      expect(apiTs).toContain("createTicket");
      expect(apiTs).toContain("liveQueries");

      const apiJson = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "api.json"), "utf8"),
        ),
      ) as {
        queries: Record<string, string>;
        commands: Record<string, string>;
        liveQueries: Record<string, string>;
      };

      expect(apiJson.queries.listTickets).toBe("listTickets");
      expect(apiJson.commands.createTicket).toBe("createTicket");
      expect(apiJson.liveQueries.watchUser).toBe("watchUser");

      const clientTs = readFileSync(join(root, GENERATED_DIR, "client.ts"), "utf8");
      expect(clientTs).toContain("createForgeClient");
      expect(clientTs).toContain("ForgeHttpClient");

      const clientTypes = readFileSync(join(root, GENERATED_DIR, "clientTypes.ts"), "utf8");
      expect(clientTypes).toContain("ForgeClient");
      expect(clientTypes).toContain("ForgeError");
      expect(clientTypes).toContain("LiveSnapshot");
      expect(clientTypes).toContain("liveQuery");
    } finally {
      cleanupWorkspace(root);
    }
  }, 30_000);
});
