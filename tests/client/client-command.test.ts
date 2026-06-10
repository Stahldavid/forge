import { describe, expect, test } from "bun:test";
import { cleanupWorkspace, prepareClientDatabase, scaffoldClientWorkspace } from "./helpers.ts";

describe("client command", () => {
  test("client.command posts to /commands/createTicket", async () => {
    const { root, tenantA, tenantB } = await scaffoldClientWorkspace("client-command");
    const handle = await prepareClientDatabase(root, tenantA, tenantB);

    try {
      const { createForgeClient, api } = await import(
        `${root}/src/forge/_generated/client.ts`
      );

      const client = createForgeClient({
        url: handle.url,
        auth: { userId: "u1", tenantId: tenantA, role: "member" },
      });

      const row = (await client.command(api.commands.createTicket, {
        title: "Bug",
      })) as { title: string };

      expect(row.title).toBe("Bug");
    } finally {
      handle.stop();
      cleanupWorkspace(root);
    }
  });
});
