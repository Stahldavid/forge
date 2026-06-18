// @forge-generated generator=0.1.0-alpha.15 input=67cf6717e9ba5e94f88e7a31f4ec4bd11bca063e91c093d1365c00db340f2c1e content=b893b27f895193111546b90974f4ad1540aef6ede0d9ab3a11972a1dce2519e2
export type ForgeStaticAuth = {
  userId?: string;
  tenantId?: string;
  role?: string;
  token?: string;
  getToken?: () => string | Promise<string>;
  headers?: Record<string, string>;
  [key: string]: unknown;
};

export type ForgeResolvedAuth = {
  userId?: string;
  tenantId?: string;
  role?: string;
  token?: string;
  getToken?: () => string | Promise<string>;
  headers?: Record<string, string>;
  [key: string]: unknown;
};

export type ForgeAuthProvider =
  | ForgeResolvedAuth
  | (() => Promise<ForgeResolvedAuth>);

export type ForgeClientConfig = {
  url: string;
  auth?: ForgeAuthProvider;
};

export class ForgeError extends Error {
  code: string;
  traceId?: string;
  status?: number;
  details?: unknown;

  constructor(
    message: string,
    options: { code: string; traceId?: string; status?: number; details?: unknown },
  ) {
    super(message);
    this.name = "ForgeError";
    this.code = options.code;
    this.traceId = options.traceId;
    this.status = options.status;
    this.details = options.details;
  }
}

export type QueryName = keyof typeof import("./api.ts").api.queries;
export type CommandName = keyof typeof import("./api.ts").api.commands;
export type LiveQueryName = keyof typeof import("./api.ts").api.liveQueries;
export type ExternalCommandName = string;
export type ExternalQueryName = string;
export type ExternalRuntimeRefObject = {
  service: string;
  name: string;
  kind?: "command" | "query";
  language?: string;
  framework?: string;
  transport?: string;
};
export type ExternalCommandRef =
  | ExternalCommandName
  | ExternalRuntimeRefObject;
export type ExternalQueryRef =
  | ExternalQueryName
  | ExternalRuntimeRefObject;

export type LiveSnapshot<T> = {
  subscriptionId: string;
  revision: number;
  data: T;
  traceId?: string;
};

export type LiveQueryOptions = {
  signal?: AbortSignal;
};

export type Unsubscribe = () => void;

export type ForgeClient = {
  readonly lastTraceId?: string;
  query<Name extends QueryName>(name: Name, args: unknown): Promise<unknown>;
  command<Name extends CommandName>(name: Name, args: unknown): Promise<unknown>;
  externalQuery<Name extends ExternalQueryRef>(name: Name, args: unknown): Promise<unknown>;
  externalCommand<Name extends ExternalCommandRef>(name: Name, args: unknown): Promise<unknown>;
  liveQuery<Name extends LiveQueryName>(
    name: Name,
    args: unknown,
    onSnapshot: (snapshot: LiveSnapshot<unknown>) => void,
    onError?: (error: ForgeError) => void,
    options?: LiveQueryOptions,
  ): Unsubscribe;
};
