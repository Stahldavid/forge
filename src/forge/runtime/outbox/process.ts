import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import {
  FORGE_OUTBOX_PROCESS_FAILED,
  FORGE_RUNTIME_NOT_FOUND,
} from "../../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { RuntimeEntry } from "../../compiler/types/runtime-graph.ts";
import { adapterAsTransaction } from "../db/adapter.ts";
import type { DbAdapter } from "../db/adapter.ts";
import { createGeneratedDbClient } from "../db/generated-client.ts";
import { createActionContext } from "../context/create-context.ts";
import { systemAuthFromSnapshot } from "../auth/resolve.ts";
import type { AuthContext } from "../auth/types.ts";
import { prepareRuntimeEnvironment } from "../executor.ts";
import { loadActionSubscriptions } from "./subscriptions.ts";
import { createTelemetryContext } from "../telemetry/context.ts";
import { generateTraceId } from "../telemetry/correlation.ts";
import {
  claimPendingDeliveries,
  markDeliveryDead,
  markDeliveryProcessed,
  markDeliveryRetry,
} from "./claim.ts";
import { computeNextAttemptAt, formatTimestamp } from "./retry.ts";
import type {
  ClaimedDelivery,
  ProcessOutboxBatchOptions,
  ProcessOutboxBatchResult,
} from "./types.ts";

function defaultWorkerId(): string {
  return `forge-worker-${process.pid}`;
}

function resolveSystemAuthFromDelivery(delivery: ClaimedDelivery): AuthContext {
  const snapshot = (delivery.auth_context as AuthContext | undefined) ?? { kind: "anonymous" };
  const tenantId =
    snapshot.kind === "user"
      ? snapshot.tenantId
      : snapshot.kind === "system"
        ? snapshot.tenantId
        : undefined;
  return systemAuthFromSnapshot(snapshot, tenantId);
}

async function runDeliveryAction(
  workspaceRoot: string,
  delivery: ClaimedDelivery,
  adapter: DbAdapter,
  tableMap: Record<string, TableMapEntry>,
  runtimeGraphEntries: RuntimeEntry[],
  mock: boolean,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const entry = runtimeGraphEntries.find(
    (candidate) => candidate.name === delivery.action_name,
  );

  if (!entry || entry.kind !== "action") {
    return {
      ok: false,
      error: `action '${delivery.action_name}' not found in runtime graph`,
    };
  }

  await prepareRuntimeEnvironment(workspaceRoot, { mock, db: adapter });

  const absolutePath = join(workspaceRoot, entry.file);
  const mod = (await import(pathToFileURL(absolutePath).href)) as Record<string, unknown>;
  const exported = mod[entry.name];

  if (
    !exported ||
    typeof exported !== "object" ||
    !("handler" in exported) ||
    typeof (exported as { handler: unknown }).handler !== "function"
  ) {
    return {
      ok: false,
      error: `export '${delivery.action_name}' is not an action handler`,
    };
  }

  const handler = (exported as {
    handler: (ctx: unknown, args: unknown) => unknown | Promise<unknown>;
  }).handler;

  try {
    const tx = adapterAsTransaction(adapter);
    const auth = resolveSystemAuthFromDelivery(delivery);
    const db = createGeneratedDbClient(tx, tableMap, { auth });

    const payloadObj =
      delivery.payload && typeof delivery.payload === "object"
        ? (delivery.payload as Record<string, unknown>)
        : {};
    const traceId =
      typeof payloadObj.traceId === "string" ? payloadObj.traceId : generateTraceId();

    const telemetry = createTelemetryContext({
      adapter,
      traceId,
      runtime: { kind: "action", name: delivery.action_name },
      outbox: {
        eventId: String(delivery.outbox_id),
        deliveryId: String(delivery.id),
      },
      bufferInTransaction: false,
      workspaceRoot,
      sinks: ["local"],
    });

    const ctx = createActionContext(db, telemetry, auth);
    const result = await handler(ctx, delivery.payload);
    await telemetry.flush("local");
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "action handler failed";
    return { ok: false, error: message };
  }
}

export async function processOutboxBatch(
  adapter: DbAdapter,
  workspaceRoot: string,
  tableMap: Record<string, TableMapEntry>,
  runtimeGraphEntries: RuntimeEntry[],
  options: ProcessOutboxBatchOptions = {},
): Promise<ProcessOutboxBatchResult> {
  const limit = options.limit ?? 10;
  const workerId = options.workerId ?? defaultWorkerId();
  const mock = options.mock ?? false;

  loadActionSubscriptions(workspaceRoot);

  const claimed = await claimPendingDeliveries(adapter, limit, workerId);
  const result: ProcessOutboxBatchResult = {
    processed: 0,
    failed: 0,
    dead: 0,
    claimed: claimed.length,
    errors: [],
  };

  for (const delivery of claimed) {
    const executed = await runDeliveryAction(
      workspaceRoot,
      delivery,
      adapter,
      tableMap,
      runtimeGraphEntries,
      mock,
    );

    if (executed.ok) {
      await markDeliveryProcessed(adapter, delivery.id);
      result.processed += 1;
      continue;
    }

    const nextAttempts = delivery.attempts + 1;
    const errorMessage = executed.error;

    if (nextAttempts >= delivery.max_attempts) {
      await markDeliveryDead(adapter, delivery.id, errorMessage, nextAttempts);
      result.dead += 1;
      result.errors.push(
        createDiagnostic({
          severity: "error",
          code: FORGE_OUTBOX_PROCESS_FAILED,
          message: `delivery ${delivery.id} dead after ${nextAttempts} attempts: ${errorMessage}`,
        }).message,
      );
      continue;
    }

    const nextAttemptAt = formatTimestamp(computeNextAttemptAt(nextAttempts));
    await markDeliveryRetry(
      adapter,
      delivery.id,
      nextAttempts,
      errorMessage,
      nextAttemptAt,
    );
    result.failed += 1;
    result.errors.push(
      createDiagnostic({
        severity: "warning",
        code: FORGE_OUTBOX_PROCESS_FAILED,
        message: `delivery ${delivery.id} scheduled retry ${nextAttempts}: ${errorMessage}`,
      }).message,
    );
  }

  return result;
}

export function startOutboxWorker(
  adapter: DbAdapter,
  workspaceRoot: string,
  tableMap: Record<string, TableMapEntry>,
  runtimeGraphEntries: RuntimeEntry[],
  options: ProcessOutboxBatchOptions & { intervalMs?: number } = {},
): { stop: () => void; isRunning: () => boolean } {
  const intervalMs = options.intervalMs ?? 2_000;
  let running = true;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (!running) {
      return;
    }
    try {
      const { runWorkerTick } = await import("../workflows/process.ts");
      await runWorkerTick(adapter, workspaceRoot, tableMap, runtimeGraphEntries, options);
    } catch {
      /* worker loop continues on batch errors */
    }
  };

  void tick();
  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    isRunning: () => running,
  };
}

export async function getOutboxSummary(adapter: DbAdapter): Promise<{
  pending: number;
  dead: number;
  processing: number;
  processed: number;
  failed: number;
  events: number;
}> {
  const deliveries = await adapter.query(
    `SELECT status, COUNT(*)::int AS count FROM _forge_outbox_deliveries GROUP BY status`,
  );
  const events = await adapter.query(`SELECT COUNT(*)::int AS count FROM _forge_outbox`);

  const counts: Record<string, number> = {};
  for (const row of deliveries.rows) {
    counts[String(row.status)] = Number(row.count);
  }

  return {
    pending: counts.pending ?? 0,
    processing: counts.processing ?? 0,
    processed: counts.processed ?? 0,
    failed: counts.failed ?? 0,
    dead: counts.dead ?? 0,
    events: Number(events.rows[0]?.count ?? 0),
  };
}

export async function listOutboxDeliveries(
  adapter: DbAdapter,
): Promise<Record<string, unknown>[]> {
  const result = await adapter.query(
    `SELECT d.id, d.outbox_id, d.action_name, d.status, d.attempts, d.max_attempts, d.next_attempt_at, d.last_error, d.processed_at, o.event_type, o.created_at AS event_created_at
     FROM _forge_outbox_deliveries d
     JOIN _forge_outbox o ON o.id = d.outbox_id
     ORDER BY d.id`,
  );
  return result.rows;
}

export async function listDeadDeliveries(
  adapter: DbAdapter,
): Promise<Record<string, unknown>[]> {
  const result = await adapter.query(
    `SELECT d.id, d.outbox_id, d.action_name, d.attempts, d.last_error, d.created_at, o.event_type
     FROM _forge_outbox_deliveries d
     JOIN _forge_outbox o ON o.id = d.outbox_id
     WHERE d.status = 'dead'
     ORDER BY d.id`,
  );
  return result.rows;
}

export async function clearDeadDeliveries(adapter: DbAdapter): Promise<number> {
  const result = await adapter.query(
    `DELETE FROM _forge_outbox_deliveries WHERE status = 'dead'`,
  );
  return result.rowCount;
}

export { FORGE_RUNTIME_NOT_FOUND };
