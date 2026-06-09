import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import {
  FORGE_DB_TRANSACTION_FAILED,
  FORGE_POLICY_DENIED,
  FORGE_TENANT_SCOPE_VIOLATION,
} from "../../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { RuntimeEntry } from "../../compiler/types/runtime-graph.ts";
import type { DbAdapter } from "../db/adapter.ts";
import {
  createGeneratedDbClient,
  TenantScopeViolationError,
} from "../db/generated-client.ts";
import { createForgeContext } from "../context/create-context.ts";
import { loadActionSubscriptions } from "../outbox/subscriptions.ts";
import { createTelemetryContext } from "../telemetry/context.ts";
import { recordExceptionOutsideTx } from "../telemetry/buffer.ts";
import { generateTraceId } from "../telemetry/correlation.ts";
import type { AuthContext } from "../auth/types.ts";
import { checkCommandPolicy } from "../policy/check.ts";

export interface CommandRuntime {
  adapter: DbAdapter;
  tableMap: Record<string, TableMapEntry>;
  workspaceRoot: string;
  requestId?: string;
  auth?: AuthContext;
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
  const auth = runtime.auth ?? { kind: "anonymous" as const };

  const preflightTelemetry = createTelemetryContext({
    adapter: runtime.adapter,
    traceId,
    requestId: runtime.requestId,
    runtime: { kind: "command", name: entry.name },
    bufferInTransaction: false,
    workspaceRoot: runtime.workspaceRoot,
  });

  const policyCheck = await checkCommandPolicy({
    workspaceRoot: runtime.workspaceRoot,
    entry,
    auth,
    telemetry: preflightTelemetry,
  });

  if (!policyCheck.allowed) {
    return {
      ok: false,
      diagnostics: [...diagnostics, ...policyCheck.diagnostics],
      traceId,
    };
  }

  const tx = await runtime.adapter.begin();

  try {
    const telemetry = createTelemetryContext({
      adapter: runtime.adapter,
      tx,
      traceId,
      requestId: runtime.requestId,
      runtime: { kind: "command", name: entry.name },
      bufferInTransaction: true,
      workspaceRoot: runtime.workspaceRoot,
    });

    const db = createGeneratedDbClient(tx, runtime.tableMap, { auth });
    const { subscriptions } = loadActionSubscriptions(runtime.workspaceRoot);
    const ctx = createForgeContext(tx, db, subscriptions, telemetry, auth, {
      workspaceRoot: runtime.workspaceRoot,
      runtimeKind: "command",
    });
    const result = await handler(ctx, args);
    await tx.commit();

    return {
      ok: true,
      result,
      diagnostics: [...diagnostics, ...policyCheck.diagnostics],
      traceId,
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // ignore rollback errors
    }

    if (error instanceof TenantScopeViolationError) {
      await preflightTelemetry.capture("forge.tenant_scope.denied", {
        table: error.table,
        operation: error.operation,
      });

      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: FORGE_TENANT_SCOPE_VIOLATION,
          message: error.message,
          file: entry.file,
        }),
      );

      return {
        ok: false,
        diagnostics,
        traceId,
      };
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

export function isPolicyDeniedResult(result: CommandTransactionResult): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.code === FORGE_POLICY_DENIED);
}
