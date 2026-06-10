import * as React from "react";

export type ForgeReactAuth = {
  userId?: string;
  tenantId?: string;
  role?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
};

export type ForgeReactAuthProvider =
  | ForgeReactAuth
  | (() => Promise<ForgeReactAuth>);

export type ForgeReactClientConfig = {
  url: string;
  auth?: ForgeReactAuthProvider;
};

export type ForgeReactError = Error & {
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

export type ForgeReactClient = {
  lastTraceId?: string;
  query(name: string, args: unknown): Promise<unknown>;
  command(name: string, args: unknown): Promise<unknown>;
  liveQuery(
    name: string,
    args: unknown,
    onSnapshot: (snapshot: LiveSnapshot<unknown>) => void,
    onError?: (error: ForgeReactError) => void,
    options?: { signal?: AbortSignal },
  ): () => void;
};

export type ForgeProviderProps = ForgeReactClientConfig & {
  children?: React.ReactNode;
};

export type UseQueryOptions = {
  enabled?: boolean;
};

export type UseQueryResult<T> = {
  data: T | undefined;
  error: ForgeReactError | null;
  loading: boolean;
  refetch: () => Promise<void>;
  traceId?: string;
};

export type UseCommandOptions<TResult> = {
  onSuccess?: (result: TResult) => void;
  onError?: (error: ForgeReactError) => void;
};

export type UseCommandResult<TArgs, TResult> = {
  run: (args: TArgs) => Promise<TResult>;
  loading: boolean;
  error: ForgeReactError | null;
  result: TResult | undefined;
  traceId?: string;
  reset: () => void;
};

export type UseLiveQueryOptions = {
  enabled?: boolean;
};

export type UseLiveQueryResult<T> = {
  data: T | undefined;
  error: ForgeReactError | null;
  loading: boolean;
  connected: boolean;
  revision: number | undefined;
  traceId?: string;
  reconnect: () => void;
};

export type ForgeReactBindings<TClient extends ForgeReactClient = ForgeReactClient> = {
  ForgeProvider: (props: ForgeProviderProps) => React.ReactElement;
  useForgeClient: () => TClient;
  useAuth: () => ForgeReactAuth | undefined;
  useQuery: <TResult = unknown>(
    name: string,
    args: unknown,
    options?: UseQueryOptions,
  ) => UseQueryResult<TResult>;
  useCommand: <TArgs = unknown, TResult = unknown>(
    name: string,
    options?: UseCommandOptions<TResult>,
  ) => UseCommandResult<TArgs, TResult>;
  useLiveQuery: <TResult = unknown>(
    name: string,
    args: unknown,
    options?: UseLiveQueryOptions,
  ) => UseLiveQueryResult<TResult>;
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

function toForgeError(error: unknown): ForgeReactError {
  if (error instanceof Error) {
    return error as ForgeReactError;
  }
  const wrapped = new Error(String(error)) as ForgeReactError;
  wrapped.code = "FORGE_REACT_ERROR";
  return wrapped;
}

export function createForgeReactBindings<TClient extends ForgeReactClient>(
  createForgeClient: (config: ForgeReactClientConfig) => TClient,
): ForgeReactBindings<TClient> {
  type ContextValue = {
    client: TClient;
    auth?: ForgeReactAuthProvider;
  };

  const ForgeContext = React.createContext<ContextValue | null>(null);

  function useContextValue(): ContextValue {
    const value = React.useContext(ForgeContext);
    if (!value) {
      const error = new Error("useForgeClient must be used within <ForgeProvider>.") as ForgeReactError;
      error.code = "FORGE_REACT_PROVIDER_MISSING";
      throw error;
    }
    return value;
  }

  function ForgeProvider(props: ForgeProviderProps): React.ReactElement {
    const { url, auth, children } = props;
    const client = React.useMemo(
      () => createForgeClient({ url, auth }),
      [url, auth],
    );
    const value = React.useMemo(() => ({ client, auth }), [client, auth]);
    return React.createElement(ForgeContext.Provider, { value }, children);
  }

  function useForgeClient(): TClient {
    return useContextValue().client;
  }

  function useAuth(): ForgeReactAuth | undefined {
    const { auth } = useContextValue();
    return typeof auth === "function" ? undefined : auth;
  }

  function useQuery<TResult = unknown>(
    name: string,
    args: unknown,
    options?: UseQueryOptions,
  ): UseQueryResult<TResult> {
    const client = useForgeClient();
    const enabled = options?.enabled !== false;
    const argsKey = stableStringify(args);
    const [state, setState] = React.useState<{
      data: TResult | undefined;
      error: ForgeReactError | null;
      loading: boolean;
      traceId?: string;
    }>({
      data: undefined,
      error: null,
      loading: enabled,
    });

    const refetch = React.useCallback(async () => {
      if (!enabled) {
        return;
      }
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = (await client.query(name, args)) as TResult;
        setState({
          data,
          error: null,
          loading: false,
          traceId: client.lastTraceId,
        });
      } catch (error) {
        const forgeError = toForgeError(error);
        setState((prev) => ({
          ...prev,
          error: forgeError,
          loading: false,
          traceId: forgeError.traceId,
        }));
      }
    }, [argsKey, client, enabled, name]);

    React.useEffect(() => {
      if (!enabled) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }
      void refetch();
    }, [enabled, refetch]);

    return {
      ...state,
      refetch,
    };
  }

  function useCommand<TArgs = unknown, TResult = unknown>(
    name: string,
    options?: UseCommandOptions<TResult>,
  ): UseCommandResult<TArgs, TResult> {
    const client = useForgeClient();
    const [state, setState] = React.useState<{
      loading: boolean;
      error: ForgeReactError | null;
      result: TResult | undefined;
      traceId?: string;
    }>({
      loading: false,
      error: null,
      result: undefined,
    });

    const run = React.useCallback(
      async (args: TArgs): Promise<TResult> => {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        try {
          const result = (await client.command(name, args)) as TResult;
          setState({
            loading: false,
            error: null,
            result,
            traceId: client.lastTraceId,
          });
          options?.onSuccess?.(result);
          return result;
        } catch (error) {
          const forgeError = toForgeError(error);
          setState((prev) => ({
            ...prev,
            loading: false,
            error: forgeError,
            traceId: forgeError.traceId,
          }));
          options?.onError?.(forgeError);
          throw forgeError;
        }
      },
      [client, name, options?.onError, options?.onSuccess],
    );

    const reset = React.useCallback(() => {
      setState({
        loading: false,
        error: null,
        result: undefined,
      });
    }, []);

    return {
      ...state,
      run,
      reset,
    };
  }

  function useLiveQuery<TResult = unknown>(
    name: string,
    args: unknown,
    options?: UseLiveQueryOptions,
  ): UseLiveQueryResult<TResult> {
    const client = useForgeClient();
    const enabled = options?.enabled !== false;
    const argsKey = stableStringify(args);
    const [reconnectToken, setReconnectToken] = React.useState(0);
    const [state, setState] = React.useState<{
      data: TResult | undefined;
      error: ForgeReactError | null;
      loading: boolean;
      connected: boolean;
      revision: number | undefined;
      traceId?: string;
    }>({
      data: undefined,
      error: null,
      loading: enabled,
      connected: false,
      revision: undefined,
    });

    const reconnect = React.useCallback(() => {
      setReconnectToken((value) => value + 1);
    }, []);

    React.useEffect(() => {
      if (!enabled) {
        setState((prev) => ({ ...prev, loading: false, connected: false }));
        return;
      }

      const controller = new AbortController();
      setState((prev) => ({
        ...prev,
        loading: true,
        connected: false,
        error: null,
      }));

      const unsubscribe = client.liveQuery(
        name,
        args,
        (snapshot) => {
          setState({
            data: snapshot.data as TResult,
            error: null,
            loading: false,
            connected: true,
            revision: snapshot.revision,
            traceId: snapshot.traceId,
          });
        },
        (error) => {
          const forgeError = toForgeError(error);
          setState((prev) => ({
            ...prev,
            error: forgeError,
            loading: false,
            connected: false,
            traceId: forgeError.traceId,
          }));
        },
        { signal: controller.signal },
      );

      return () => {
        controller.abort();
        unsubscribe();
      };
    }, [argsKey, client, enabled, name, reconnectToken]);

    return {
      ...state,
      reconnect,
    };
  }

  return {
    ForgeProvider,
    useForgeClient,
    useAuth,
    useQuery,
    useCommand,
    useLiveQuery,
  };
}
