import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import { FORGE_DB_TRANSACTION_FAILED } from "../../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { RuntimeEntry } from "../../compiler/types/runtime-graph.ts";
import type { DbAdapter } from "../db/adapter.ts";
import { createGeneratedDbClient } from "../db/generated-client.ts";
import { createForgeContext } from "../context/create-context.ts";
import { loadActionSubscriptions } from "../outbox/subscriptions.ts";
import { createTelemetryContext } from "../telemetry/context.ts";
import { recordExceptionOutsideTx } from "../telemetry/buffer.ts";
import { generateTraceId } from "../telemetry/correlation.ts";

export interface CommandRuntime {
  adapter: DbAdapter;
  tableMap: Record<string, TableMapEntry>;
  workspaceRoot: string;
  requestId?: string;
}

export interface CommandTransactionResult {
  ok: boolean;
  result?: unknown;
  diagnostics: Diagnostic[];
  traceId?: string;
}

type CtxHandler = (ctx: unknown, args: unknown) => unknown | Promise<unknown>;

export async function runCommandWithTransaction(
  entry: RuntimeEntry,
  handler: CtxHandler,
  args: unknown,
  runtime: CommandRuntime,
): Promise<CommandTransactionResult> {
  const diagnostics: Diagnostic[] = [];
  const traceId = generateTraceId();
  const tx = await runtime.adapter.begin();

  try {
    const db = createGeneratedDbClient(tx, runtime.tableMap);
    const { subscriptions } = loadActionSubscriptions(runtime.workspaceRoot);
    const telemetry = createTelemetryContext({
      adapter: runtime.adapter,
      tx,
      traceId,
      requestId: runtime.requestId,
      runtime: { kind: "command", name: entry.name },
      bufferInTransaction: true,
      workspaceRoot: runtime.workspaceRoot,
    });
    const ctx = createForgeContext(tx, db, subscriptions, telemetry);
    const result = await handler(ctx, args);
    await tx.commit();

    return {
      ok: true,
      result,
      diagnostics,
      traceId,
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // ignore rollback errors
    }

    await recordExceptionOutsideTx(runtime.adapter, error, traceId, {
      kind: "command",
      name: entry.name,
    }, { requestId: runtime.requestId });

    const message = error instanceof Error ? error.message : "command transaction failed";
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: FORGE_DB_TRANSACTION_FAILED,
        message: `command '${entry.name}' failed: ${message}`,
        file: entry.file,
      }),
    );

    return {
      ok: false,
      diagnostics,
      traceId,
    };
  }
}
