import { join } from "node:path";
import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import {
  FORGE_RUNTIME_GUARD_BLOCKED,
  FORGE_RUNTIME_NOT_FOUND,
} from "../../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { RuntimeEntry } from "../../compiler/types/runtime-graph.ts";
import { adapterAsTransaction, type DbAdapter } from "../db/adapter.ts";
import { createGeneratedDbClient } from "../db/generated-client.ts";
import { createForgeContext } from "../context/create-context.ts";
import { loadActionSubscriptions } from "../outbox/subscriptions.ts";
import { runCommandWithTransaction } from "./command-transaction.ts";

export interface RunEntryExecutionOptions {
  json: boolean;
  mock: boolean;
  args?: unknown;
}

export interface RunEntryRuntime {
  adapter?: DbAdapter | null;
  tableMap?: Record<string, TableMapEntry>;
  workspaceRoot?: string;
}

export interface ResolvedHandler {
  invoke: (args: unknown) => Promise<unknown>;
  usesContext: boolean;
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
          const db = createGeneratedDbClient(tx, runtime.tableMap);
          const workspaceRoot = runtime.workspaceRoot ?? process.cwd();
          const { subscriptions } = loadActionSubscriptions(workspaceRoot);
          const ctx = createForgeContext(tx, db, subscriptions);
          return handler(ctx, args);
        }

        const stubCtx = {
          db: {},
          env: process.env as Record<string, string | undefined>,
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
    const mod = (await import(absolutePath)) as Record<string, unknown>;
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
      },
    );
  }

  try {
    const result = await resolved.invoke(options.args ?? {});
    return { ok: true, result, diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : "handler execution failed";
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: FORGE_RUNTIME_NOT_FOUND,
        message: `runtime entry '${entry.name}' failed: ${message}`,
        file: entry.file,
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
