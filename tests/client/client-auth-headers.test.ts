import { describe, expect, test } from "bun:test";
import { cleanupWorkspace, prepareClientDatabase, scaffoldClientWorkspace } from "./helpers.ts";

describe("client auth headers", () => {
  test.serial("sends x-forge-user-id, x-forge-tenant-id, and x-forge-role", async () => {
    const { root, tenantA, tenantB } = await scaffoldClientWorkspace("client-auth");
    const handle = await prepareClientDatabase(root, tenantA, tenantB, { seedTickets: true });

    const originalFetch = globalThis.fetch;
    const seenHeaders: Record<string, string> = {};

    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      for (const key of ["x-forge-user-id", "x-forge-tenant-id", "x-forge-role"]) {
        const value = headers.get(key);
        if (value) {
          seenHeaders[key] = value;
        }
      }
      return originalFetch(input, init);
    };

    try {
      const { createForgeClient, api } = await import(
        `${root}/src/forge/_generated/client.ts`
      );

      const client = createForgeClient({
        url: handle.url,
        auth: { userId: "u1", tenantId: tenantA, role: "member" },
      });

      await client.query(api.queries.listTickets, {});

      expect(seenHeaders["x-forge-user-id"]).toBe("u1");
      expect(seenHeaders["x-forge-tenant-id"]).toBe(tenantA);
      expect(seenHeaders["x-forge-role"]).toBe("member");
    } finally {
      globalThis.fetch = originalFetch;
      handle.stop();
      cleanupWorkspace(root);
    }
  });

  test.serial("async auth provider merges returned headers", async () => {
    const { root, tenantA, tenantB } = await scaffoldClientWorkspace("client-auth-fn");
    const handle = await prepareClientDatabase(root, tenantA, tenantB, { seedTickets: true });

    const originalFetch = globalThis.fetch;
    const seenHeaders: Record<string, string> = {};

    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      for (const key of ["x-forge-user-id", "x-forge-tenant-id", "x-forge-role"]) {
        const value = headers.get(key);
        if (value) {
          seenHeaders[key] = value;
        }
      }
      return originalFetch(input, init);
    };

    try {
      const { createForgeClient, api } = await import(
        `${root}/src/forge/_generated/client.ts`
      );

      const client = createForgeClient({
        url: handle.url,
        auth: async () => ({
          "x-forge-user-id": "async-user",
          "x-forge-tenant-id": tenantA,
          "x-forge-role": "member",
        }),
      });

      await client.query(api.queries.listTickets, {});

      expect(seenHeaders["x-forge-user-id"]).toBe("async-user");
      expect(seenHeaders["x-forge-tenant-id"]).toBe(tenantA);
      expect(seenHeaders["x-forge-role"]).toBe("member");
    } finally {
      globalThis.fetch = originalFetch;
      handle.stop();
      cleanupWorkspace(root);
    }
  });
});
