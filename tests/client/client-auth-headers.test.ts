import { describe, expect, test } from "bun:test";
import { cleanupWorkspace, prepareClientDatabase, scaffoldClientWorkspace } from "./helpers.ts";

describe("client auth headers", () => {
  test.serial("sends x-forge-user-id, x-forge-tenant-id, and x-forge-role", async () => {
    const { root, tenantA, tenantB } = await scaffoldClientWorkspace("client-auth");
    const handle = await prepareClientDatabase(root, tenantA, tenantB, { seedTickets: true });

    const originalFetch = globalThis.fetch;
    const seenHeaders: Record<string, string> = {};

    globalThis.fetch = (async (input, init) => {
      const headers = new Headers(init?.headers);
      for (const key of ["x-forge-user-id", "x-forge-tenant-id", "x-forge-role"]) {
        const value = headers.get(key);
        if (value) {
          seenHeaders[key] = value;
        }
      }
      return originalFetch(input, init);
    }) as typeof fetch;

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
  }, 30_000);

  test.serial("async auth provider merges returned headers", async () => {
    const { root, tenantA, tenantB } = await scaffoldClientWorkspace("client-auth-fn");
    const handle = await prepareClientDatabase(root, tenantA, tenantB, { seedTickets: true });

    const originalFetch = globalThis.fetch;
    const seenHeaders: Record<string, string> = {};

    globalThis.fetch = (async (input, init) => {
      const headers = new Headers(init?.headers);
      for (const key of ["x-forge-user-id", "x-forge-tenant-id", "x-forge-role"]) {
        const value = headers.get(key);
        if (value) {
          seenHeaders[key] = value;
        }
      }
      return originalFetch(input, init);
    }) as typeof fetch;

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
  }, 30_000);

  test.serial("liveQuery sends auth headers through fetch streaming", async () => {
    const { root, tenantA } = await scaffoldClientWorkspace("client-live-auth");
    const originalFetch = globalThis.fetch;
    const seenHeaders: Record<string, string> = {};
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

    globalThis.fetch = (async (_input, init) => {
      const headers = new Headers(init?.headers);
      for (const key of ["x-forge-user-id", "x-forge-tenant-id", "x-forge-role"]) {
        const value = headers.get(key);
        if (value) {
          seenHeaders[key] = value;
        }
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller: ReadableStreamDefaultController<Uint8Array>) {
          streamController = controller;
          controller.enqueue(
            encoder.encode(
              'event: snapshot\ndata: {"type":"snapshot","subscriptionId":"sub-1","revision":1,"data":[],"traceId":"trace-live"}\n\n',
            ),
          );
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    try {
      const { createForgeClient, api } = await import(
        `${root}/src/forge/_generated/client.ts`
      );

      const snapshot = await new Promise<unknown>((resolve, reject) => {
        const client = createForgeClient({
          url: "http://127.0.0.1:3765",
          auth: { userId: "u1", tenantId: tenantA, role: "member" },
        });

        const unsubscribe = client.liveQuery(
          api.liveQueries.watchUser,
          {},
          (value: unknown) => {
            unsubscribe();
            resolve(value);
          },
          reject,
        );
      });

      streamController?.close();

      expect((snapshot as { traceId?: string }).traceId).toBe("trace-live");
      expect(seenHeaders["x-forge-user-id"]).toBe("u1");
      expect(seenHeaders["x-forge-tenant-id"]).toBe(tenantA);
      expect(seenHeaders["x-forge-role"]).toBe("member");
    } finally {
      globalThis.fetch = originalFetch;
      cleanupWorkspace(root);
    }
  }, 30_000);
});
