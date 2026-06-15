// @forge-generated generator=0.1.0-alpha.1 input=15db5211b2295feba64a25a14ce8d07c783b9685e9994859941a0139d6f10d5d content=39ad42ec98ed7aebc56e061aa399738c1175f0a7b4261b5bf2df70eb59afcfe2
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
