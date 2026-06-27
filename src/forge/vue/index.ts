import {
  computed,
  inject,
  onScopeDispose,
  provide,
  shallowRef,
  toValue,
  watch,
} from "vue";
import type { App, InjectionKey, MaybeRefOrGetter, ShallowRef } from "vue";

export type ForgeVueAuth = {
  userId?: string;
  tenantId?: string;
  organizationId?: string;
  organizationMembershipId?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  claims?: Record<string, unknown>;
  token?: string;
  getToken?: () => string | Promise<string>;
  headers?: Record<string, string>;
  [key: string]: unknown;
};

export type ForgeVueAuthProvider =
  | ForgeVueAuth
  | (() => Promise<ForgeVueAuth>);

export type ForgeVueClientConfig = {
  url: string;
  auth?: ForgeVueAuthProvider;
};

export type ForgeDevAuthConfig =
  | boolean
  | {
      userId?: string;
      tenantId?: string;
      organizationId?: string;
      organizationMembershipId?: string;
      role?: string;
      roles?: string[];
      permissions?: string[];
      claims?: Record<string, unknown>;
      headers?: Record<string, string>;
    };

export type ForgeVuePluginOptions = ForgeVueClientConfig & {
  devAuth?: ForgeDevAuthConfig;
};

export type ForgeVueError = Error & {
  code?: string;
  status?: number;
  traceId?: string;
  details?: unknown;
};

export type LiveSnapshot<T> = {
  subscriptionId: string;
  revision: number;
  data: T;
  traceId?: string;
};

export type ForgeVueClient = {
  lastTraceId?: string;
  query(name: string, args: unknown): Promise<unknown>;
  command(name: string, args: unknown): Promise<unknown>;
  liveQuery(
    name: string,
    args: unknown,
    onSnapshot: (snapshot: LiveSnapshot<unknown>) => void,
    onError?: (error: ForgeVueError) => void,
    options?: { signal?: AbortSignal },
  ): () => void;
};

export type UseForgeQueryOptions = {
  enabled?: MaybeRefOrGetter<boolean>;
};

export type UseForgeQueryResult<T> = {
  data: Readonly<ShallowRef<T | undefined>>;
  error: Readonly<ShallowRef<ForgeVueError | null>>;
  loading: Readonly<ShallowRef<boolean>>;
  refetch: () => Promise<void>;
  traceId: Readonly<ShallowRef<string | undefined>>;
};

export type UseForgeCommandOptions<TResult> = {
  onSuccess?: (result: TResult) => void;
  onError?: (error: ForgeVueError) => void;
};

export type UseForgeCommandResult<TArgs, TResult> = {
  run: (args: TArgs) => Promise<TResult>;
  loading: Readonly<ShallowRef<boolean>>;
  error: Readonly<ShallowRef<ForgeVueError | null>>;
  result: Readonly<ShallowRef<TResult | undefined>>;
  traceId: Readonly<ShallowRef<string | undefined>>;
  reset: () => void;
};

export type UseForgeLiveQueryOptions = {
  enabled?: MaybeRefOrGetter<boolean>;
};

export type UseForgeLiveQueryResult<T> = {
  data: Readonly<ShallowRef<T | undefined>>;
  error: Readonly<ShallowRef<ForgeVueError | null>>;
  loading: Readonly<ShallowRef<boolean>>;
  connected: Readonly<ShallowRef<boolean>>;
  revision: Readonly<ShallowRef<number | undefined>>;
  traceId: Readonly<ShallowRef<string | undefined>>;
  reconnect: () => void;
};

type ForgeVueContext<TClient extends ForgeVueClient> = {
  client: TClient;
  auth?: ForgeVueAuthProvider;
};

export type ForgeVueBindings<TClient extends ForgeVueClient = ForgeVueClient> = {
  ForgeVuePlugin: {
    install(app: App, options: ForgeVuePluginOptions): void;
  };
  provideForge: (options: ForgeVuePluginOptions) => TClient;
  useForgeClient: () => TClient;
  useForgeAuth: () => ForgeVueAuth | undefined;
  useForgeQuery: <TResult = unknown>(
    name: MaybeRefOrGetter<string>,
    args: MaybeRefOrGetter<unknown>,
    options?: UseForgeQueryOptions,
  ) => UseForgeQueryResult<TResult>;
  useForgeCommand: <TArgs = unknown, TResult = unknown>(
    name: MaybeRefOrGetter<string>,
    options?: UseForgeCommandOptions<TResult>,
  ) => UseForgeCommandResult<TArgs, TResult>;
  useForgeLiveQuery: <TResult = unknown>(
    name: MaybeRefOrGetter<string>,
    args: MaybeRefOrGetter<unknown>,
    options?: UseForgeLiveQueryOptions,
  ) => UseForgeLiveQueryResult<TResult>;
};

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  function normalize(input: unknown): unknown {
    if (input === null || typeof input !== "object") {
      return input;
    }
    if (seen.has(input)) {
      return "[Circular]";
    }
    seen.add(input);
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    const record = input as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalize(record[key]);
        return acc;
      }, {});
  }

  return JSON.stringify(normalize(value));
}

function toForgeError(error: unknown): ForgeVueError {
  if (error instanceof Error) {
    return error as ForgeVueError;
  }
  const wrapped = new Error(String(error)) as ForgeVueError;
  wrapped.code = "FORGE_VUE_ERROR";
  return wrapped;
}

function resolveDevAuth(devAuth: ForgeDevAuthConfig | undefined): ForgeVueAuthProvider | undefined {
  if (!devAuth) {
    return undefined;
  }
  const config = typeof devAuth === "object" ? devAuth : {};
  return {
    userId: config.userId ?? "dev-user",
    tenantId: config.tenantId ?? config.organizationId ?? "dev-tenant",
    organizationId: config.organizationId ?? config.tenantId ?? "dev-tenant",
    organizationMembershipId: config.organizationMembershipId,
    role: config.role ?? "owner",
    roles: config.roles,
    permissions: config.permissions,
    claims: config.claims,
    headers: config.headers,
  };
}

function readonlyRef<T>(ref: ShallowRef<T>): Readonly<ShallowRef<T>> {
  return ref;
}

export function createForgeVueBindings<TClient extends ForgeVueClient>(
  createForgeClient: (config: ForgeVueClientConfig) => TClient,
): ForgeVueBindings<TClient> {
  const forgeVueKey: InjectionKey<ForgeVueContext<TClient>> = Symbol("ForgeVue");

  function createContext(options: ForgeVuePluginOptions): ForgeVueContext<TClient> {
    const auth = options.auth ?? resolveDevAuth(options.devAuth);
    return {
      client: createForgeClient({ url: options.url, auth }),
      auth,
    };
  }

  const ForgeVuePlugin = {
    install(app: App, options: ForgeVuePluginOptions): void {
      app.provide(forgeVueKey, createContext(options));
    },
  };

  function provideForge(options: ForgeVuePluginOptions): TClient {
    const context = createContext(options);
    provide(forgeVueKey, context);
    return context.client;
  }

  function useContextValue(): ForgeVueContext<TClient> {
    const value = inject(forgeVueKey);
    if (!value) {
      const error = new Error("useForgeClient must be used after provideForge or ForgeVuePlugin.") as ForgeVueError;
      error.code = "FORGE_VUE_PROVIDER_MISSING";
      throw error;
    }
    return value;
  }

  function useForgeClient(): TClient {
    return useContextValue().client;
  }

  function useForgeAuth(): ForgeVueAuth | undefined {
    const { auth } = useContextValue();
    return typeof auth === "function" ? undefined : auth;
  }

  function useForgeQuery<TResult = unknown>(
    name: MaybeRefOrGetter<string>,
    args: MaybeRefOrGetter<unknown>,
    options?: UseForgeQueryOptions,
  ): UseForgeQueryResult<TResult> {
    const client = useForgeClient();
    const data = shallowRef<TResult | undefined>();
    const error = shallowRef<ForgeVueError | null>(null);
    const loading = shallowRef(false);
    const traceId = shallowRef<string | undefined>();
    const enabled = computed(() => toValue(options?.enabled ?? true) !== false);
    const argsKey = computed(() => stableStringify(toValue(args)));

    async function refetch(): Promise<void> {
      if (!enabled.value) {
        return;
      }
      loading.value = true;
      error.value = null;
      try {
        data.value = (await client.query(toValue(name), toValue(args))) as TResult;
        traceId.value = client.lastTraceId;
      } catch (caught) {
        error.value = toForgeError(caught);
      } finally {
        loading.value = false;
      }
    }

    watch(
      [() => toValue(name), argsKey, enabled],
      () => {
        void refetch();
      },
      { immediate: true },
    );

    return {
      data: readonlyRef(data),
      error: readonlyRef(error),
      loading: readonlyRef(loading),
      refetch,
      traceId: readonlyRef(traceId),
    };
  }

  function useForgeCommand<TArgs = unknown, TResult = unknown>(
    name: MaybeRefOrGetter<string>,
    options?: UseForgeCommandOptions<TResult>,
  ): UseForgeCommandResult<TArgs, TResult> {
    const client = useForgeClient();
    const result = shallowRef<TResult | undefined>();
    const error = shallowRef<ForgeVueError | null>(null);
    const loading = shallowRef(false);
    const traceId = shallowRef<string | undefined>();

    async function run(args: TArgs): Promise<TResult> {
      loading.value = true;
      error.value = null;
      try {
        const value = (await client.command(toValue(name), args)) as TResult;
        result.value = value;
        traceId.value = client.lastTraceId;
        options?.onSuccess?.(value);
        return value;
      } catch (caught) {
        const forgeError = toForgeError(caught);
        error.value = forgeError;
        options?.onError?.(forgeError);
        throw forgeError;
      } finally {
        loading.value = false;
      }
    }

    function reset(): void {
      result.value = undefined;
      error.value = null;
      traceId.value = undefined;
      loading.value = false;
    }

    return {
      run,
      loading: readonlyRef(loading),
      error: readonlyRef(error),
      result: readonlyRef(result),
      traceId: readonlyRef(traceId),
      reset,
    };
  }

  function useForgeLiveQuery<TResult = unknown>(
    name: MaybeRefOrGetter<string>,
    args: MaybeRefOrGetter<unknown>,
    options?: UseForgeLiveQueryOptions,
  ): UseForgeLiveQueryResult<TResult> {
    const client = useForgeClient();
    const data = shallowRef<TResult | undefined>();
    const error = shallowRef<ForgeVueError | null>(null);
    const loading = shallowRef(true);
    const connected = shallowRef(false);
    const revision = shallowRef<number | undefined>();
    const traceId = shallowRef<string | undefined>();
    const reconnectNonce = shallowRef(0);
    const enabled = computed(() => toValue(options?.enabled ?? true) !== false);
    const argsKey = computed(() => stableStringify(toValue(args)));
    let unsubscribe: (() => void) | undefined;

    function close(): void {
      unsubscribe?.();
      unsubscribe = undefined;
      connected.value = false;
    }

    function connect(): void {
      close();
      if (!enabled.value) {
        loading.value = false;
        return;
      }
      loading.value = true;
      error.value = null;
      unsubscribe = client.liveQuery(
        toValue(name),
        toValue(args),
        (snapshot) => {
          data.value = snapshot.data as TResult;
          revision.value = snapshot.revision;
          traceId.value = snapshot.traceId;
          connected.value = true;
          loading.value = false;
        },
        (caught) => {
          error.value = toForgeError(caught);
          connected.value = false;
          loading.value = false;
        },
      );
    }

    function reconnect(): void {
      reconnectNonce.value += 1;
    }

    watch(
      [() => toValue(name), argsKey, enabled, reconnectNonce],
      connect,
      { immediate: true },
    );
    onScopeDispose(close);

    return {
      data: readonlyRef(data),
      error: readonlyRef(error),
      loading: readonlyRef(loading),
      connected: readonlyRef(connected),
      revision: readonlyRef(revision),
      traceId: readonlyRef(traceId),
      reconnect,
    };
  }

  return {
    ForgeVuePlugin,
    provideForge,
    useForgeClient,
    useForgeAuth,
    useForgeQuery,
    useForgeCommand,
    useForgeLiveQuery,
  };
}
