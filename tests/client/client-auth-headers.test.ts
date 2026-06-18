import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cleanupWorkspace, scaffoldClientWorkspace } from "./helpers.ts";

type GeneratedClientModule = {
  createForgeClient: (config: {
    url: string;
    auth?: unknown;
  }) => {
    query: (name: string, args: unknown) => Promise<unknown>;
    liveQuery: (
      name: string,
      args: unknown,
      onSnapshot: (value: unknown) => void,
      onError?: (error: unknown) => void,
    ) => () => void;
  };
  api: {
    queries: { listTickets: string };
    liveQueries: { watchUser: string };
  };
};

const AUTH_HEADER_NAMES = ["x-forge-user-id", "x-forge-tenant-id", "x-forge-role"];

let root = "";
let tenantA = "";
let generated: GeneratedClientModule;

function captureAuthHeaders(init?: RequestInit): Record<string, string> {
  const headers = new Headers(init?.headers);
  const seenHeaders: Record<string, string> = {};
  for (const key of AUTH_HEADER_NAMES) {
    const value = headers.get(key);
    if (value) {
      seenHeaders[key] = value;
    }
  }
  return seenHeaders;
}

beforeAll(async () => {
  const workspace = await scaffoldClientWorkspace("client-auth-headers");
  root = workspace.root;
  tenantA = workspace.tenantA;
  generated = await import(`${root}/src/forge/_generated/client.ts`) as GeneratedClientModule;
});

afterAll(() => {
  if (root) {
    cleanupWorkspace(root);
  }
});

describe("client auth headers", () => {
  test.serial("sends x-forge-user-id, x-forge-tenant-id, and x-forge-role", async () => {
    const originalFetch = globalThis.fetch;
    let seenHeaders: Record<string, string> = {};

    globalThis.fetch = (async (_input, init) => {
      seenHeaders = captureAuthHeaders(init);
      return Response.json({ ok: true, result: [], traceId: "trace-query" });
    }) as typeof fetch;

    try {
      const client = generated.createForgeClient({
        url: "http://127.0.0.1:3765",
        auth: { userId: "u1", tenantId: tenantA, role: "member" },
      });

      await client.query(generated.api.queries.listTickets, {});

      expect(seenHeaders["x-forge-user-id"]).toBe("u1");
      expect(seenHeaders["x-forge-tenant-id"]).toBe(tenantA);
      expect(seenHeaders["x-forge-role"]).toBe("member");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test.serial("async auth provider merges returned headers", async () => {
    const originalFetch = globalThis.fetch;
    let seenHeaders: Record<string, string> = {};

    globalThis.fetch = (async (_input, init) => {
      seenHeaders = captureAuthHeaders(init);
      return Response.json({ ok: true, result: [], traceId: "trace-query" });
    }) as typeof fetch;

    try {
      const client = generated.createForgeClient({
        url: "http://127.0.0.1:3765",
        auth: async () => ({
          "x-forge-user-id": "async-user",
          "x-forge-tenant-id": tenantA,
          "x-forge-role": "member",
        }),
      });

      await client.query(generated.api.queries.listTickets, {});

      expect(seenHeaders["x-forge-user-id"]).toBe("async-user");
      expect(seenHeaders["x-forge-tenant-id"]).toBe(tenantA);
      expect(seenHeaders["x-forge-role"]).toBe("member");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test.serial("liveQuery sends auth headers through fetch streaming", async () => {
    const originalFetch = globalThis.fetch;
    let seenHeaders: Record<string, string> = {};
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

    globalThis.fetch = (async (_input, init) => {
      seenHeaders = captureAuthHeaders(init);

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
      const snapshot = await new Promise<unknown>((resolve, reject) => {
        const client = generated.createForgeClient({
          url: "http://127.0.0.1:3765",
          auth: { userId: "u1", tenantId: tenantA, role: "member" },
        });

        const unsubscribe = client.liveQuery(
          generated.api.liveQueries.watchUser,
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
    }
  });
});
