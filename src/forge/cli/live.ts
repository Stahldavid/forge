export type LiveSubcommand =
  | "list"
  | "subscribe"
  | "status"
  | "debug"
  | "invalidations"
  | "test"
  | "load-test";

export interface RunLiveCommandOptions {
  subcommand: LiveSubcommand;
  name?: string;
  args?: unknown;
  json: boolean;
  userId?: string;
  tenantId?: string;
  role?: string;
  url?: string;
}

function baseUrl(options: RunLiveCommandOptions): string {
  return (options.url ?? process.env.FORGE_DEV_URL ?? "http://127.0.0.1:3765").replace(
    /\/$/,
    "",
  );
}

function authHeaders(options: RunLiveCommandOptions): Record<string, string> {
  return {
    ...(options.userId ? { "x-forge-user-id": options.userId } : {}),
    ...(options.tenantId ? { "x-forge-tenant-id": options.tenantId } : {}),
    ...(options.role ? { "x-forge-role": options.role } : {}),
  };
}

export async function runLiveCommand(options: RunLiveCommandOptions): Promise<number> {
  if (options.subcommand === "list") {
    const response = await fetch(`${baseUrl(options)}/live`);
    const body = (await response.json().catch(() => ({}))) as {
      liveQueries?: string[];
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(body)}\n`);
    } else {
      for (const name of body.liveQueries ?? []) {
        process.stdout.write(`${name}\n`);
      }
    }
    return response.ok ? 0 : 1;
  }

  if (options.subcommand === "status") {
    const response = await fetch(`${baseUrl(options)}/live/status`);
    const body = await response.json().catch(() => ({}));
    process.stdout.write(options.json ? `${JSON.stringify(body)}\n` : `${JSON.stringify(body, null, 2)}\n`);
    return response.ok ? 0 : 1;
  }

  if (options.subcommand === "invalidations") {
    const response = await fetch(`${baseUrl(options)}/live/invalidations`);
    const body = await response.json().catch(() => ({}));
    process.stdout.write(options.json ? `${JSON.stringify(body)}\n` : `${JSON.stringify(body, null, 2)}\n`);
    return response.ok ? 0 : 1;
  }

  if (options.subcommand === "debug") {
    if (!options.name) {
      throw new Error("forge live debug requires a subscription id");
    }
    const response = await fetch(
      `${baseUrl(options)}/live/debug/${encodeURIComponent(options.name)}`,
    );
    const body = await response.json().catch(() => ({}));
    process.stdout.write(options.json ? `${JSON.stringify(body)}\n` : `${JSON.stringify(body, null, 2)}\n`);
    return response.ok ? 0 : 1;
  }

  if (options.subcommand === "test" || options.subcommand === "load-test") {
    const response = await fetch(`${baseUrl(options)}/live/status`);
    const body = await response.json().catch(() => ({}));
    process.stdout.write(
      `${JSON.stringify({
        ok: response.ok,
        mode: options.subcommand,
        status: body,
      })}\n`,
    );
    return response.ok ? 0 : 1;
  }

  if (!options.name) {
    throw new Error("forge live requires a liveQuery name");
  }

  const encodedArgs = encodeURIComponent(JSON.stringify(options.args ?? {}));
  const response = await fetch(
    `${baseUrl(options)}/live/${encodeURIComponent(options.name)}?args=${encodedArgs}`,
    {
      headers: authHeaders(options),
    },
  );

  if (!response.ok || !response.body) {
    process.stderr.write(`live query failed: HTTP ${response.status}\n`);
    return 1;
  }

  if (!options.json) {
    process.stdout.write(`[connected] ${options.name}\n`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = frame
        .split(/\r?\n/)
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim();
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        const payload = JSON.parse(data) as {
          type?: string;
          revision?: number;
          data?: unknown;
          error?: { code: string; message: string };
        };
        if (event === "snapshot" || payload.type === "snapshot") {
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({
                type: "snapshot",
                revision: payload.revision,
                data: payload.data,
              })}\n`,
            );
          } else {
            process.stdout.write(
              `[revision ${payload.revision}] ${JSON.stringify(payload.data)}\n`,
            );
          }
        } else if (event === "error" || payload.type === "error") {
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({
                type: "error",
                error: payload.error,
              })}\n`,
            );
          } else {
            process.stderr.write(
              `[error] ${payload.error?.code ?? "FORGE_LIVEQUERY_UNKNOWN"}: ${
                payload.error?.message ?? "live query failed"
              }\n`,
            );
          }
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  return 0;
}
