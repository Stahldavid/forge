// @forge-generated generator=0.0.0 input=d4c04bb50918289504020c384505fe134421a7b93d98da721b1dc7d12103c611 content=260952033e467d4c227ca5c1857ce4449e155ca32c5a56b3a7836a777e70b6fe
export type ForgeStaticAuth = {
  userId: string;
  tenantId: string;
  role: string;
};

export type ForgeAuthProvider =
  | ForgeStaticAuth
  | (() => Promise<Record<string, string>>);

export type ForgeClientConfig = {
  url: string;
  auth: ForgeAuthProvider;
};

export class ForgeError extends Error {
  code: string;
  traceId?: string;
  status?: number;

  constructor(
    message: string,
    options: { code: string; traceId?: string; status?: number },
  ) {
    super(message);
    this.name = "ForgeError";
    this.code = options.code;
    this.traceId = options.traceId;
    this.status = options.status;
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
