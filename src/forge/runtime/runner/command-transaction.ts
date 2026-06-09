import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import { FORGE_DB_TRANSACTION_FAILED } from "../../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { RuntimeEntry } from "../../compiler/types/runtime-graph.ts";
import type { DbAdapter } from "../db/adapter.ts";
import { createGeneratedDbClient } from "../db/generated-client.ts";
import { createForgeContext } from "../context/create-context.ts";

export interface CommandRuntime {
  adapter: DbAdapter;
  tableMap: Record<string, TableMapEntry>;
}

export interface CommandTransactionResult {
  ok: boolean;
  result?: unknown;
  diagnostics: Diagnostic[];
}

type CtxHandler = (ctx: unknown, args: unknown) => unknown | Promise<unknown>;

export async function runCommandWithTransaction(
  entry: RuntimeEntry,
  handler: CtxHandler,
  args: unknown,
  runtime: CommandRuntime,
): Promise<CommandTransactionResult> {
  const diagnostics: Diagnostic[] = [];
  const tx = await runtime.adapter.begin();

  try {
    const db = createGeneratedDbClient(tx, runtime.tableMap);
    const ctx = createForgeContext(tx, db);
    const result = await handler(ctx, args);
    await tx.commit();

    return {
      ok: true,
      result,
      diagnostics,
    };
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // ignore rollback errors
    }

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
    };
  }
}
