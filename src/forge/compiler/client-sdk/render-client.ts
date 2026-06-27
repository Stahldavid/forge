import type { ClientManifest, ReactManifest, VueManifest } from "./build-manifest.ts";

export function renderClientTypesTs(): string {
  return `export type ForgeStaticAuth = {
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
`;
}

export function renderClientTs(): string {
  return `import { api } from "./api.ts";
import type {
  ForgeAuthProvider,
  ForgeClient,
  ForgeClientConfig,
  ExternalCommandRef,
  ExternalQueryRef,
  LiveQueryOptions,
  LiveSnapshot,
} from "./clientTypes.ts";
import { ForgeError } from "./clientTypes.ts";

export { api };
export { ForgeError } from "./clientTypes.ts";
export type {
  ForgeAuthProvider,
  ForgeClient,
  ForgeClientConfig,
  ForgeStaticAuth,
  QueryName,
  CommandName,
  LiveQueryName,
  ExternalCommandName,
  ExternalQueryName,
  ExternalRuntimeRefObject,
  ExternalCommandRef,
  ExternalQueryRef,
  ForgeResolvedAuth,
  LiveQueryOptions,
  LiveSnapshot,
  Unsubscribe,
} from "./clientTypes.ts";

async function resolveAuthHeaders(
  auth?: ForgeAuthProvider,
): Promise<Record<string, string>> {
  if (!auth) {
    return {};
  }

  const resolved = typeof auth === "function" ? await auth() : auth;
  const authRecord = resolved as Record<string, unknown>;
  const headers: Record<string, string> = {
    ...(resolved.headers ?? {}),
  };

  const token =
    typeof resolved.getToken === "function"
      ? await resolved.getToken()
      : resolved.token;
  if (typeof token === "string" && token.length > 0) {
    headers.authorization = \`Bearer \${token}\`;
  }

  for (const [key, value] of Object.entries(authRecord)) {
    if (
      typeof value === "string" &&
      key !== "userId" &&
      key !== "tenantId" &&
      key !== "organizationId" &&
      key !== "organizationMembershipId" &&
      key !== "role" &&
      key !== "roles" &&
      key !== "permissions" &&
      key !== "claims" &&
      key !== "token"
    ) {
      headers[key] = value;
    }
  }

  if (resolved.userId) {
    headers["x-forge-user-id"] = resolved.userId;
  }
  if (resolved.tenantId) {
    headers["x-forge-tenant-id"] = resolved.tenantId;
  }
  if (resolved.organizationId) {
    headers["x-forge-organization-id"] = resolved.organizationId;
    headers["x-forge-tenant-id"] ??= resolved.organizationId;
  }
  if (resolved.organizationMembershipId) {
    headers["x-forge-organization-membership-id"] = resolved.organizationMembershipId;
  }
  if (resolved.role) {
    headers["x-forge-role"] = resolved.role;
  }
  if (Array.isArray(resolved.roles)) {
    headers["x-forge-roles"] = JSON.stringify(resolved.roles);
  }
  if (Array.isArray(resolved.permissions)) {
    headers["x-forge-permissions"] = JSON.stringify(resolved.permissions);
  }
  if (resolved.claims && typeof resolved.claims === "object") {
    headers["x-forge-claims"] = JSON.stringify(resolved.claims);
  }

  return headers;
}

function toForgeError(error: unknown, code: string): ForgeError {
  if (error instanceof ForgeError) {
    return error;
  }
  return new ForgeError(error instanceof Error ? error.message : String(error), {
    code,
  });
}

function parseJsonPayload(body: unknown): {
  ok?: boolean;
  result?: unknown;
  traceId?: string;
  error?: { code: string; message: string; details?: unknown };
  diagnostics?: { code: string; message: string }[];
} {
  return body as {
    ok?: boolean;
    result?: unknown;
    traceId?: string;
    error?: { code: string; message: string; details?: unknown };
    diagnostics?: { code: string; message: string }[];
  };
}

function normalizeExternalRef(
  ref: ExternalCommandRef | ExternalQueryRef,
): { service: string; name: string } {
  if (typeof ref === "string") {
    const [service, ...entryParts] = ref.split(".");
    return { service: service ?? "", name: entryParts.join(".") };
  }
  return { service: ref.service, name: ref.name };
}

class ForgeHttpClient implements ForgeClient {
  lastTraceId?: string;

  constructor(private readonly config: ForgeClientConfig) {}

  query(name: string, args: unknown): Promise<unknown> {
    return this.invoke("queries", name, args);
  }

  command(name: string, args: unknown): Promise<unknown> {
    return this.invoke("commands", name, args);
  }

  externalQuery(name: ExternalQueryRef, args: unknown): Promise<unknown> {
    return this.invokeExternal("queries", name, args);
  }

  externalCommand(name: ExternalCommandRef, args: unknown): Promise<unknown> {
    return this.invokeExternal("commands", name, args);
  }

  liveQuery(
    name: string,
    args: unknown,
    onSnapshot: (snapshot: LiveSnapshot<unknown>) => void,
    onError?: (error: ForgeError) => void,
    options?: LiveQueryOptions,
  ) {
    const controller = new AbortController();
    const externalSignal = options?.signal;
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });

    void this.openLiveQuery(name, args, onSnapshot, onError, controller.signal)
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        onError?.(
          toForgeError(error, "FORGE_LIVEQUERY_SUBSCRIPTION_FAILED"),
        );
      })
      .finally(() => externalSignal?.removeEventListener("abort", abort));

    return () => controller.abort();
  }

  private async invoke(
    kind: "queries" | "commands",
    name: string,
    args: unknown,
  ): Promise<unknown> {
    const baseUrl = this.config.url.replace(/\\/$/, "");
    const url = \`\${baseUrl}/\${kind}/\${encodeURIComponent(name)}\`;
    const authHeaders = await resolveAuthHeaders(this.config.auth);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ args }),
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ForgeError(\`HTTP \${response.status}\`, {
        code: "FORGE_HTTP_ERROR",
        status: response.status,
      });
    }

    const payload = parseJsonPayload(body);
    this.lastTraceId = payload.traceId;

    if (!response.ok || payload.ok === false) {
      const diagnostic = payload.diagnostics?.find((entry) => entry.code);
      const code =
        payload.error?.code ?? diagnostic?.code ?? "FORGE_REQUEST_FAILED";
      const message =
        payload.error?.message ??
        diagnostic?.message ??
        \`Request failed with status \${response.status}\`;
      throw new ForgeError(message, {
        code,
        traceId: payload.traceId,
        status: response.status,
        details: payload.error?.details ?? payload.diagnostics,
      });
    }

    return payload.result;
  }

  private async invokeExternal(
    kind: "queries" | "commands",
    name: ExternalCommandRef | ExternalQueryRef,
    args: unknown,
  ): Promise<unknown> {
    const normalized = normalizeExternalRef(name);
    const serviceName = normalized.service;
    const entryName = normalized.name;
    if (!serviceName || !entryName) {
      throw new ForgeError(\`External runtime name must be service.entry\`, {
        code: "FORGE_EXTERNAL_RUNTIME_NOT_FOUND",
      });
    }
    const baseUrl = this.config.url.replace(/\\/$/, "");
    const url = \`\${baseUrl}/external/\${encodeURIComponent(serviceName)}/\${kind}/\${encodeURIComponent(entryName)}\`;
    return this.invokeUrl(url, args);
  }

  private async invokeUrl(url: string, args: unknown): Promise<unknown> {
    const authHeaders = await resolveAuthHeaders(this.config.auth);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ args }),
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ForgeError(\`HTTP \${response.status}\`, {
        code: "FORGE_HTTP_ERROR",
        status: response.status,
      });
    }

    const payload = parseJsonPayload(body);
    this.lastTraceId = payload.traceId;

    if (!response.ok || payload.ok === false) {
      const diagnostic = payload.diagnostics?.find((entry) => entry.code);
      const code =
        payload.error?.code ?? diagnostic?.code ?? "FORGE_REQUEST_FAILED";
      const message =
        payload.error?.message ??
        diagnostic?.message ??
        \`Request failed with status \${response.status}\`;
      throw new ForgeError(message, {
        code,
        traceId: payload.traceId,
        status: response.status,
        details: payload.error?.details ?? payload.diagnostics,
      });
    }

    return payload.result;
  }

  private async openLiveQuery(
    name: string,
    args: unknown,
    onSnapshot: (snapshot: LiveSnapshot<unknown>) => void,
    onError: ((error: ForgeError) => void) | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const baseUrl = this.config.url.replace(/\\/$/, "");
    const encodedArgs = encodeURIComponent(JSON.stringify(args ?? {}));
    const url = \`\${baseUrl}/live/\${encodeURIComponent(name)}?args=\${encodedArgs}\`;
    const authHeaders = await resolveAuthHeaders(this.config.auth);

    const response = await fetch(url, {
      method: "GET",
      headers: authHeaders,
      signal,
    });

    if (!response.ok || !response.body) {
      throw new ForgeError(\`Live query failed with status \${response.status}\`, {
        code: "FORGE_LIVEQUERY_SUBSCRIPTION_FAILED",
        status: response.status,
      });
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\\n\\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          this.handleSseFrame(frame, onSnapshot, onError);
          boundary = buffer.indexOf("\\n\\n");
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  private handleSseFrame(
    frame: string,
    onSnapshot: (snapshot: LiveSnapshot<unknown>) => void,
    onError?: (error: ForgeError) => void,
  ): void {
    const lines = frame.split(/\\r?\\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\\n");
    if (!data) {
      return;
    }

    const payload = JSON.parse(data) as {
      type?: string;
      subscriptionId?: string;
      revision?: number;
      data?: unknown;
      traceId?: string;
      error?: { code: string; message: string; traceId?: string };
    };

    if (event === "snapshot" || payload.type === "snapshot") {
      this.lastTraceId = payload.traceId;
      onSnapshot({
        subscriptionId: String(payload.subscriptionId),
        revision: Number(payload.revision),
        data: payload.data,
        traceId: payload.traceId,
      });
      return;
    }

    if (event === "error" || payload.type === "error") {
      onError?.(
        new ForgeError(payload.error?.message ?? "liveQuery failed", {
          code: payload.error?.code ?? "FORGE_LIVEQUERY_SUBSCRIPTION_FAILED",
          traceId: payload.error?.traceId,
          details: payload.error,
        }),
      );
    }
  }
}

export function createForgeClient(config: ForgeClientConfig): ForgeClient {
  return new ForgeHttpClient(config);
}
`;
}

export function renderClientManifestTs(manifest: ClientManifest): string {
  return `export const clientManifest = ${JSON.stringify(manifest, null, 2)} as const;\n`;
}

export function renderReactTs(): string {
  return `"use client";

import { createForgeReactBindings } from "forge/react";
import { createForgeClient } from "./client.ts";

export type {
  ForgeProviderProps,
  ForgeDevAuthConfig,
  ForgeReactAuth,
  ForgeReactAuthProvider,
  ForgeReactClient,
  ForgeReactError,
  UseCommandOptions,
  UseCommandResult,
  UseLiveQueryOptions,
  UseLiveQueryResult,
  UseQueryOptions,
  UseQueryResult,
} from "forge/react";

const forgeReact = createForgeReactBindings(createForgeClient);

export const ForgeProvider = forgeReact.ForgeProvider;
export const useForgeClient = forgeReact.useForgeClient;
export const useAuth = forgeReact.useAuth;
export const useQuery = forgeReact.useQuery;
export const useCommand = forgeReact.useCommand;
export const useLiveQuery = forgeReact.useLiveQuery;
`;
}

export function renderReactDts(): string {
  return `export type {
  ForgeProviderProps,
  ForgeDevAuthConfig,
  ForgeReactAuth,
  ForgeReactAuthProvider,
  ForgeReactClient,
  ForgeReactError,
  UseCommandOptions,
  UseCommandResult,
  UseLiveQueryOptions,
  UseLiveQueryResult,
  UseQueryOptions,
  UseQueryResult,
} from "forge/react";

export declare const ForgeProvider: import("forge/react").ForgeReactBindings["ForgeProvider"];
export declare const useForgeClient: import("forge/react").ForgeReactBindings["useForgeClient"];
export declare const useAuth: import("forge/react").ForgeReactBindings["useAuth"];
export declare const useQuery: import("forge/react").ForgeReactBindings["useQuery"];
export declare const useCommand: import("forge/react").ForgeReactBindings["useCommand"];
export declare const useLiveQuery: import("forge/react").ForgeReactBindings["useLiveQuery"];
`;
}

export function renderReactManifestTs(manifest: ReactManifest): string {
  return `export const reactManifest = ${JSON.stringify(manifest, null, 2)} as const;\n`;
}

export function renderVueTs(): string {
  return `import { createForgeVueBindings } from "forge/vue";
import { createForgeClient } from "./client.ts";

export type {
  ForgeDevAuthConfig,
  ForgeVueAuth,
  ForgeVueAuthProvider,
  ForgeVueBindings,
  ForgeVueClient,
  ForgeVueClientConfig,
  ForgeVueError,
  ForgeVuePluginOptions,
  UseForgeCommandOptions,
  UseForgeCommandResult,
  UseForgeLiveQueryOptions,
  UseForgeLiveQueryResult,
  UseForgeQueryOptions,
  UseForgeQueryResult,
} from "forge/vue";

const forgeVue = createForgeVueBindings(createForgeClient);

export const ForgeVuePlugin = forgeVue.ForgeVuePlugin;
export const provideForge = forgeVue.provideForge;
export const useForgeClient = forgeVue.useForgeClient;
export const useForgeAuth = forgeVue.useForgeAuth;
export const useForgeQuery = forgeVue.useForgeQuery;
export const useForgeCommand = forgeVue.useForgeCommand;
export const useForgeLiveQuery = forgeVue.useForgeLiveQuery;
`;
}

export function renderVueDts(): string {
  return `export type {
  ForgeDevAuthConfig,
  ForgeVueAuth,
  ForgeVueAuthProvider,
  ForgeVueBindings,
  ForgeVueClient,
  ForgeVueClientConfig,
  ForgeVueError,
  ForgeVuePluginOptions,
  UseForgeCommandOptions,
  UseForgeCommandResult,
  UseForgeLiveQueryOptions,
  UseForgeLiveQueryResult,
  UseForgeQueryOptions,
  UseForgeQueryResult,
} from "forge/vue";

export declare const ForgeVuePlugin: import("forge/vue").ForgeVueBindings["ForgeVuePlugin"];
export declare const provideForge: import("forge/vue").ForgeVueBindings["provideForge"];
export declare const useForgeClient: import("forge/vue").ForgeVueBindings["useForgeClient"];
export declare const useForgeAuth: import("forge/vue").ForgeVueBindings["useForgeAuth"];
export declare const useForgeQuery: import("forge/vue").ForgeVueBindings["useForgeQuery"];
export declare const useForgeCommand: import("forge/vue").ForgeVueBindings["useForgeCommand"];
export declare const useForgeLiveQuery: import("forge/vue").ForgeVueBindings["useForgeLiveQuery"];
`;
}

export function renderVueManifestTs(manifest: VueManifest): string {
  return `export const vueManifest = ${JSON.stringify(manifest, null, 2)} as const;\n`;
}
