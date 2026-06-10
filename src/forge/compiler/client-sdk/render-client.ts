import type { ClientManifest } from "./build-manifest.ts";

export function renderClientTypesTs(): string {
  return `export type ForgeStaticAuth = {
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
`;
}

export function renderClientTs(): string {
  return `import { api } from "./api.ts";
import type {
  ForgeAuthProvider,
  ForgeClient,
  ForgeClientConfig,
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
  LiveQueryOptions,
  LiveSnapshot,
  Unsubscribe,
} from "./clientTypes.ts";

async function resolveAuthHeaders(
  auth: ForgeAuthProvider,
): Promise<Record<string, string>> {
  if (typeof auth === "function") {
    return auth();
  }
  return {
    "x-forge-user-id": auth.userId,
    "x-forge-tenant-id": auth.tenantId,
    "x-forge-role": auth.role,
  };
}

class ForgeHttpClient implements ForgeClient {
  constructor(private readonly config: ForgeClientConfig) {}

  query(name: string, args: unknown): Promise<unknown> {
    return this.invoke("queries", name, args);
  }

  command(name: string, args: unknown): Promise<unknown> {
    return this.invoke("commands", name, args);
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
          error instanceof ForgeError
            ? error
            : new ForgeError(error instanceof Error ? error.message : String(error), {
                code: "FORGE_LIVEQUERY_SUBSCRIPTION_FAILED",
              }),
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

    const payload = body as {
      ok?: boolean;
      result?: unknown;
      traceId?: string;
      error?: { code: string; message: string };
      diagnostics?: { code: string; message: string }[];
    };

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
