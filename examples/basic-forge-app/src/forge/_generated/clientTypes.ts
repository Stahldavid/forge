// @forge-generated generator=0.0.0 input=54f3f6b66f87a575bff2d09c80de50b1bfca193d6bbbd7adb6204ec0df01c245 content=0c6b5f63d726374b1e3919162cbab8b922554512bfe5f4807afc08d7e54178a7
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

export type ForgeClient = {
  query<Name extends QueryName>(name: Name, args: unknown): Promise<unknown>;
  command<Name extends CommandName>(name: Name, args: unknown): Promise<unknown>;
};
