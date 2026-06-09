import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import {
  FORGE_DEV_INVOKE_FAILED,
  FORGE_DEV_SERVER_ERROR,
  FORGE_RUNTIME_NOT_FOUND,
} from "../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../compiler/data-graph/sql/serialize.ts";
import type { SqlPlan } from "../compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { DevManifest } from "../compiler/types/dev-manifest.ts";
import type { RuntimeGraph } from "../compiler/types/runtime-graph.ts";
import { createDbAdapter } from "../runtime/db/factory.ts";
import { applyMigrations } from "../runtime/db/migrate.ts";
import {
  listEntries,
  prepareRuntimeEnvironment,
  runEntry,
} from "../runtime/executor.ts";
import {
  getOutboxSummary,
  listOutboxDeliveries,
  processOutboxBatch,
  startOutboxWorker,
} from "../runtime/outbox/process.ts";
import type { DevServerHandle, DevServerOptions, DevServerState } from "./types.ts";

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

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function parseInvokeName(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const name = pathname.slice(prefix.length);
  return name.length > 0 ? decodeURIComponent(name) : null;
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

  const serverState: DevServerState = {
    adapter: null,
    db: {
      kind: options.db,
      connected: false,
    },
  };

  if (options.db !== "none") {
    const { adapter, diagnostics } = await createDbAdapter({
      kind: options.db,
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

    serverState.adapter = adapter;
    serverState.db.connected = true;
  }

  await prepareRuntimeEnvironment(workspaceRoot, {
    mock: options.mock,
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

  if (options.worker && serverState.adapter) {
    serverState.outboxWorker = startOutboxWorker(
      serverState.adapter,
      workspaceRoot,
      initialArtifacts.tableMap,
      runtimeGraph.entries,
      { mock: options.mock, intervalMs: 2_000 },
    );
  }

  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    async fetch(request) {
      if (request.method === "OPTIONS") {
        return corsPreflight();
      }

      const url = new URL(request.url);
      const pathname = url.pathname;

      try {
        const { devManifest: currentDevManifest, runtimeGraph: currentRuntimeGraph, tableMap } =
          loadArtifacts();

        if (request.method === "GET" && pathname === "/health") {
          const outboxSummary = serverState.adapter
            ? await getOutboxSummary(serverState.adapter)
            : { pending: 0, dead: 0, processing: 0, processed: 0, failed: 0, events: 0 };

          return jsonResponse({
            ok: true,
            service: "forge-dev",
            entries: currentRuntimeGraph.entries.length,
            db: serverState.db,
            outbox: {
              worker: serverState.outboxWorker?.isRunning() ? "running" : "stopped",
              pending: outboxSummary.pending,
              dead: outboxSummary.dead,
            },
          });
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
          return jsonResponse({
            ok: true,
            entries: listed.entries,
            diagnostics: listed.diagnostics,
          });
        }

        if (request.method === "GET" && pathname === "/workflows") {
          return jsonResponse({
            ok: true,
            workflows: currentDevManifest.workflows,
          });
        }

        if (request.method === "GET" && pathname === "/db/tables") {
          if (serverState.adapter) {
            const result = await serverState.adapter.query(
              `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
            );
            return jsonResponse({
              ok: true,
              tables: result.rows.map((row) => String(row.table_name)),
            });
          }

          return jsonResponse({
            ok: true,
            tables: Object.keys(tableMap).sort(),
          });
        }

        if (request.method === "POST") {
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

            const batch = await processOutboxBatch(
              serverState.adapter,
              workspaceRoot,
              tableMap,
              currentRuntimeGraph.entries,
              { mock: options.mock },
            );

            return jsonResponse({ ok: true, batch });
          }

          let entryName: string | null = null;
          let expectedKind: "command" | "action" | null = null;

          if (pathname.startsWith("/run/")) {
            entryName = parseInvokeName(pathname, "/run/");
          } else if (pathname.startsWith("/commands/")) {
            entryName = parseInvokeName(pathname, "/commands/");
            expectedKind = "command";
          } else if (pathname.startsWith("/actions/")) {
            entryName = parseInvokeName(pathname, "/actions/");
            expectedKind = "action";
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

            await prepareRuntimeEnvironment(workspaceRoot, {
              mock: options.mock,
              db: serverState.adapter,
            });

            const result = await runEntry(workspaceRoot, entryName, {
              json: options.json,
              mock: options.mock,
              args,
              db: serverState.adapter,
            });

            return jsonResponse(
              {
                ok: result.ok,
                result: result.result,
                diagnostics: result.diagnostics,
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
              }),
            ],
          },
          404,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "dev server request failed";
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
    },
  });

  const host = server.hostname ?? options.host;
  const port = server.port ?? options.port;
  const protocol = "http";
  const url = `${protocol}://${host}:${port}`;

  return {
    host,
    port,
    url,
    routes: devManifest.routes,
    state: serverState,
    outboxWorker: serverState.outboxWorker,
    stop: () => {
      serverState.outboxWorker?.stop();
      server.stop(true);
      void serverState.adapter?.close();
    },
  };
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
