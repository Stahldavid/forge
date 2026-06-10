import { describe, expect, test } from "bun:test";
import { cleanupWorkspace, prepareClientDatabase, scaffoldClientWorkspace } from "./helpers.ts";

describe("client query", () => {
  test("client.query posts to /queries/listTickets", async () => {
    const { root, tenantA, tenantB } = await scaffoldClientWorkspace("client-query");
    const handle = await prepareClientDatabase(root, tenantA, tenantB, { seedTickets: true });

    try {
      const { createForgeClient, api } = await import(
        `${root}/src/forge/_generated/client.ts`
      );

      const client = createForgeClient({
        url: handle.url,
        auth: { userId: "u1", tenantId: tenantA, role: "member" },
      });

      const tickets = (await client.query(api.queries.listTickets, {})) as unknown[];
      expect(Array.isArray(tickets)).toBe(true);
      expect(tickets.length).toBeGreaterThanOrEqual(1);
    } finally {
      handle.stop();
      cleanupWorkspace(root);
    }
  });
});
