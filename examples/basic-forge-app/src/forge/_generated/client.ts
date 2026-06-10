// @forge-generated generator=0.0.0 input=54f3f6b66f87a575bff2d09c80de50b1bfca193d6bbbd7adb6204ec0df01c245 content=cd9bae8a0236b92d2946d2468f1370cd417c0367dea58cca2242adab044c0be9
import { api } from "./api.ts";
import type {
  ForgeAuthProvider,
  ForgeClient,
  ForgeClientConfig,
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
        `Request failed with status ${response.status}`;
      throw new ForgeError(message, {
        code,
        traceId: payload.traceId,
        status: response.status,
      });
    }

    return payload.result;
  }
}

export function createForgeClient(config: ForgeClientConfig): ForgeClient {
  return new ForgeHttpClient(config);
}
