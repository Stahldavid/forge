import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import {
  FORGE_OUTBOX_DELIVERY_NOT_FOUND,
  FORGE_RUNTIME_NOT_FOUND,
} from "../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../compiler/data-graph/sql/serialize.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { RuntimeGraph } from "../compiler/types/runtime-graph.ts";
import { createDbAdapter, type CreateDbAdapterOptions } from "../runtime/db/factory.ts";
import type { DbAdapterKind } from "../runtime/db/adapter.ts";
import { applyMigrations } from "../runtime/db/migrate.ts";
import type { SqlPlan } from "../compiler/data-graph/sql/types.ts";
import {
  clearDeadDeliveries,
  getOutboxSummary,
  listDeadDeliveries,
  listOutboxDeliveries,
  processOutboxBatch,
} from "../runtime/outbox/process.ts";
import { resetDeliveryForRetry } from "../runtime/outbox/claim.ts";
import { prepareRuntimeEnvironment } from "../runtime/executor.ts";

export type OutboxSubcommand = "list" | "process" | "retry" | "dead" | "clear";

export interface OutboxCommandOptions {
  subcommand: OutboxSubcommand;
  workspaceRoot: string;
  db: DbAdapterKind;
  databaseUrl?: string;
  json: boolean;
  once?: boolean;
  watch?: boolean;
  limit?: number;
  deliveryId?: number;
  mock?: boolean;
}

export interface OutboxCommandResult {
  ok: boolean;
  data?: unknown;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  return JSON.parse(raw) as T;
}

function adapterOptions(options: OutboxCommandOptions): CreateDbAdapterOptions {
  return {
    kind: options.db,
    workspaceRoot: options.workspaceRoot,
    databaseUrl: options.databaseUrl,
  };
}

async function loadRuntimeArtifacts(workspaceRoot: string): Promise<{
  runtimeGraph: RuntimeGraph | null;
  tableMap: Record<string, TableMapEntry>;
  sqlPlan: SqlPlan | null;
}> {
  const runtimeGraph = readGeneratedJson<RuntimeGraph>(
    workspaceRoot,
    `${GENERATED_DIR}/runtimeGraph.json`,
  );
  const dbJson = readGeneratedJson<{ tableMap: Record<string, TableMapEntry> }>(
    workspaceRoot,
    `${GENERATED_DIR}/db.json`,
  );
  const sqlPlan = readGeneratedJson<SqlPlan>(
    workspaceRoot,
    `${GENERATED_DIR}/sqlPlan.json`,
  );

  return {
    runtimeGraph,
    tableMap: dbJson?.tableMap ?? {},
    sqlPlan,
  };
}

export async function runOutboxCommand(
  options: OutboxCommandOptions,
): Promise<OutboxCommandResult> {
  const { runtimeGraph, tableMap, sqlPlan } = await loadRuntimeArtifacts(
    options.workspaceRoot,
  );

  if (!runtimeGraph) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_RUNTIME_NOT_FOUND,
          message: `missing ${GENERATED_DIR}/runtimeGraph.json; run forge generate first`,
        }),
      ],
      exitCode: 1,
    };
  }

  const { adapter, diagnostics: adapterDiagnostics } = await createDbAdapter(
    adapterOptions(options),
  );

  if (!adapter) {
    return {
      ok: false,
      diagnostics: adapterDiagnostics,
      exitCode: 1,
    };
  }

  try {
    if (sqlPlan) {
      await applyMigrations(adapter, sqlPlan);
    }

    await prepareRuntimeEnvironment(options.workspaceRoot, {
      mock: options.mock ?? false,
      db: adapter,
    });

    if (options.subcommand === "list") {
      const deliveries = await listOutboxDeliveries(adapter);
      const summary = await getOutboxSummary(adapter);
      return {
        ok: true,
        data: { summary, deliveries },
        diagnostics: [],
        exitCode: 0,
      };
    }

    if (options.subcommand === "dead") {
      const dead = await listDeadDeliveries(adapter);
      return {
        ok: true,
        data: { dead },
        diagnostics: [],
        exitCode: 0,
      };
    }

    if (options.subcommand === "clear") {
      const cleared = await clearDeadDeliveries(adapter);
      return {
        ok: true,
        data: { cleared },
        diagnostics: [],
        exitCode: 0,
      };
    }

    if (options.subcommand === "retry") {
      if (options.deliveryId === undefined) {
        return {
          ok: false,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: FORGE_OUTBOX_DELIVERY_NOT_FOUND,
              message: "forge outbox retry requires a delivery id",
            }),
          ],
          exitCode: 1,
        };
      }

      const reset = await resetDeliveryForRetry(adapter, options.deliveryId);
      if (!reset) {
        return {
          ok: false,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: FORGE_OUTBOX_DELIVERY_NOT_FOUND,
              message: `delivery '${options.deliveryId}' not found`,
            }),
          ],
          exitCode: 1,
        };
      }

      return {
        ok: true,
        data: { deliveryId: options.deliveryId, status: "pending" },
        diagnostics: [],
        exitCode: 0,
      };
    }

    if (options.subcommand === "process") {
      const runBatch = async () =>
        processOutboxBatch(
          adapter,
          options.workspaceRoot,
          tableMap,
          runtimeGraph.entries,
          {
            limit: options.limit ?? 10,
            mock: options.mock ?? false,
          },
        );

      if (options.watch) {
        let running = true;
        const intervalMs = 2_000;

        const shutdown = () => {
          running = false;
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);

        while (running) {
          const batch = await runBatch();
          if (!options.json) {
            process.stdout.write(
              `processed=${batch.processed} failed=${batch.failed} dead=${batch.dead} claimed=${batch.claimed}\n`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }

        return { ok: true, data: { watch: true }, diagnostics: [], exitCode: 0 };
      }

      const batch = await runBatch();
      return {
        ok: true,
        data: batch,
        diagnostics: [],
        exitCode: 0,
      };
    }

    return {
      ok: false,
      diagnostics: [],
      exitCode: 1,
    };
  } finally {
    await adapter.close();
  }
}

export function formatOutboxJson(result: OutboxCommandResult): string {
  return `${JSON.stringify({
    ok: result.ok,
    data: result.data,
    diagnostics: result.diagnostics,
    exitCode: result.exitCode,
  })}\n`;
}

export function formatOutboxHuman(
  subcommand: OutboxSubcommand,
  result: OutboxCommandResult,
): string {
  if (!result.ok) {
    return result.diagnostics
      .map((diagnostic) => `error ${diagnostic.code}: ${diagnostic.message}`)
      .join("\n")
      .concat("\n");
  }

  if (subcommand === "clear") {
    return `cleared ${(result.data as { cleared: number }).cleared} dead deliveries\n`;
  }

  if (subcommand === "retry") {
    return `delivery ${(result.data as { deliveryId: number }).deliveryId} reset to pending\n`;
  }

  if (subcommand === "process") {
    const batch = result.data as {
      processed: number;
      failed: number;
      dead: number;
      claimed: number;
    };
    return `claimed=${batch.claimed} processed=${batch.processed} failed=${batch.failed} dead=${batch.dead}\n`;
  }

  return `${JSON.stringify(result.data, null, 2)}\n`;
}
