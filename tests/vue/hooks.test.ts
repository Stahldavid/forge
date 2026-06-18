import { describe, expect, test } from "bun:test";
import { createSSRApp, effectScope, h, nextTick } from "vue";
import { renderToString } from "vue/server-renderer";
import { createForgeVueBindings } from "../../src/forge/vue/index.ts";
import type {
  ForgeVueClient,
  ForgeVueClientConfig,
  LiveSnapshot,
} from "../../src/forge/vue/index.ts";

function createMockClient(overrides?: Partial<ForgeVueClient>): ForgeVueClient {
  return {
    query: async () => [],
    command: async () => ({ ok: true }),
    liveQuery: () => () => {},
    ...overrides,
  };
}

async function flushVue(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

describe("Vue composables", () => {
  test("provideForge creates a client and useForgeAuth returns static auth", async () => {
    let seenConfig: ForgeVueClientConfig | undefined;
    const client = createMockClient();
    const bindings = createForgeVueBindings((config) => {
      seenConfig = config;
      return client;
    });
    let seenClient: ForgeVueClient | undefined;
    let seenAuth: unknown;

    const Child = {
      setup() {
        seenClient = bindings.useForgeClient();
        seenAuth = bindings.useForgeAuth();
        return () => null;
      },
    };
    const app = createSSRApp({
      setup() {
        bindings.provideForge({
          url: "http://127.0.0.1:3765",
          auth: { userId: "u1", tenantId: "t1", role: "member" },
        });
        return () => h(Child);
      },
    });

    await renderToString(app);
    expect(seenConfig?.url).toBe("http://127.0.0.1:3765");
    expect(seenClient).toBe(client);
    expect(seenAuth).toEqual({ userId: "u1", tenantId: "t1", role: "member" });
  });

  test("useForgeQuery exposes loading, data, and traceId", async () => {
    const client = createMockClient({
      query: async () => {
        client.lastTraceId = "trace-query";
        return { id: "ticket-1" };
      },
    });
    const bindings = createForgeVueBindings(() => client);
    let query!: ReturnType<typeof bindings.useForgeQuery<{ id: string }>>;

    const Child = {
      setup() {
        query = bindings.useForgeQuery<{ id: string }>("listTickets", {});
        return () => null;
      },
    };
    const app = createSSRApp({
      setup() {
        bindings.provideForge({ url: "http://forge.test" });
        return () => h(Child);
      },
    });

    await renderToString(app);
    await flushVue();

    expect(query.loading.value).toBe(false);
    expect(query.data.value).toEqual({ id: "ticket-1" });
    expect(query.traceId.value).toBe("trace-query");
    expect(query.error.value).toBeNull();
  });

  test("useForgeCommand exposes run, result, traceId, and reset", async () => {
    const client = createMockClient({
      command: async (_name, args) => {
        client.lastTraceId = "trace-command";
        return { args };
      },
    });
    const bindings = createForgeVueBindings(() => client);
    let command!: ReturnType<typeof bindings.useForgeCommand<{ title: string }, { args: unknown }>>;

    const Child = {
      setup() {
        command = bindings.useForgeCommand<{ title: string }, { args: unknown }>("createTicket");
        return () => null;
      },
    };
    const app = createSSRApp({
      setup() {
        bindings.provideForge({ url: "http://forge.test" });
        return () => h(Child);
      },
    });

    await renderToString(app);
    await command.run({ title: "Bug" });

    expect(command.loading.value).toBe(false);
    expect(command.result.value).toEqual({ args: { title: "Bug" } });
    expect(command.traceId.value).toBe("trace-command");

    command.reset();
    expect(command.result.value).toBeUndefined();
    expect(command.error.value).toBeNull();
  });

  test("useForgeLiveQuery receives snapshots and unsubscribes on scope disposal", async () => {
    let onSnapshot!: (snapshot: LiveSnapshot<unknown>) => void;
    let unsubscribed = false;
    const client = createMockClient({
      liveQuery: (_name, _args, snapshot) => {
        onSnapshot = snapshot;
        return () => {
          unsubscribed = true;
        };
      },
    });
    const bindings = createForgeVueBindings(() => client);
    let live!: ReturnType<typeof bindings.useForgeLiveQuery<{ title: string }[]>>;

    const Child = {
      setup() {
        live = bindings.useForgeLiveQuery<{ title: string }[]>("liveTickets", {});
        return () => null;
      },
    };
    const app = createSSRApp({});
    app.use(bindings.ForgeVuePlugin, { url: "http://forge.test" });
    const scope = effectScope();
    app.runWithContext(() => {
      scope.run(() => {
        Child.setup();
      });
    });
    expect(live.loading.value).toBe(true);

    onSnapshot({
      subscriptionId: "sub-1",
      revision: 1,
      data: [{ title: "Initial" }],
      traceId: "trace-live",
    });
    await nextTick();

    expect(live.connected.value).toBe(true);
    expect(live.loading.value).toBe(false);
    expect(live.revision.value).toBe(1);
    expect(live.data.value).toEqual([{ title: "Initial" }]);
    expect(live.traceId.value).toBe("trace-live");

    scope.stop();
    expect(unsubscribed).toBe(true);
  });
});
