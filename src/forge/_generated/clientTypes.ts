// @forge-generated generator=0.0.0 input=c81a6fef327755509f31aab367c180cadf8e66145f655e0c711f50a650bc7a9b content=a9db96d4f410c59ac863abb460583d12b657f24359630031bd20de8c46cca40f
export type ForgeStaticAuth = {
  userId: string;
  tenantId: string;
  role: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
};

export type ForgeResolvedAuth = {
  userId?: string;
  tenantId?: string;
  role?: string;
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
  liveQuery<Name extends LiveQueryName>(
    name: Name,
    args: unknown,
    onSnapshot: (snapshot: LiveSnapshot<unknown>) => void,
    onError?: (error: ForgeError) => void,
    options?: LiveQueryOptions,
  ): Unsubscribe;
};
