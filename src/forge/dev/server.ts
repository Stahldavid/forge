import { existsSync, readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import {
  FORGE_AUTH_DEV_HEADERS_IN_PRODUCTION,
  FORGE_DEV_INVOKE_FAILED,
  FORGE_DEV_SERVER_ERROR,
  FORGE_POLICY_DENIED,
  FORGE_RUNTIME_NOT_FOUND,
} from "../compiler/diagnostics/codes.ts";
import { authenticateHeaders } from "../runtime/auth/authenticate.ts";
import { loadAuthConfigFromEnv } from "../runtime/auth/config.ts";
import { ForgeAuthError } from "../runtime/auth/errors.ts";
import type { TableMapEntry } from "../compiler/data-graph/sql/serialize.ts";
import type { SqlPlan } from "../compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { DevManifest } from "../compiler/types/dev-manifest.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { RuntimeGraph } from "../compiler/types/runtime-graph.ts";
import { createDbAdapter } from "../runtime/db/factory.ts";
import { applyMigrations } from "../runtime/db/migrate.ts";
import {
  listEntries,
  prepareRuntimeEnvironment,
  runEntry,
} from "../runtime/executor.ts";
import { listQueries, runQuery } from "../runtime/query/run-query.ts";
import {
  getOutboxSummary,
  listOutboxDeliveries,
  startOutboxWorker,
} from "../runtime/outbox/process.ts";
import { cancelWorkflowRun } from "../runtime/workflows/cancel.ts";
import { createWorkflowRun } from "../runtime/workflows/create-run.ts";
import {
  getWorkflowSummary,
  inspectWorkflowRun,
  listWorkflowRuns,
  runWorkerTick,
} from "../runtime/workflows/process.ts";
import { loadWorkflowRegistry } from "../runtime/workflows/registry.ts";
import { retryWorkflowRun } from "../runtime/workflows/retry-run.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { canonicalJson } from "../compiler/primitives/serialize.ts";
import type { DevServerHandle, DevServerOptions, DevServerReloadResult, DevServerState } from "./types.ts";
import { getTelemetrySummary, inspectTrace } from "../runtime/telemetry/flush.ts";
import { processTelemetryBatch } from "../runtime/telemetry/process.ts";
import { getRuntimeEnvStore } from "../runtime/context/create-context.ts";
import {
  countMissingRequiredSecrets,
  loadSecretRegistry,
} from "../runtime/secrets/check.ts";
import { checkAiProviders, loadAiRegistry } from "../runtime/ai/check.ts";
import { isMockAiEnabled } from "../runtime/ai/state.ts";
import { createAiContext } from "../runtime/ai/context.ts";
import type { ForgeAiProvider, ForgeAiToolDefinition } from "../runtime/ai/types.ts";
import { resolveLanguageModel } from "../runtime/ai/providers.ts";
import { createRuntimeSecretsBundle } from "../runtime/secrets/runtime-bundle.ts";
import { createNoopTelemetryContext, createTelemetryContext } from "../runtime/telemetry/context.ts";
import { generateTraceId } from "../runtime/telemetry/correlation.ts";
import type { AgentToolRegistry } from "../compiler/agent-contract/types.ts";
import { loadLiveQueryRegistry } from "../runtime/live/registry.ts";
import { createLiveSubscriptionManager } from "../runtime/live/subscription-manager.ts";
import { createSseResponse } from "../runtime/live/sse.ts";
import {
  ensureLiveInvalidationSchema,
  listLiveInvalidations,
} from "../runtime/live/invalidation-log.ts";
import { currentReleaseInfo } from "../runtime/release/runtime.ts";
import { DEFAULT_LIVE_LIMITS } from "../runtime/live/types.ts";
import {
  loadExternalServiceGraph,
  runExternalEntry,
} from "../runtime/external/bridge.ts";

interface FetchServer {
  hostname?: string;
  port: number;
  stop(force?: boolean): void;
}

async function readIncomingBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function nodeRequestToFetch(
  request: IncomingMessage,
  input: { host: string; port: number; signal?: AbortSignal },
): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const url = `http://${input.host}:${input.port}${request.url ?? "/"}`;
  const body = await readIncomingBody(request);
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body: body ? new Blob([new Uint8Array(body)]) : undefined,
    signal: input.signal,
    ...(body ? { duplex: "half" as const } : {}),
  };
  return new Request(url, init);
}

export async function writeFetchResponse(
  response: ServerResponse,
  fetchResponse: Response,
): Promise<void> {
  response.statusCode = fetchResponse.status;
  fetchResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });

  if (!fetchResponse.body) {
    response.end();
    return;
  }

  const reader = fetchResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      response.write(Buffer.from(value));
    }
    response.end();
  } catch (error) {
    response.destroy(error instanceof Error ? error : undefined);
  } finally {
    reader.releaseLock();
  }
}

async function createNodeFetchServer(
  input: { hostname: string; port: number },
  fetchHandler: (request: Request) => Promise<Response>,
): Promise<FetchServer> {
  let actualPort = input.port;
  const nodeServer: NodeHttpServer = createServer(async (request, response) => {
    const controller = new AbortController();
    response.once("close", () => controller.abort());
    try {
      const fetchRequest = await nodeRequestToFetch(request, {
        host: input.hostname,
        port: actualPort,
        signal: controller.signal,
      });
      const fetchResponse = await fetchHandler(fetchRequest);
      await writeFetchResponse(response, fetchResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : "dev server request failed";
      await writeFetchResponse(
        response,
        jsonResponse(
          {
            ok: false,
            diagnostics: [
              createDiagnostic({
                severity: "error",
                code: FORGE_DEV_SERVER_ERROR,
                message,
              }),
            ],
          },
          500,
        ),
      );
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    nodeServer.once("error", reject);
    nodeServer.listen(input.port, input.hostname, () => {
      nodeServer.off("error", reject);
      resolveListen();
    });
  });

  const address = nodeServer.address();
  actualPort = typeof address === "object" && address ? address.port : input.port;
  return {
    hostname: input.hostname,
    port: actualPort,
    stop: () => {
      nodeServer.close();
    },
  };
}

async function createFetchServer(
  input: { hostname: string; port: number },
  fetchHandler: (request: Request) => Promise<Response>,
): Promise<FetchServer> {
  const bunGlobal = globalThis as {
    Bun?: {
      serve?: (options: {
        hostname: string;
        port: number;
        idleTimeout: number;
        fetch: (request: Request) => Promise<Response>;
      }) => FetchServer;
    };
  };

  if (bunGlobal.Bun?.serve) {
    return bunGlobal.Bun.serve({
      hostname: input.hostname,
      port: input.port,
      idleTimeout: 255,
      fetch: fetchHandler,
    });
  }

  return createNodeFetchServer(input, fetchHandler);
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!existsSync(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader(readFileSync(absolute, "utf8"));
  return JSON.parse(raw) as T;
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, x-forge-user-id, x-forge-tenant-id, x-forge-role",
    },
  });
}

function acceptsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDevHome(input: {
  service: string;
  db: unknown;
  webUrl?: string;
  entries: Array<{ name: string; kind: string; path: string; method: string }>;
  routes: Array<{ method: string; path: string; purpose: string }>;
}): string {
  const entries = input.entries
    .map(
      (entry) =>
        `<li><code>${escapeHtml(entry.method)} ${escapeHtml(entry.path)}</code> <span>${escapeHtml(entry.kind)}:${escapeHtml(entry.name)}</span></li>`,
    )
    .join("");
  const routes = input.routes
    .slice(0, 20)
    .map(
      (route) =>
        `<li><code>${escapeHtml(route.method)} ${escapeHtml(route.path)}</code> <span>${escapeHtml(route.purpose)}</span></li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Forge Dev</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; padding: 32px; line-height: 1.5; background: Canvas; color: CanvasText; }
    main { max-width: 920px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    h2 { margin-top: 28px; font-size: 18px; }
    p { color: color-mix(in srgb, CanvasText 75%, Canvas 25%); }
    ul { padding-left: 20px; }
    li { margin: 8px 0; }
    code { padding: 2px 6px; border-radius: 6px; background: color-mix(in srgb, CanvasText 10%, Canvas 90%); }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; margin: 18px 0; }
    .pill { border: 1px solid color-mix(in srgb, CanvasText 18%, Canvas 82%); border-radius: 999px; padding: 4px 10px; }
  </style>
</head>
<body>
  <main>
    <h1>Forge Dev</h1>
    <p>This server is an API surface for Forge commands, queries, liveQueries, workflows, telemetry, and health checks.</p>
    <div class="meta">
      <span class="pill">service: ${escapeHtml(input.service)}</span>
      <span class="pill">db: ${escapeHtml(input.db)}</span>
      ${input.webUrl ? `<a class="pill" href="${escapeHtml(input.webUrl)}">web: ${escapeHtml(input.webUrl)}</a>` : ""}
    </div>
    <h2>Start Here</h2>
    <ul>
      <li><code>GET /health</code> checks server, DB, worker, auth, env, AI, and liveQuery state.</li>
      <li><code>GET /entries</code> lists callable commands, actions, queries, and liveQueries.</li>
      <li>Commands and queries require <code>POST</code> with JSON body <code>{"args":{}}</code>.</li>
    </ul>
    <h2>Entries</h2>
    <ul>${entries || "<li>No entries generated yet.</li>"}</ul>
    <h2>Routes</h2>
    <ul>${routes || "<li>No routes generated yet.</li>"}</ul>
  </main>
</body>
</html>`;
}

function methodHelpResponse(input: {
  kind: "command" | "action" | "query";
  name: string;
  path: string;
}): Response {
  return jsonResponse(
    {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_DEV_INVOKE_FAILED,
          message: `${input.kind} '${input.name}' requires POST ${input.path}`,
          fixHint: `Send JSON like {"args":{}} to POST ${input.path}.`,
        }),
      ],
      example: {
        method: "POST",
        path: input.path,
        body: { args: {} },
      },
    },
    405,
    { Allow: "POST, OPTIONS" },
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message.length > 0
  ) {
    return (error as { message: string }).message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  const stringified = String(error);
  return stringified && stringified !== "[object Object]" ? stringified : fallback;
}

function parseInvokeName(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const name = pathname.slice(prefix.length);
  return name.length > 0 ? decodeURIComponent(name) : null;
}

function parseExternalInvoke(pathname: string): {
  serviceName: string;
  kind: "command" | "query";
  entryName: string;
} | null {
  const match = pathname.match(/^\/external\/([^/]+)\/(commands|queries)\/([^/]+)$/);
  if (!match) {
    return null;
  }
  return {
    serviceName: decodeURIComponent(match[1]!),
    kind: match[2] === "commands" ? "command" : "query",
    entryName: decodeURIComponent(match[3]!),
  };
}

function loadAgentToolRegistry(workspaceRoot: string): AgentToolRegistry | null {
  return readGeneratedJson<AgentToolRegistry>(
    workspaceRoot,
    `${GENERATED_DIR}/agentTools.json`,
  );
}

async function listDatabaseTables(adapter: NonNullable<DevServerState["adapter"]>): Promise<string[]> {
  const result = await adapter.query(
    `SELECT c.relname AS table_name
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
     ORDER BY c.relname`,
  );
  return result.rows.map((row) => String(row.table_name));
}

type RuntimeAgentDefinition = {
  provider?: ForgeAiProvider;
  model: string;
  instructions: string;
  tools?: Record<string, ForgeAiToolDefinition> | string[];
  stopWhen?: { kind: "stepCount"; maxSteps: number } | { kind: "toolCall"; toolName: string };
  maxSteps?: number;
};

async function loadNamedAgentDefinition(
  workspaceRoot: string,
  name: string | undefined,
): Promise<RuntimeAgentDefinition | null> {
  if (!name) {
    return null;
  }
  const registry = loadAiRegistry(workspaceRoot);
  const metadata = registry?.agents.find((agent) => agent.name === name);
  if (!metadata) {
    throw new Error(`unknown Forge AI agent '${name}'`);
  }

  const mod = (await import(pathToFileURL(join(workspaceRoot, metadata.file)).href)) as Record<
    string,
    unknown
  >;
  const definition = mod[metadata.name];
  if (!definition || typeof definition !== "object") {
    throw new Error(`Forge AI agent '${name}' was not exported from ${metadata.file}`);
  }

  const agent = definition as Partial<RuntimeAgentDefinition>;
  if (!agent.model || !agent.instructions) {
    throw new Error(`Forge AI agent '${name}' is missing model or instructions`);
  }
  return {
    provider: agent.provider ?? metadata.provider,
    model: agent.model,
    instructions: agent.instructions,
    tools: agent.tools,
    stopWhen:
      agent.stopWhen ??
      (metadata.stopWhen.kind === "default" ? undefined : metadata.stopWhen),
    maxSteps: agent.maxSteps,
  };
}

function explicitAgentTools(
  definition: RuntimeAgentDefinition | null,
): Record<string, ForgeAiToolDefinition> {
  if (!definition?.tools || Array.isArray(definition.tools)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(definition.tools).filter(([, toolDefinition]) =>
      Boolean(
        toolDefinition &&
          typeof toolDefinition === "object" &&
          "handler" in toolDefinition &&
          "inputSchema" in toolDefinition,
      ),
    ),
  );
}

function buildAutoAgentTools(input: {
  workspaceRoot: string;
  registry: AgentToolRegistry | null;
  selected?: string[];
  adapter: DevServerState["adapter"];
  tableMap: Record<string, TableMapEntry>;
  auth: Awaited<ReturnType<typeof authenticateHeaders>>;
  liveManager?: ReturnType<typeof createLiveSubscriptionManager> | null;
  json: boolean;
  mock: boolean;
}): Record<string, ForgeAiToolDefinition> {
  const selected = new Set(input.selected ?? []);
  const includeAll = selected.size === 0;
  const tools: Record<string, ForgeAiToolDefinition> = {};
  for (const toolInfo of input.registry?.autoTools ?? []) {
    if (!includeAll && !selected.has(toolInfo.name) && !selected.has(toolInfo.sourceName)) {
      continue;
    }
    tools[toolInfo.name] = {
      description: `${toolInfo.readOnly ? "Read" : "Execute"} Forge ${toolInfo.sourceKind} '${toolInfo.sourceName}'. Policy: ${toolInfo.policy ?? "none"}.`,
      inputSchema: {
        type: "object",
        properties: {
          args: {
            type: "object",
            additionalProperties: true,
          },
        },
        additionalProperties: true,
      },
      risk: toolInfo.readOnly ? "read" : "write",
      needsApproval: !toolInfo.readOnly,
      handler: async (_ctx, rawInput) => {
        const objectInput =
          rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
            ? rawInput as { args?: unknown }
            : {};
        const args = objectInput.args ?? rawInput ?? {};
        if (!input.adapter) {
          throw new Error("database not connected");
        }
        if (toolInfo.sourceKind === "query" || toolInfo.sourceKind === "liveQuery") {
          const result = await runQuery(
            input.workspaceRoot,
            toolInfo.sourceName,
            { args, auth: input.auth },
            {
              adapter: input.adapter,
              tableMap: input.tableMap,
            },
          );
          if (!result.ok) {
            throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
          }
          return { result: result.result, traceId: result.traceId };
        }
        const result = await runEntry(input.workspaceRoot, toolInfo.sourceName, {
          json: input.json,
          mock: input.mock,
          args,
          db: input.adapter,
          auth: input.auth,
          liveManager: input.liveManager ?? undefined,
        });
        if (!result.ok) {
          throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
        }
        return { result: result.result, traceId: result.traceId };
      },
    };
  }
  return tools;
}

async function buildAiSdkTools(input: {
  tools: Record<string, ForgeAiToolDefinition>;
  provider: ForgeAiProvider;
  model: string;
  purpose?: string;
  traceId: string;
  secrets: ReturnType<typeof createRuntimeSecretsBundle>["secrets"];
  telemetry: ReturnType<typeof createTelemetryContext> | ReturnType<typeof createNoopTelemetryContext>;
  env: Record<string, string | undefined>;
  auth: Awaited<ReturnType<typeof authenticateHeaders>>;
  deltaRecorder?: DevServerOptions["deltaRecorder"];
}): Promise<Record<string, unknown>> {
  const { tool } = await import("ai");
  return Object.fromEntries(
    Object.entries(input.tools).map(([name, definition]) => {
      const needsApproval = definition.needsApproval;
      return [
        name,
        tool({
          description: definition.description,
          inputSchema: definition.inputSchema as never,
          ...(definition.outputSchema ? { outputSchema: definition.outputSchema as never } : {}),
          ...(definition.strict !== undefined ? { strict: definition.strict } : {}),
          ...(needsApproval !== undefined
            ? {
                needsApproval:
                  typeof needsApproval === "function"
                    ? async ({ args }: { args: unknown }) =>
                        Boolean(await needsApproval(args as never))
                    : needsApproval,
              }
            : {}),
          execute: async (args: unknown) => {
            const startedAt = Date.now();
            await input.telemetry.capture("forge.ai.tool.started", {
              traceId: input.traceId,
              provider: input.provider,
              model: input.model,
              purpose: input.purpose,
              tool: name,
              risk: definition.risk ?? "external",
            });
            try {
              const output = await definition.handler(
                {
                  secrets: input.secrets,
                  env: input.env,
                  telemetry: input.telemetry,
                  auth: input.auth,
                },
                args as never,
              );
              await input.telemetry.capture("forge.ai.tool.completed", {
                traceId: input.traceId,
                provider: input.provider,
                model: input.model,
                purpose: input.purpose,
                tool: name,
                latencyMs: Date.now() - startedAt,
                status: "completed",
              });
              await input.deltaRecorder?.recordAgentTool({
                toolName: name,
                risk: definition.risk ?? "external",
                status: "completed",
                traceId: input.traceId,
                durationMs: Date.now() - startedAt,
              });
              return output;
            } catch (error) {
              await input.telemetry.capture("forge.ai.tool.failed", {
                traceId: input.traceId,
                provider: input.provider,
                model: input.model,
                purpose: input.purpose,
                tool: name,
                latencyMs: Date.now() - startedAt,
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
              });
              await input.deltaRecorder?.recordAgentTool({
                toolName: name,
                risk: definition.risk ?? "external",
                status: "failed",
                traceId: input.traceId,
                durationMs: Date.now() - startedAt,
              });
              throw error;
            }
          },
        } as never),
      ];
    }),
  );
}

async function parseRequestArgs(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {};
  }

  try {
    const body = (await request.json()) as { args?: unknown };
    return body.args ?? {};
  } catch {
    return {};
  }
}

export async function startDevServer(
  options: DevServerOptions,
): Promise<DevServerHandle> {
  const workspaceRoot = options.workspaceRoot.replace(/\\/g, "/");
  const deltaRecorder = options.deltaRecorder;
  const authConfig = loadAuthConfigFromEnv(workspaceRoot, {
    defaultMode: "dev-headers",
  });
  if (
    options.mode === "serve" &&
    authConfig.mode === "dev-headers" &&
    !options.allowDevAuth
  ) {
    throw new ForgeAuthError(
      FORGE_AUTH_DEV_HEADERS_IN_PRODUCTION,
      "forge serve rejects FORGE_AUTH_MODE=dev-headers unless --allow-dev-auth is set",
      { status: 403 },
    );
  }

  const devManifest = readGeneratedJson<DevManifest>(
    workspaceRoot,
    `${GENERATED_DIR}/devManifest.json`,
  );
  const runtimeGraph = readGeneratedJson<RuntimeGraph>(
    workspaceRoot,
    `${GENERATED_DIR}/runtimeGraph.json`,
  );

  if (!runtimeGraph || !devManifest) {
    throw new Error(
      `missing generated dev artifacts; run forge generate first (${GENERATED_DIR}/devManifest.json)`,
    );
  }

  const telemetrySinks = options.telemetry ?? ["local"];

  const dbMode = options.db ?? "none";

  const serverState: DevServerState = {
    adapter: null,
    db: {
      kind: dbMode,
      connected: false,
    },
  };

  if (dbMode !== "none") {
    const { adapter, diagnostics } = await createDbAdapter({
      kind: dbMode,
      workspaceRoot,
      databaseUrl: options.databaseUrl,
    });

    if (!adapter) {
      const message = diagnostics.map((diagnostic) => diagnostic.message).join("; ");
      throw new Error(message || "failed to create database adapter");
    }

    const sqlPlan = readGeneratedJson<SqlPlan>(
      workspaceRoot,
      `${GENERATED_DIR}/sqlPlan.json`,
    );

    if (sqlPlan) {
      const migrationDiagnostics = await applyMigrations(adapter, sqlPlan);
      const errors = migrationDiagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      );
      if (errors.length > 0) {
        await adapter.close();
        throw new Error(errors.map((diagnostic) => diagnostic.message).join("; "));
      }
    }
    await ensureLiveInvalidationSchema(adapter);

    serverState.adapter = adapter;
    serverState.db.connected = true;
  }

  const restoreRuntimeEnvironment = await prepareRuntimeEnvironment(workspaceRoot, {
    mock: options.mock,
    mockAi: options.mockAi,
    db: serverState.adapter,
  });

  function loadArtifacts(): {
    devManifest: DevManifest;
    runtimeGraph: RuntimeGraph;
    tableMap: Record<string, TableMapEntry>;
  } {
    const freshDevManifest = readGeneratedJson<DevManifest>(
      workspaceRoot,
      `${GENERATED_DIR}/devManifest.json`,
    );
    const freshRuntimeGraph = readGeneratedJson<RuntimeGraph>(
      workspaceRoot,
      `${GENERATED_DIR}/runtimeGraph.json`,
    );
    const dbJson = readGeneratedJson<{ tableMap: Record<string, TableMapEntry> }>(
      workspaceRoot,
      `${GENERATED_DIR}/db.json`,
    );

    if (!freshRuntimeGraph || !freshDevManifest) {
      throw new Error(
        `missing generated dev artifacts; run forge generate first (${GENERATED_DIR}/devManifest.json)`,
      );
    }

    return {
      devManifest: freshDevManifest,
      runtimeGraph: freshRuntimeGraph,
      tableMap: dbJson?.tableMap ?? {},
    };
  }

  const initialArtifacts = loadArtifacts();
  let currentRoutes = devManifest.routes;
  let currentRuntimeEntryCount = runtimeGraph.entries.length;

  async function reloadGeneratedArtifacts(reason = "manual"): Promise<DevServerReloadResult> {
    try {
      const fresh = loadArtifacts();
      currentRoutes = fresh.devManifest.routes;
      currentRuntimeEntryCount = fresh.runtimeGraph.entries.length;
      const diagnostics: Diagnostic[] = [];
      let migrated = false;

      if (serverState.adapter) {
        const sqlPlan = readGeneratedJson<SqlPlan>(
          workspaceRoot,
          `${GENERATED_DIR}/sqlPlan.json`,
        );
        if (sqlPlan) {
          migrated = true;
          diagnostics.push(...(await applyMigrations(serverState.adapter, sqlPlan)));
        }
        if (diagnostics.every((diagnostic) => diagnostic.severity !== "error")) {
          await ensureLiveInvalidationSchema(serverState.adapter);
        }
      }

      if (
        options.worker &&
        serverState.adapter &&
        diagnostics.every((diagnostic) => diagnostic.severity !== "error")
      ) {
        serverState.outboxWorker?.stop();
        serverState.outboxWorker = startOutboxWorker(
          serverState.adapter,
          workspaceRoot,
          fresh.tableMap,
          fresh.runtimeGraph.entries,
          { mock: options.mock, intervalMs: 2_000, telemetrySinks, workspaceRoot },
        );
      }

      return {
        ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
        reason,
        migrated,
        routes: currentRoutes.length,
        runtimeEntries: currentRuntimeEntryCount,
        worker: serverState.outboxWorker?.isRunning() ? "running" : "stopped",
        diagnostics,
      };
    } catch (error) {
      return {
        ok: false,
        reason,
        migrated: false,
        routes: currentRoutes.length,
        runtimeEntries: currentRuntimeEntryCount,
        worker: serverState.outboxWorker?.isRunning() ? "running" : "stopped",
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: FORGE_DEV_SERVER_ERROR,
            message: error instanceof Error ? error.message : "failed to reload generated artifacts",
          }),
        ],
      };
    }
  }

  const liveManager = serverState.adapter
    ? createLiveSubscriptionManager({
        workspaceRoot,
        adapter: serverState.adapter,
        loadTableMap: () => loadArtifacts().tableMap,
        enablePolling: true,
        limits: {
          ...DEFAULT_LIVE_LIMITS,
          maxSubscriptionsPerClient: Number(process.env.FORGE_DEV_LIVE_MAX_SUBSCRIPTIONS ?? "250"),
        },
        pollIntervalMs: Number(process.env.FORGE_LIVE_POLL_INTERVAL_MS ?? "1000"),
      })
    : null;

  if (options.worker && serverState.adapter) {
    serverState.outboxWorker = startOutboxWorker(
      serverState.adapter,
      workspaceRoot,
      initialArtifacts.tableMap,
      initialArtifacts.runtimeGraph.entries,
      { mock: options.mock, intervalMs: 2_000, telemetrySinks, workspaceRoot },
    );
  }

  const server = await createFetchServer({
    hostname: options.host,
    port: options.port,
  }, async (request) => {
      if (request.method === "OPTIONS") {
        return corsPreflight();
      }

      const url = new URL(request.url);
      const pathname = url.pathname;

      try {
        const { devManifest: currentDevManifest, runtimeGraph: currentRuntimeGraph, tableMap } =
          loadArtifacts();

        if (request.method === "GET" && pathname === "/") {
          const listed = listEntries(workspaceRoot);
          const queries = listQueries(workspaceRoot);
          const liveQueries = loadLiveQueryRegistry(workspaceRoot);
          const external = loadExternalServiceGraph(workspaceRoot);
          const entries = [
            ...queries.queries.map((query) => ({
              name: query.name,
              kind: "query",
              path: `/queries/${query.name}`,
              method: "POST",
            })),
            ...liveQueries.liveQueries.map((liveQuery) => ({
              name: liveQuery.name,
              kind: "liveQuery",
              path: `/live/${liveQuery.name}`,
              method: "GET",
            })),
            ...listed.entries.map((entry) => ({
              name: entry.name,
              kind: entry.kind,
              path:
                entry.kind === "command"
                  ? `/commands/${entry.name}`
                  : `/actions/${entry.name}`,
              method: "POST",
            })),
            ...(external.graph?.services.flatMap((service) =>
              service.entries.map((entry) => ({
                name: `${service.name}.${entry.name}`,
                kind: `external:${entry.kind}`,
                path: `/external/${encodeURIComponent(service.name)}/${entry.kind === "command" ? "commands" : "queries"}/${encodeURIComponent(entry.name)}`,
                method: entry.method ?? "POST",
              }))
            ) ?? []),
          ].sort((a, b) =>
            a.path === b.path ? a.kind.localeCompare(b.kind) : a.path.localeCompare(b.path),
          );
          const routes = currentDevManifest.routes.map((route) => ({
            method: route.method,
            path: route.path,
            purpose: route.purpose,
          }));
          const payload = {
            ok: true,
            service: options.mode === "serve" ? "forge-serve" : "forge-dev",
            message: "Forge dev is an API server. Use POST for commands and queries.",
            health: "/health",
            entries,
            routes,
            db: serverState.db,
            web: options.webUrl ? { url: options.webUrl } : null,
            diagnostics: [
              ...listed.diagnostics,
              ...queries.diagnostics,
              ...(liveQueries.registry?.diagnostics ?? []),
              ...external.diagnostics,
            ],
          };

          if (acceptsHtml(request)) {
            return htmlResponse(
              renderDevHome({
                service: payload.service,
                db: payload.db,
                webUrl: options.webUrl,
                entries,
                routes,
              }),
            );
          }

          return jsonResponse(payload);
        }

        if (request.method === "GET" && pathname === "/health") {
          const outboxSummary = serverState.adapter
            ? await getOutboxSummary(serverState.adapter)
            : { pending: 0, dead: 0, processing: 0, processed: 0, failed: 0, events: 0 };
          const workflowSummary = serverState.adapter
            ? await getWorkflowSummary(serverState.adapter)
            : { pending: 0, running: 0, completed: 0, failed: 0, dead: 0, canceled: 0 };
          const telemetrySummary = serverState.adapter
            ? await getTelemetrySummary(serverState.adapter)
            : { pending: 0, failed: 0, processed: 0 };

          const envStore = getRuntimeEnvStore(workspaceRoot);
          const secretRegistry = loadSecretRegistry(workspaceRoot);
          const missingRequiredSecrets = secretRegistry
            ? countMissingRequiredSecrets(envStore, secretRegistry)
            : 0;

          const aiRegistry = loadAiRegistry(workspaceRoot);
          const aiCheck = checkAiProviders(envStore, aiRegistry, secretRegistry);
          const mockAi = isMockAiEnabled({ mockAi: options.mockAi });

          return jsonResponse({
            ok: true,
            service: options.mode === "serve" ? "forge-serve" : "forge-dev",
            mode: options.mode ?? "dev",
            entries: currentRuntimeGraph.entries.length,
            db: serverState.db,
            outbox: {
              worker: serverState.outboxWorker?.isRunning() ? "running" : "stopped",
              pending: outboxSummary.pending,
              dead: outboxSummary.dead,
            },
            workflows: {
              running: workflowSummary.running,
              pending: workflowSummary.pending,
              dead: workflowSummary.dead,
            },
            telemetry: {
              pending: telemetrySummary.pending,
              failed: telemetrySummary.failed,
              sinks: telemetrySinks,
            },
            auth: {
              mode: authConfig.mode,
              issuerConfigured: Boolean(authConfig.issuer),
              audienceConfigured: Boolean(authConfig.audience),
              jwksConfigured: Boolean(authConfig.jwksUri),
              requiresTenant: authConfig.requiresTenant,
            },
            env: {
              loadedFiles: envStore.loadedFiles,
              missingRequiredSecrets,
            },
            ai: {
              enabled: true,
              mode: mockAi ? "mock" : "live",
              providers: aiCheck.providers,
            },
            live: liveManager?.stats() ?? {
              subscriptions: 0,
              liveQueries: loadLiveQueryRegistry(workspaceRoot).liveQueries.length,
              lastRevision: 0,
            },
            liveStatus: liveManager?.status() ?? null,
          });
        }

        if (request.method === "GET" && pathname === "/live") {
          const liveQueries = loadLiveQueryRegistry(workspaceRoot).liveQueries;
          return jsonResponse({
            ok: true,
            liveQueries: liveQueries.map((liveQuery) => liveQuery.name),
          });
        }

        if (request.method === "GET" && pathname === "/live/status") {
          return jsonResponse({
            ok: true,
            status: liveManager?.status() ?? {
              runtime: { id: "runtime_unavailable", transport: "sse", subscriptions: 0 },
              invalidation: {
                lastSeenRevision: 0,
                lastProcessedRevision: 0,
                polling: false,
                postgresNotify: false,
              },
              limits: DEFAULT_LIVE_LIMITS,
            },
          });
        }

        if (request.method === "GET" && pathname === "/live/invalidations") {
          if (!serverState.adapter) {
            return jsonResponse({ ok: true, invalidations: [] });
          }
          const limit = Number(url.searchParams.get("limit") ?? "50");
          return jsonResponse({
            ok: true,
            invalidations: await listLiveInvalidations(serverState.adapter, limit),
          });
        }

        const liveDebugMatch = pathname.match(/^\/live\/debug\/([^/]+)$/);
        if (request.method === "GET" && liveDebugMatch) {
          const subscriptionId = decodeURIComponent(liveDebugMatch[1]!);
          const subscription = liveManager?.debug(subscriptionId);
          return jsonResponse({
            ok: Boolean(subscription),
            subscription: subscription
              ? {
                  id: subscription.id,
                  name: subscription.name,
                  tenantId:
                    subscription.auth.kind === "user"
                      ? subscription.auth.tenantId
                      : subscription.auth.kind === "system"
                        ? subscription.auth.tenantId
                        : undefined,
                  dependencies: subscription.dependencies,
                  lastSentRevision: subscription.lastSentRevision,
                  status: subscription.status,
                  createdAt: subscription.createdAt,
                  lastSentAt: subscription.lastSentAt,
                }
              : null,
          }, subscription ? 200 : 404);
        }

        const liveMatch = pathname.match(/^\/live\/([^/]+)$/);
        if (request.method === "GET" && liveMatch) {
          if (!serverState.adapter || !liveManager) {
            return jsonResponse(
              {
                ok: false,
                diagnostics: [
                  createDiagnostic({
                    severity: "error",
                    code: FORGE_DEV_SERVER_ERROR,
                    message: "database not connected",
                  }),
                ],
              },
              400,
            );
          }

          const name = decodeURIComponent(liveMatch[1]!);
          let args: unknown = {};
          const argsRaw = url.searchParams.get("args");
          if (argsRaw) {
            try {
              args = JSON.parse(argsRaw);
            } catch {
              args = {};
            }
          }

          const auth = await authenticateHeaders(request.headers, authConfig);
          const lastRevision = Number(
            request.headers.get("last-event-id") ??
              url.searchParams.get("lastRevision") ??
              "NaN",
          );
          let subscriptionId: string | null = null;
          const cleanupSubscription = () => {
            if (subscriptionId) {
              liveManager.unsubscribe(subscriptionId);
              subscriptionId = null;
            }
          };
          request.signal.addEventListener("abort", cleanupSubscription, { once: true });

          return createSseResponse(
            async (send, close) => {
              const subscription = await liveManager.subscribe({
                name,
                args,
                auth,
                lastRevision: Number.isFinite(lastRevision) ? lastRevision : undefined,
                send,
              });
              subscriptionId = subscription.id;
              if (request.signal.aborted) {
                cleanupSubscription();
                close();
                return;
              }
              const known = loadLiveQueryRegistry(workspaceRoot).liveQueries.some(
                (liveQuery) => liveQuery.name === name,
              );
              if (!known) {
                close();
              }
            },
            () => {
              cleanupSubscription();
            },
            {
              heartbeatIntervalMs: Number(process.env.FORGE_LIVE_HEARTBEAT_MS ?? "15000"),
              hello: {
                type: "hello",
                protocolVersion: "0.1.0",
                releaseId: currentReleaseInfo().releaseId,
                deployId: currentReleaseInfo().deployId,
                serverTime: new Date().toISOString(),
              },
            },
          );
        }

        if (request.method === "GET" && pathname === "/ai/providers") {
          const aiRegistry = loadAiRegistry(workspaceRoot);
          const envStore = getRuntimeEnvStore(workspaceRoot);
          const secretRegistry = loadSecretRegistry(workspaceRoot);
          const aiCheck = checkAiProviders(envStore, aiRegistry, secretRegistry);
          return jsonResponse({ ok: true, providers: aiCheck.providers });
        }

        if (request.method === "POST" && pathname === "/ai/test") {
          const body = (await request.json().catch(() => ({}))) as {
            provider?: string;
            model?: string;
            prompt?: string;
          };
          const envStore = getRuntimeEnvStore(workspaceRoot);
          const secretRegistry = loadSecretRegistry(workspaceRoot);
          const bundle = createRuntimeSecretsBundle({
            store: envStore,
            registry: secretRegistry,
            envSchema: null,
            runtimeKind: "server",
          });
          const telemetry = createNoopTelemetryContext(generateTraceId());
          const ai = createAiContext({
            secrets: bundle.secrets,
            telemetry,
            runtimeKind: "server",
            mockAi: isMockAiEnabled({ mockAi: options.mockAi }),
          });

          try {
            const result = await ai.generateText({
              provider: (body.provider ?? "openai") as "openai" | "anthropic" | "gateway",
              model: body.model ?? "gpt-4o-mini",
              prompt: body.prompt ?? "ping",
              purpose: "dev_test",
            });
            return jsonResponse({ ok: true, result });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return jsonResponse({ ok: false, error: message }, 400);
          }
        }

        if (request.method === "POST" && pathname === "/ai/agents/run") {
          const body = (await request.json().catch(() => ({}))) as {
            agent?: string;
            provider?: string;
            model?: string;
            instructions?: string;
            prompt?: string;
            purpose?: string;
            maxSteps?: number;
            tools?: string[];
          };
          if (!body.prompt) {
            return jsonResponse(
              {
                ok: false,
                diagnostics: [
                  createDiagnostic({
                    severity: "error",
                    code: FORGE_DEV_INVOKE_FAILED,
                    message: "POST /ai/agents/run requires a prompt",
                    fixHint: "Send JSON like {\"prompt\":\"...\",\"instructions\":\"...\",\"tools\":[\"forge_query_listTickets\"]}.",
                  }),
                ],
              },
              400,
            );
          }
          const auth = await authenticateHeaders(request.headers, authConfig);
          const envStore = getRuntimeEnvStore(workspaceRoot);
          const secretRegistry = loadSecretRegistry(workspaceRoot);
          const bundle = createRuntimeSecretsBundle({
            store: envStore,
            registry: secretRegistry,
            envSchema: null,
            runtimeKind: "server",
          });
          const traceId = generateTraceId();
          const telemetry = serverState.adapter
            ? createTelemetryContext({
                adapter: serverState.adapter,
                traceId,
                runtime: { kind: "endpoint", name: "ai.agent.run" },
                bufferInTransaction: false,
                workspaceRoot,
                sinks: telemetrySinks,
              })
            : createNoopTelemetryContext(traceId);
          const ai = createAiContext({
            secrets: bundle.secrets,
            telemetry,
            runtimeKind: "endpoint",
            mockAi: isMockAiEnabled({ mockAi: options.mockAi }),
            envelope: { traceId, tenantId: auth.kind === "user" || auth.kind === "system" ? auth.tenantId : undefined },
            toolContext: {
              env: envStore.snapshot(),
              auth,
            },
          });
          try {
            const namedAgent = await loadNamedAgentDefinition(workspaceRoot, body.agent);
            const tools = {
              ...explicitAgentTools(namedAgent),
              ...buildAutoAgentTools({
                workspaceRoot,
                registry: loadAgentToolRegistry(workspaceRoot),
                selected: body.tools,
                adapter: serverState.adapter,
                tableMap,
                auth,
                liveManager,
                json: options.json,
                mock: options.mock,
              }),
            };
            const result = await ai.runAgent({
              provider: (body.provider ?? namedAgent?.provider ?? "gateway") as ForgeAiProvider,
              model: body.model ?? namedAgent?.model ?? "openai/gpt-5.4",
              instructions:
                body.instructions ??
                namedAgent?.instructions ??
                "You are a ForgeOS app agent. Use available Forge tools when useful.",
              prompt: body.prompt,
              purpose: body.purpose ?? "dev_agent_run",
              stopWhen: namedAgent?.stopWhen,
              maxSteps: body.maxSteps ?? namedAgent?.maxSteps,
              tools,
            });
            return jsonResponse(
              {
                ok: true,
                result,
                traceId,
                tools: Object.keys(tools).sort(),
              },
              200,
              { "x-forge-trace-id": traceId },
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return jsonResponse(
              {
                ok: false,
                traceId,
                diagnostics: [
                  createDiagnostic({
                    severity: "error",
                    code: FORGE_DEV_INVOKE_FAILED,
                    message,
                    fixHint: `Inspect with forge ai trace ${traceId} --json or GET /telemetry/traces/${traceId}.`,
                  }),
                ],
              },
              400,
              { "x-forge-trace-id": traceId },
            );
          }
        }

        if (request.method === "POST" && pathname === "/ai/agents/chat") {
          const body = (await request.json().catch(() => ({}))) as {
            agent?: string;
            provider?: string;
            model?: string;
            instructions?: string;
            purpose?: string;
            maxSteps?: number;
            tools?: string[];
            messages?: unknown[];
          };
          if (!Array.isArray(body.messages)) {
            return jsonResponse(
              {
                ok: false,
                diagnostics: [
                  createDiagnostic({
                    severity: "error",
                    code: FORGE_DEV_INVOKE_FAILED,
                    message: "POST /ai/agents/chat requires AI SDK UI messages",
                    fixHint: "Use @ai-sdk/react useChat with DefaultChatTransport({ api: `${forgeUrl}/ai/agents/chat` }).",
                  }),
                ],
              },
              400,
            );
          }

          const purpose = body.purpose ?? "dev_agent_chat";
          const auth = await authenticateHeaders(request.headers, authConfig);
          const envStore = getRuntimeEnvStore(workspaceRoot);
          const secretRegistry = loadSecretRegistry(workspaceRoot);
          const bundle = createRuntimeSecretsBundle({
            store: envStore,
            registry: secretRegistry,
            envSchema: null,
            runtimeKind: "server",
          });
          const traceId = generateTraceId();
          const telemetry = serverState.adapter
            ? createTelemetryContext({
                adapter: serverState.adapter,
                traceId,
                runtime: { kind: "endpoint", name: "ai.agent.chat" },
                bufferInTransaction: false,
                workspaceRoot,
                sinks: telemetrySinks,
              })
            : createNoopTelemetryContext(traceId);
          let provider = (body.provider ?? "gateway") as ForgeAiProvider;
          let model = body.model ?? "openai/gpt-5.4";

          try {
            const namedAgent = await loadNamedAgentDefinition(workspaceRoot, body.agent);
            provider = (body.provider ?? namedAgent?.provider ?? "gateway") as ForgeAiProvider;
            model = body.model ?? namedAgent?.model ?? "openai/gpt-5.4";
            await telemetry.capture("forge.ai.agent.started", {
              traceId,
              provider,
              model,
              purpose,
              mode: "stream",
            });
            const languageModel = await resolveLanguageModel(provider, model, bundle.secrets);
            const forgeTools = {
              ...explicitAgentTools(namedAgent),
              ...buildAutoAgentTools({
                workspaceRoot,
                registry: loadAgentToolRegistry(workspaceRoot),
                selected: body.tools,
                adapter: serverState.adapter,
                tableMap,
                auth,
                liveManager,
                json: options.json,
                mock: options.mock,
              }),
            };
            const tools = await buildAiSdkTools({
              tools: forgeTools,
              provider,
              model,
              purpose,
              traceId,
              secrets: bundle.secrets,
              telemetry,
              env: envStore.snapshot(),
              auth,
              deltaRecorder,
            });
            const { ToolLoopAgent, createAgentUIStreamResponse, hasToolCall, stepCountIs } = await import("ai");
            const stopWhen =
              namedAgent?.stopWhen?.kind === "toolCall"
                ? (hasToolCall(namedAgent.stopWhen.toolName) as never)
                : namedAgent?.stopWhen?.kind === "stepCount"
                  ? (stepCountIs(body.maxSteps ?? namedAgent.stopWhen.maxSteps) as never)
                  : (stepCountIs(body.maxSteps ?? namedAgent?.maxSteps ?? 20) as never);
            const agent = new ToolLoopAgent({
              model: languageModel as never,
              instructions:
                body.instructions ??
                namedAgent?.instructions ??
                "You are a ForgeOS app agent. Use available Forge tools when useful.",
              tools: tools as never,
              stopWhen,
            });
            const response = await createAgentUIStreamResponse({
              agent: agent as never,
              uiMessages: body.messages,
              onStepFinish: async () => {
                await telemetry.capture("forge.ai.agent.step.completed", {
                  traceId,
                  provider,
                  model,
                  purpose,
                });
              },
              headers: {
                "Access-Control-Allow-Origin": "*",
                "x-forge-trace-id": traceId,
              },
            });
            await telemetry.capture("forge.ai.agent.completed", {
              traceId,
              provider,
              model,
              purpose,
              status: "streaming",
            });
            return response;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await telemetry.capture("forge.ai.agent.failed", {
              traceId,
              provider,
              model,
              purpose,
              status: "failed",
              error: message,
            });
            return jsonResponse(
              {
                ok: false,
                traceId,
                diagnostics: [
                  createDiagnostic({
                    severity: "error",
                    code: FORGE_DEV_INVOKE_FAILED,
                    message,
                    fixHint: `Inspect with forge ai trace ${traceId} --json or GET /telemetry/traces/${traceId}.`,
                  }),
                ],
              },
              400,
              { "x-forge-trace-id": traceId },
            );
          }
        }

        if (request.method === "GET" && pathname === "/telemetry") {
          if (!serverState.adapter) {
            return jsonResponse({
              ok: true,
              summary: { pending: 0, failed: 0, processed: 0 },
              events: [],
            });
          }

          const summary = await getTelemetrySummary(serverState.adapter);
          const { listTelemetryEvents } = await import("../runtime/telemetry/flush.ts");
          const events = await listTelemetryEvents(serverState.adapter);
          return jsonResponse({ ok: true, summary, events });
        }

        const telemetryTraceMatch = pathname.match(/^\/telemetry\/traces\/([^/]+)$/);
        if (request.method === "GET" && telemetryTraceMatch && serverState.adapter) {
          const traceId = decodeURIComponent(telemetryTraceMatch[1]!);
          const inspected = await inspectTrace(serverState.adapter, traceId);
          return jsonResponse({ ok: true, traceId, ...inspected });
        }

        if (request.method === "GET" && pathname === "/outbox") {
          if (!serverState.adapter) {
            return jsonResponse({ ok: true, summary: null, deliveries: [] });
          }

          const summary = await getOutboxSummary(serverState.adapter);
          const deliveries = await listOutboxDeliveries(serverState.adapter);
          return jsonResponse({ ok: true, summary, deliveries });
        }

        if (request.method === "GET" && pathname === "/entries") {
          const listed = listEntries(workspaceRoot);
          const queries = listQueries(workspaceRoot);
          const liveQueries = loadLiveQueryRegistry(workspaceRoot);
          return jsonResponse({
            ok: true,
            entries: [
              ...queries.queries.map((query) => ({
                name: query.name,
                kind: "query",
                file: query.file,
              })),
              ...liveQueries.liveQueries.map((liveQuery) => ({
                name: liveQuery.name,
                kind: "liveQuery",
                file: liveQuery.file,
              })),
              ...listed.entries,
            ],
            liveQueries: liveQueries.liveQueries,
            diagnostics: [
              ...listed.diagnostics,
              ...queries.diagnostics,
              ...(liveQueries.registry?.diagnostics ?? []),
            ],
          });
        }

        if (request.method === "GET" && pathname === "/queries") {
          const queries = listQueries(workspaceRoot);
          return jsonResponse({
            ok: true,
            queries: queries.queries,
            diagnostics: queries.diagnostics,
          });
        }

        if (request.method === "GET" && pathname === "/workflows") {
          const { workflows } = loadWorkflowRegistry(workspaceRoot);
          return jsonResponse({
            ok: true,
            workflows: currentDevManifest.workflows,
            registry: workflows,
          });
        }

        if (request.method === "GET" && pathname === "/workflows/runs") {
          if (!serverState.adapter) {
            return jsonResponse({ ok: true, runs: [], summary: null });
          }

          const runs = await listWorkflowRuns(serverState.adapter);
          const summary = await getWorkflowSummary(serverState.adapter);
          return jsonResponse({ ok: true, runs, summary });
        }

        const workflowRunMatch = pathname.match(/^\/workflows\/runs\/(\d+)$/);
        if (request.method === "GET" && workflowRunMatch) {
          if (!serverState.adapter) {
            return jsonResponse({ ok: true, run: null, steps: [] });
          }

          const runId = Number(workflowRunMatch[1]);
          const inspected = await inspectWorkflowRun(serverState.adapter, runId);
          return jsonResponse({ ok: true, ...inspected });
        }

        if (request.method === "GET" && pathname === "/db/tables") {
          if (serverState.adapter) {
            return jsonResponse({
              ok: true,
              tables: serverState.adapter.kind === "memory"
                ? Object.keys(tableMap).sort()
                : await listDatabaseTables(serverState.adapter),
            });
          }

          return jsonResponse({
            ok: true,
            tables: Object.keys(tableMap).sort(),
          });
        }

        if (request.method === "GET") {
          const externalInvoke = parseExternalInvoke(pathname);
          if (externalInvoke) {
            return methodHelpResponse({
              kind: externalInvoke.kind,
              name: `${externalInvoke.serviceName}.${externalInvoke.entryName}`,
              path: `/external/${externalInvoke.serviceName}/${externalInvoke.kind === "command" ? "commands" : "queries"}/${externalInvoke.entryName}`,
            });
          }

          const queryName = parseInvokeName(pathname, "/queries/");
          if (queryName) {
            return methodHelpResponse({
              kind: "query",
              name: queryName,
              path: `/queries/${queryName}`,
            });
          }

          const commandName = parseInvokeName(pathname, "/commands/");
          if (commandName) {
            return methodHelpResponse({
              kind: "command",
              name: commandName,
              path: `/commands/${commandName}`,
            });
          }

          const actionName = parseInvokeName(pathname, "/actions/");
          if (actionName) {
            return methodHelpResponse({
              kind: "action",
              name: actionName,
              path: `/actions/${actionName}`,
            });
          }
        }

        if (request.method === "POST") {
          if (pathname === "/telemetry/flush") {
            if (!serverState.adapter) {
              return jsonResponse(
                {
                  ok: false,
                  diagnostics: [
                    createDiagnostic({
                      severity: "error",
                      code: FORGE_DEV_SERVER_ERROR,
                      message: "database not connected",
                    }),
                  ],
                },
                400,
              );
            }

            let bodySink: string | undefined;
            try {
              const body = (await request.json()) as { sink?: string };
              bodySink = body.sink;
            } catch {
              bodySink = undefined;
            }

            const sinks = bodySink ? [bodySink] : telemetrySinks;
            const batch = await processTelemetryBatch(
              serverState.adapter,
              workspaceRoot,
              sinks,
            );

            return jsonResponse({ ok: true, batch });
          }

          if (pathname === "/outbox/process") {
            if (!serverState.adapter) {
              return jsonResponse(
                {
                  ok: false,
                  diagnostics: [
                    createDiagnostic({
                      severity: "error",
                      code: FORGE_DEV_SERVER_ERROR,
                      message: "database not connected",
                    }),
                  ],
                },
                400,
              );
            }

            const batch = await runWorkerTick(
              serverState.adapter,
              workspaceRoot,
              tableMap,
              currentRuntimeGraph.entries,
              { mock: options.mock },
            );

            return jsonResponse({ ok: true, batch });
          }

          if (pathname === "/workflows/process") {
            if (!serverState.adapter) {
              return jsonResponse(
                {
                  ok: false,
                  diagnostics: [
                    createDiagnostic({
                      severity: "error",
                      code: FORGE_DEV_SERVER_ERROR,
                      message: "database not connected",
                    }),
                  ],
                },
                400,
              );
            }

            const batch = await runWorkerTick(
              serverState.adapter,
              workspaceRoot,
              tableMap,
              currentRuntimeGraph.entries,
              { mock: options.mock },
            );

            return jsonResponse({ ok: true, batch });
          }

          const workflowRunPostMatch = pathname.match(/^\/workflows\/runs\/(\d+)\/(retry|cancel)$/);
          if (workflowRunPostMatch && serverState.adapter) {
            const runId = Number(workflowRunPostMatch[1]);
            const action = workflowRunPostMatch[2];

            if (action === "retry") {
              const retried = await retryWorkflowRun(serverState.adapter, runId);
              return jsonResponse({ ok: retried, runId, status: retried ? "pending" : "not_found" });
            }

            const canceled = await cancelWorkflowRun(serverState.adapter, runId);
            return jsonResponse({ ok: canceled, runId, status: canceled ? "canceled" : "not_found" });
          }

          const workflowRunMatchPost = pathname.match(/^\/workflows\/([^/]+)\/run$/);
          if (workflowRunMatchPost && serverState.adapter) {
            const workflowName = decodeURIComponent(workflowRunMatchPost[1]!);
            let bodyInput: unknown = {};
            try {
              const body = (await request.json()) as { input?: unknown };
              bodyInput = body.input ?? {};
            } catch {
              bodyInput = {};
            }

            const { workflows } = loadWorkflowRegistry(workspaceRoot);
            const idempotencyKey = `${workflowName}:manual:${hashStable(canonicalJson(bodyInput))}`;
            const result = await createWorkflowRun(serverState.adapter, workflows, {
              workflowName,
              input: bodyInput,
              triggerType: "manual",
              idempotencyKey,
            });

            return jsonResponse({ ok: true, ...result });
          }

          const externalInvoke = parseExternalInvoke(pathname);
          if (externalInvoke) {
            const args = await parseRequestArgs(request);
            const auth = await authenticateHeaders(request.headers, authConfig);
            const result = await runExternalEntry(
              workspaceRoot,
              {
                ...externalInvoke,
                args,
                auth,
                requestHeaders: request.headers,
              },
              { adapter: serverState.adapter },
            );
            const policyDenied = result.diagnostics.some(
              (diagnostic) => diagnostic.code === FORGE_POLICY_DENIED,
            );
            await deltaRecorder?.recordRuntimeCall({
              entryName: `${externalInvoke.serviceName}.${externalInvoke.entryName}`,
              entryKind: externalInvoke.kind,
              service: externalInvoke.serviceName,
              result: policyDenied ? "denied" : result.ok ? "success" : "failed",
              diagnostics: result.diagnostics,
              traceId: result.traceId,
            });
            return jsonResponse(
              {
                ok: result.ok,
                result: result.result,
                diagnostics: result.diagnostics,
                traceId: result.traceId,
              },
              result.ok ? 200 : policyDenied ? 403 : 400,
              result.traceId ? { "x-forge-trace-id": result.traceId } : {},
            );
          }

          let entryName: string | null = null;
          let expectedKind: "command" | "action" | null = null;
          let queryName: string | null = null;

          if (pathname.startsWith("/queries/")) {
            queryName = parseInvokeName(pathname, "/queries/");
          } else if (pathname.startsWith("/run/")) {
            entryName = parseInvokeName(pathname, "/run/");
          } else if (pathname.startsWith("/commands/")) {
            entryName = parseInvokeName(pathname, "/commands/");
            expectedKind = "command";
          } else if (pathname.startsWith("/actions/")) {
            entryName = parseInvokeName(pathname, "/actions/");
            expectedKind = "action";
          }

          if (queryName) {
            if (!serverState.adapter) {
              return jsonResponse(
                {
                  ok: false,
                  diagnostics: [
                    createDiagnostic({
                      severity: "error",
                      code: FORGE_DEV_SERVER_ERROR,
                      message: "database not connected",
                    }),
                  ],
                },
                400,
              );
            }

            const args = await parseRequestArgs(request);
            const auth = await authenticateHeaders(request.headers, authConfig);

            const result = await runQuery(
              workspaceRoot,
              queryName,
              { args, auth },
              {
                adapter: serverState.adapter,
                tableMap,
              },
            );

            const policyDenied = result.diagnostics.some(
              (diagnostic) => diagnostic.code === FORGE_POLICY_DENIED,
            );
            await deltaRecorder?.recordRuntimeCall({
              entryName: queryName,
              entryKind: "query",
              result: policyDenied ? "denied" : result.ok ? "success" : "failed",
              diagnostics: result.diagnostics,
              traceId: result.traceId,
            });

            return jsonResponse(
              {
                ok: result.ok,
                result: result.result,
                traceId: result.traceId,
                diagnostics: result.diagnostics,
              },
              result.ok ? 200 : policyDenied ? 403 : 400,
              result.traceId ? { "x-forge-trace-id": result.traceId } : {},
            );
          }

          if (entryName) {
            const entry = currentRuntimeGraph.entries.find(
              (candidate) => candidate.name === entryName,
            );

            if (!entry) {
              return jsonResponse(
                {
                  ok: false,
                  diagnostics: [
                    createDiagnostic({
                      severity: "error",
                      code: FORGE_RUNTIME_NOT_FOUND,
                      message: `runtime entry '${entryName}' not found`,
                    }),
                  ],
                },
                404,
              );
            }

            if (expectedKind && entry.kind !== expectedKind) {
              return jsonResponse(
                {
                  ok: false,
                  diagnostics: [
                    createDiagnostic({
                      severity: "error",
                      code: FORGE_DEV_INVOKE_FAILED,
                      message: `entry '${entryName}' is a ${entry.kind}, not ${expectedKind}`,
                    }),
                  ],
                },
                404,
              );
            }

            const args = await parseRequestArgs(request);
            const auth = await authenticateHeaders(request.headers, authConfig);

            await prepareRuntimeEnvironment(workspaceRoot, {
              mock: options.mock,
              db: serverState.adapter,
            });

            const result = await runEntry(workspaceRoot, entryName, {
              json: options.json,
              mock: options.mock,
              args,
              db: serverState.adapter,
              auth,
              liveManager: liveManager ?? undefined,
            });

            const policyDenied = result.diagnostics.some(
              (diagnostic) => diagnostic.code === FORGE_POLICY_DENIED,
            );
            await deltaRecorder?.recordRuntimeCall({
              entryName,
              entryKind: entry.kind,
              result: policyDenied ? "denied" : result.ok ? "success" : "failed",
              diagnostics: result.diagnostics,
              traceId: result.traceId,
            });

            if (policyDenied) {
              const denied = result.diagnostics.find(
                (diagnostic) => diagnostic.code === FORGE_POLICY_DENIED,
              );
              return jsonResponse(
                {
                  ok: false,
                  error: {
                    code: FORGE_POLICY_DENIED,
                    message: denied?.message ?? "policy denied",
                  },
                  traceId: result.traceId,
                  diagnostics: result.diagnostics,
                },
                403,
              );
            }

            return jsonResponse(
              {
                ok: result.ok,
                result: result.result,
                diagnostics: result.diagnostics,
                traceId: result.traceId,
              },
              result.ok ? 200 : 400,
            );
          }
        }

        return jsonResponse(
          {
            ok: false,
            diagnostics: [
              createDiagnostic({
                severity: "error",
                code: FORGE_DEV_SERVER_ERROR,
                message: `unknown route ${request.method} ${pathname}`,
                fixHint: "Open GET / for the Forge API index, GET /entries for callable entries, or use POST /commands/:name and POST /queries/:name with JSON body {\"args\":{}}.",
                suggestedCommands: ["forge dev --once --json", "forge inspect frontend --json"],
                docs: ["AGENTS.md", "src/forge/_generated/agentContract.json"],
              }),
            ],
          },
          404,
        );
      } catch (error) {
        if (error instanceof ForgeAuthError) {
          return jsonResponse(
            {
              ok: false,
              diagnostics: [
                createDiagnostic({
                  severity: "error",
                  code: error.code,
                  message: error.message,
                }),
              ],
            },
            error.status,
          );
        }
        const message = errorMessage(error, "dev server request failed");
        return jsonResponse(
          {
            ok: false,
            diagnostics: [
              createDiagnostic({
                severity: "error",
                code: FORGE_DEV_SERVER_ERROR,
                message,
              }),
            ],
          },
          500,
        );
      }
  });

  const host = server.hostname ?? options.host;
  const port = server.port ?? options.port;
  const protocol = "http";
  const url = `${protocol}://${host}:${port}`;

  const handle: DevServerHandle = {
    host,
    port,
    url,
    routes: currentRoutes,
    state: serverState,
    outboxWorker: serverState.outboxWorker,
    reload: async (reason?: string) => {
      const result = await reloadGeneratedArtifacts(reason);
      handle.routes = currentRoutes;
      handle.outboxWorker = serverState.outboxWorker;
      return result;
    },
    stop: () => {
      serverState.outboxWorker?.stop();
      liveManager?.stop();
      server.stop(true);
      restoreRuntimeEnvironment();
      const adapter = serverState.adapter;
      serverState.adapter = null;
      void adapter?.close().catch(() => undefined);
    },
  };

  return handle;
}

export function resolveDevPort(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }
  const fromEnv = process.env.FORGE_DEV_PORT;
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 3765;
}

export function resolveDevHost(explicit?: string): string {
  return explicit ?? "127.0.0.1";
}
