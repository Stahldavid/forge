import { describe, expect, test } from "bun:test";
import * as React from "react";
import { act, create } from "react-test-renderer";
import { createForgeReactBindings } from "../../src/forge/react/index.ts";
import type {
  ForgeReactClient,
  ForgeReactClientConfig,
  LiveSnapshot,
} from "../../src/forge/react/index.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createMockClient(overrides?: Partial<ForgeReactClient>): ForgeReactClient {
  return {
    query: async () => [],
    command: async () => ({ ok: true }),
    liveQuery: () => () => {},
    ...overrides,
  };
}

describe("React hooks", () => {
  test("ForgeProvider creates a client and useAuth returns static auth", async () => {
    let seenConfig: ForgeReactClientConfig | undefined;
    const client = createMockClient();
    const bindings = createForgeReactBindings((config) => {
      seenConfig = config;
      return client;
    });

    let seenClient: ForgeReactClient | undefined;
    let seenAuth: unknown;

    function Harness() {
      seenClient = bindings.useForgeClient();
      seenAuth = bindings.useAuth();
      return null;
    }

    await act(async () => {
      create(
        React.createElement(
          bindings.ForgeProvider,
          {
            url: "http://127.0.0.1:3765",
            auth: { userId: "u1", tenantId: "t1", role: "member" },
          },
          React.createElement(Harness),
        ),
      );
    });

    expect(seenConfig?.url).toBe("http://127.0.0.1:3765");
    expect(seenClient).toBe(client);
    expect(seenAuth).toEqual({ userId: "u1", tenantId: "t1", role: "member" });
  });

  test("useForgeClient fails clearly outside ForgeProvider", () => {
    const bindings = createForgeReactBindings(() => createMockClient());
    let caught: unknown;

    function Harness() {
      bindings.useForgeClient();
      return null;
    }

    try {
      act(() => {
        create(React.createElement(Harness));
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).toBe(
      "useForgeClient must be used within <ForgeProvider>.",
    );
    expect((caught as { code?: string }).code).toBe("FORGE_REACT_PROVIDER_MISSING");
  });

  test("useQuery exposes loading, data, and traceId", async () => {
    const deferred = createDeferred<unknown>();
    const client = createMockClient({
      lastTraceId: undefined,
      query: async () => {
        const result = await deferred.promise;
        client.lastTraceId = "trace-query";
        return result;
      },
    });
    const bindings = createForgeReactBindings(() => client);
    let result!: ReturnType<typeof bindings.useQuery<{ id: string }>>;

    function Harness() {
      result = bindings.useQuery<{ id: string }>("listTickets", {});
      return null;
    }

    await act(async () => {
      create(
        React.createElement(
          bindings.ForgeProvider,
          { url: "http://forge.test" },
          React.createElement(Harness),
        ),
      );
    });

    expect(result.loading).toBe(true);

    await act(async () => {
      deferred.resolve({ id: "ticket-1" });
      await deferred.promise;
    });

    expect(result.loading).toBe(false);
    expect(result.data).toEqual({ id: "ticket-1" });
    expect(result.traceId).toBe("trace-query");
    expect(result.error).toBeNull();
  });

  test("useCommand exposes run, result, traceId, and reset", async () => {
    const client = createMockClient({
      command: async (_name, args) => {
        client.lastTraceId = "trace-command";
        return { args };
      },
    });
    const bindings = createForgeReactBindings(() => client);
    let command!: ReturnType<typeof bindings.useCommand<{ title: string }, { args: unknown }>>;

    function Harness() {
      command = bindings.useCommand<{ title: string }, { args: unknown }>("createTicket");
      return null;
    }

    await act(async () => {
      create(
        React.createElement(
          bindings.ForgeProvider,
          { url: "http://forge.test" },
          React.createElement(Harness),
        ),
      );
    });

    await act(async () => {
      await command.run({ title: "Bug" });
    });

    expect(command.loading).toBe(false);
    expect(command.result).toEqual({ args: { title: "Bug" } });
    expect(command.traceId).toBe("trace-command");

    act(() => command.reset());
    expect(command.result).toBeUndefined();
    expect(command.error).toBeNull();
  });

  test("useLiveQuery receives snapshots and unsubscribes on unmount", async () => {
    let onSnapshot!: (snapshot: LiveSnapshot<unknown>) => void;
    let signal: AbortSignal | undefined;
    let unsubscribed = false;
    const client = createMockClient({
      liveQuery: (_name, _args, snapshot, _error, options) => {
        onSnapshot = snapshot;
        signal = options?.signal;
        return () => {
          unsubscribed = true;
        };
      },
    });
    const bindings = createForgeReactBindings(() => client);
    let live!: ReturnType<typeof bindings.useLiveQuery<{ title: string }[]>>;

    function Harness() {
      live = bindings.useLiveQuery<{ title: string }[]>("liveTickets", {});
      return null;
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          bindings.ForgeProvider,
          { url: "http://forge.test" },
          React.createElement(Harness),
        ),
      );
    });

    expect(live.loading).toBe(true);

    act(() => {
      onSnapshot({
        subscriptionId: "sub-1",
        revision: 1,
        data: [{ title: "Initial" }],
        traceId: "trace-live",
      });
    });

    expect(live.connected).toBe(true);
    expect(live.loading).toBe(false);
    expect(live.revision).toBe(1);
    expect(live.data).toEqual([{ title: "Initial" }]);
    expect(live.traceId).toBe("trace-live");

    act(() => renderer.unmount());
    expect(unsubscribed).toBe(true);
    expect(signal?.aborted).toBe(true);
  });
});
