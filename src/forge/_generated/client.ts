// @forge-generated generator=0.1.0-alpha.16 input=48860df69cb90d3dd3e4ab7f4a96c04ae6aaf13e86500ee34868ba58a6c23650 content=beb8a95a58b094f5f4f5407dc18f0e22f9f88c30747976a374dacea44feef3f2
import { api } from "./api.ts";
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
    headers.authorization = `Bearer ${token}`;
  }

  for (const [key, value] of Object.entries(authRecord)) {
    if (
      typeof value === "string" &&
      key !== "userId" &&
      key !== "tenantId" &&
      key !== "role" &&
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
  if (resolved.role) {
    headers["x-forge-role"] = resolved.role;
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
    const baseUrl = this.config.url.replace(/\/$/, "");
    const url = `${baseUrl}/${kind}/${encodeURIComponent(name)}`;
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
      throw new ForgeError(`HTTP ${response.status}`, {
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
        `Request failed with status ${response.status}`;
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
      throw new ForgeError(`External runtime name must be service.entry`, {
        code: "FORGE_EXTERNAL_RUNTIME_NOT_FOUND",
      });
    }
    const baseUrl = this.config.url.replace(/\/$/, "");
    const url = `${baseUrl}/external/${encodeURIComponent(serviceName)}/${kind}/${encodeURIComponent(entryName)}`;
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
      throw new ForgeError(`HTTP ${response.status}`, {
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
        `Request failed with status ${response.status}`;
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
    const baseUrl = this.config.url.replace(/\/$/, "");
    const encodedArgs = encodeURIComponent(JSON.stringify(args ?? {}));
    const url = `${baseUrl}/live/${encodeURIComponent(name)}?args=${encodedArgs}`;
    const authHeaders = await resolveAuthHeaders(this.config.auth);

    const response = await fetch(url, {
      method: "GET",
      headers: authHeaders,
      signal,
    });

    if (!response.ok || !response.body) {
      throw new ForgeError(`Live query failed with status ${response.status}`, {
        code: "FORGE_LIVEQUERY_SUBSCRIPTION_FAILED",
        status: response.status,
      });
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";

    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        this.handleSseFrame(frame, onSnapshot, onError);
        boundary = buffer.indexOf("\n\n");
      }
    }
  }

  private handleSseFrame(
    frame: string,
    onSnapshot: (snapshot: LiveSnapshot<unknown>) => void,
    onError?: (error: ForgeError) => void,
  ): void {
    const lines = frame.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
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
