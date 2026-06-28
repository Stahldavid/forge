// @forge-generated generator=0.1.0-alpha.37 input=3c5b62bbf7ebf4e3965eda693951a98a2455bbf63bd241c83c730a8f4b260b86 content=a2fdc10666b8e754bcaafae919a025a35f5eba0e0d0940925d01a49b126e2878
export type ForgeStaticAuth = {
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

export type ForgeResolvedAuth = {
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

export type ForgeCommandResult<T = unknown> =
  | {
      ok: true;
      result: T;
      status: number;
      traceId?: string;
      diagnostics?: { code: string; message: string }[];
    }
  | {
      ok: false;
      error: { code: string; message: string; details?: unknown };
      status: number;
      traceId?: string;
      diagnostics?: { code: string; message: string }[];
    };

export type LiveQueryOptions = {
  signal?: AbortSignal;
};

export type Unsubscribe = () => void;

export type ForgeClient = {
  readonly lastTraceId?: string;
  query<Name extends QueryName>(name: Name, args: unknown): Promise<unknown>;
  command<Name extends CommandName>(name: Name, args: unknown): Promise<unknown>;
  commandResult<Name extends CommandName>(name: Name, args: unknown): Promise<ForgeCommandResult<unknown>>;
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
