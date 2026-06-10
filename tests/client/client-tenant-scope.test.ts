import { describe, expect, test } from "bun:test";
import { cleanupWorkspace, prepareClientDatabase, scaffoldClientWorkspace } from "./helpers.ts";

describe("client tenant scope", () => {
  test("tenant t1 only receives t1 data", async () => {
    const { root, tenantA, tenantB } = await scaffoldClientWorkspace("client-tenant");
    const handle = await prepareClientDatabase(root, tenantA, tenantB, { seedTickets: true });

    try {
      const { createForgeClient, api } = await import(
        `${root}/src/forge/_generated/client.ts`
      );

      const clientA = createForgeClient({
        url: handle.url,
        auth: { userId: "u-a", tenantId: tenantA, role: "member" },
      });

      const clientB = createForgeClient({
        url: handle.url,
        auth: { userId: "u-b", tenantId: tenantB, role: "member" },
      });

      const ticketsA = (await clientA.query(api.queries.listTickets, {})) as {
        title: string;
      }[];
      const ticketsB = (await clientB.query(api.queries.listTickets, {})) as {
        title: string;
      }[];

      expect(ticketsA.length).toBe(1);
      expect(ticketsB.length).toBe(1);
      expect(ticketsA[0]?.title).toBe("tenant-a-ticket");
      expect(ticketsB[0]?.title).toBe("tenant-b-ticket");
    } finally {
      handle.stop();
      cleanupWorkspace(root);
    }
  });
});
