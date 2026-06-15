import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import {
  FORGE_DB_ADAPTER_UNAVAILABLE,
  FORGE_RUNTIME_GUARD_BLOCKED,
  FORGE_RUNTIME_NOT_FOUND,
} from "../../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { RuntimeEntry } from "../../compiler/types/runtime-graph.ts";
import { adapterAsTransaction, type DbAdapter } from "../db/adapter.ts";
import { createGeneratedDbClient } from "../db/generated-client.ts";
import { createForgeContext, createNoopTelemetryContext, getRuntimeEnvStore } from "../context/create-context.ts";
import { createAiContext } from "../ai/context.ts";
import { createRuntimeSecretsBundle } from "../secrets/runtime-bundle.ts";
import { loadEnvSchema, loadSecretRegistry } from "../secrets/check.ts";
import type { RuntimeContext } from "../../compiler/types/runtime.ts";
import { loadActionSubscriptions } from "../outbox/subscriptions.ts";
import { runCommandWithTransaction } from "./command-transaction.ts";
import { generateRequestId, generateTraceId } from "../telemetry/correlation.ts";
import { createTelemetryContext } from "../telemetry/context.ts";
import type { AuthContext } from "../auth/types.ts";
import type { LiveSubscriptionManager } from "../live/types.ts";

export interface RunEntryExecutionOptions {
  json: boolean;
  mock: boolean;
  args?: unknown;
  auth?: AuthContext;
}

export interface RunEntryRuntime {
  adapter?: DbAdapter | null;
  tableMap?: Record<string, TableMapEntry>;
  workspaceRoot?: string;
  requestId?: string;
  auth?: AuthContext;
  runtimeKind?: RuntimeContext;
  liveManager?: LiveSubscriptionManager;
}

export interface ResolvedHandler {
  invoke: (args: unknown) => Promise<unknown>;
  usesContext: boolean;
}

function needsDatabaseHint(
  entry: RuntimeEntry,
  resolved: ResolvedHandler,
  runtime?: RunEntryRuntime,
): boolean {
  return (
    resolved.usesContext &&
    !runtime?.adapter &&
    (entry.kind === "command" || entry.kind === "action")
  );
}

export function resolveHandlerFromModule(
  mod: Record<string, unknown>,
  entryName: string,
  runtime?: RunEntryRuntime,
): ResolvedHandler | null {
  const exported = mod[entryName];

  if (typeof exported === "function") {
    return {
      usesContext: false,
      invoke: async () => (exported as () => unknown)(),
    };
  }

  if (
    exported &&
    typeof exported === "object" &&
    "handler" in exported &&
    typeof (exported as { handler: unknown }).handler === "function"
  ) {
    const handler = (exported as {
      handler: (ctx: unknown, args: unknown) => unknown | Promise<unknown>;
    }).handler;

    return {
      usesContext: true,
      invoke: async (args) => {
        if (runtime?.adapter && runtime.tableMap) {
          const tx = adapterAsTransaction(runtime.adapter);
          const db = createGeneratedDbClient(tx, runtime.tableMap, {
            auth: runtime.auth,
          });
          const workspaceRoot = runtime.workspaceRoot ?? process.cwd();
          const { subscriptions } = loadActionSubscriptions(workspaceRoot);
          const traceId = generateTraceId();
          const telemetry = createTelemetryContext({
            adapter: runtime.adapter,
            tx,
            traceId,
            requestId: runtime.requestId ?? generateRequestId(),
            runtime: { kind: "command", name: entryName },
            bufferInTransaction: false,
            workspaceRoot,
          });
          const runtimeKind = runtime.runtimeKind ?? "command";
          const ctx = createForgeContext(tx, db, subscriptions, telemetry, runtime.auth ?? { kind: "anonymous" }, {
            workspaceRoot,
            runtimeKind,
          });
          return handler(ctx, args);
        }

        const workspaceRoot = runtime?.workspaceRoot ?? process.cwd();
        const store = getRuntimeEnvStore(workspaceRoot);
        const bundle = createRuntimeSecretsBundle({
          store,
          registry: loadSecretRegistry(workspaceRoot),
          envSchema: loadEnvSchema(workspaceRoot),
          runtimeKind: runtime?.runtimeKind ?? "command",
        });

        const stubTelemetry = createNoopTelemetryContext(generateTraceId());
        const stubCtx = {
          db: {},
          env: store.snapshot(),
          telemetry: stubTelemetry,
          auth: runtime?.auth ?? { kind: "anonymous" as const },
          secrets: bundle.secrets,
          config: bundle.config,
          ai: createAiContext({
            secrets: bundle.secrets,
            telemetry: stubTelemetry,
            runtimeKind: runtime?.runtimeKind ?? "command",
          }),
          emit: async () => {
            /* no-op without db */
          },
        };
        return handler(stubCtx, args);
      },
    };
  }

  return null;
}

export async function executeResolvedEntry(
  workspaceRoot: string,
  entry: RuntimeEntry,
  resolved: ResolvedHandler,
  options: RunEntryExecutionOptions,
  runtime?: RunEntryRuntime,
): Promise<{
  ok: boolean;
  result?: unknown;
  diagnostics: Diagnostic[];
}> {
  const diagnostics: Diagnostic[] = [];

  if (
    entry.kind === "command" &&
    resolved.usesContext &&
    runtime?.adapter &&
    runtime.tableMap
  ) {
    const absolutePath = join(workspaceRoot, entry.file);
    const mod = (await import(pathToFileURL(absolutePath).href)) as Record<string, unknown>;
    const exported = mod[entry.name];
    const handler = (exported as { handler: (ctx: unknown, args: unknown) => unknown })
      .handler;

    return runCommandWithTransaction(
      entry,
      handler,
      options.args ?? {},
      {
        adapter: runtime.adapter,
        tableMap: runtime.tableMap,
        workspaceRoot,
        requestId: runtime.requestId,
        auth: options.auth ?? runtime.auth,
        liveManager: runtime.liveManager,
      },
    );
  }

  try {
    const result = await resolved.invoke(options.args ?? {});
    return { ok: true, result, diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : "handler execution failed";
    const dbHint = needsDatabaseHint(entry, resolved, runtime);
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: dbHint ? FORGE_DB_ADAPTER_UNAVAILABLE : FORGE_RUNTIME_NOT_FOUND,
        message: dbHint
          ? `runtime entry '${entry.name}' needs a database adapter: ${message}`
          : `runtime entry '${entry.name}' failed: ${message}`,
        file: entry.file,
        fixHint: dbHint
          ? "Start `forge dev` and invoke the HTTP endpoint, or run database-backed entries from a DB-enabled workflow/test."
          : undefined,
        suggestedCommands: dbHint
          ? ["forge dev", "forge dev --once --json"]
          : undefined,
      }),
    );
    return { ok: false, diagnostics };
  }
}

export function guardBlockedDiagnostics(
  entry: RuntimeEntry,
  violations: Diagnostic[],
  baseDiagnostics: Diagnostic[],
): Diagnostic[] {
  return [
    ...baseDiagnostics,
    ...violations,
    createDiagnostic({
      severity: "error",
      code: FORGE_RUNTIME_GUARD_BLOCKED,
      message: `runtime entry '${entry.name}' blocked by import guard violations`,
      file: entry.file,
    }),
  ];
}
