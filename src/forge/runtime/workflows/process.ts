import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { DbAdapter } from "../db/adapter.ts";
import { processWorkflowRun } from "./process-run.ts";
import { findWorkflowDefinition, loadWorkflowRegistry } from "./registry.ts";
import { startWorkflowRunsForPendingOutbox } from "./start-from-outbox.ts";
import type {
  ProcessWorkflowBatchOptions,
  ProcessWorkflowBatchResult,
  WorkflowRunRow,
} from "./types.ts";

function defaultWorkerId(): string {
  return `forge-worker-${process.pid}`;
}

function rowToRun(row: Record<string, unknown>): WorkflowRunRow {
  let input: unknown = row.input;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      /* keep raw */
    }
  }

  return {
    id: Number(row.id),
    workflow_name: String(row.workflow_name),
    trigger_type: String(row.trigger_type),
    trigger_outbox_id:
      row.trigger_outbox_id != null ? Number(row.trigger_outbox_id) : null,
    idempotency_key: String(row.idempotency_key),
    input,
    status: String(row.status) as WorkflowRunRow["status"],
    current_step: row.current_step != null ? String(row.current_step) : null,
    last_error: row.last_error != null ? String(row.last_error) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    started_at: row.started_at != null ? String(row.started_at) : null,
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
    canceled_at: row.canceled_at != null ? String(row.canceled_at) : null,
  };
}

export async function processWorkflowBatch(
  adapter: DbAdapter,
  workspaceRoot: string,
  tableMap: Record<string, TableMapEntry>,
  options: ProcessWorkflowBatchOptions = {},
): Promise<ProcessWorkflowBatchResult> {
  const limit = options.limit ?? 10;
  const workerId = options.workerId ?? defaultWorkerId();
  const mock = options.mock ?? false;
  const { workflows } = loadWorkflowRegistry(workspaceRoot);

  const pendingRuns = await adapter.query(
    `SELECT id, workflow_name, trigger_type, trigger_outbox_id, idempotency_key, input, status, current_step, last_error, created_at, updated_at, started_at, completed_at, canceled_at
     FROM _forge_workflow_runs
     WHERE status IN ('pending', 'running', 'failed')
     ORDER BY id
     LIMIT $1`,
    [limit],
  );

  const result: ProcessWorkflowBatchResult = {
    claimed: pendingRuns.rows.length,
    completed: 0,
    failed: 0,
    dead: 0,
    runsStarted: 0,
    errors: [],
  };

  for (const row of pendingRuns.rows) {
    const run = rowToRun(row);
    const workflow = findWorkflowDefinition(workflows, run.workflow_name);
    if (!workflow) {
      result.errors.push(`workflow '${run.workflow_name}' not found`);
      continue;
    }

    const outcome = await processWorkflowRun(
      adapter,
      workspaceRoot,
      tableMap,
      workflow,
      run,
      workerId,
      mock,
    );

    if (outcome === "completed") {
      result.completed += 1;
    } else if (outcome === "dead") {
      result.dead += 1;
    } else if (outcome === "retry") {
      result.failed += 1;
    }
  }

  return result;
}

export async function runWorkerTick(
  adapter: DbAdapter,
  workspaceRoot: string,
  tableMap: Record<string, TableMapEntry>,
  runtimeGraphEntries: Parameters<typeof import("../outbox/process.ts").processOutboxBatch>[3],
  options: ProcessWorkflowBatchOptions = {},
): Promise<{
  workflows: { started: number; skipped: number };
  outbox: Awaited<ReturnType<typeof import("../outbox/process.ts").processOutboxBatch>>;
  workflowBatch: ProcessWorkflowBatchResult;
}> {
  const { processOutboxBatch } = await import("../outbox/process.ts");

  const workflowStart = await startWorkflowRunsForPendingOutbox(adapter, workspaceRoot);
  const outbox = await processOutboxBatch(
    adapter,
    workspaceRoot,
    tableMap,
    runtimeGraphEntries,
    options,
  );
  const workflowBatch = await processWorkflowBatch(
    adapter,
    workspaceRoot,
    tableMap,
    options,
  );

  return {
    workflows: workflowStart,
    outbox,
    workflowBatch: {
      ...workflowBatch,
      runsStarted: workflowStart.started,
    },
  };
}

export async function getWorkflowSummary(adapter: DbAdapter): Promise<{
  pending: number;
  running: number;
  completed: number;
  failed: number;
  dead: number;
  canceled: number;
}> {
  const result = await adapter.query(
    `SELECT status, COUNT(*)::int AS count FROM _forge_workflow_runs GROUP BY status`,
  );

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[String(row.status)] = Number(row.count);
  }

  return {
    pending: counts.pending ?? 0,
    running: counts.running ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    dead: counts.dead ?? 0,
    canceled: counts.canceled ?? 0,
  };
}

export async function listWorkflowRuns(
  adapter: DbAdapter,
): Promise<Record<string, unknown>[]> {
  const result = await adapter.query(
    `SELECT id, workflow_name, trigger_type, trigger_outbox_id, idempotency_key, input, status, current_step, last_error, created_at, updated_at, started_at, completed_at, canceled_at
     FROM _forge_workflow_runs
     ORDER BY id`,
  );
  return result.rows;
}

export async function inspectWorkflowRun(
  adapter: DbAdapter,
  runId: number,
): Promise<{ run: Record<string, unknown> | null; steps: Record<string, unknown>[] }> {
  const runResult = await adapter.query(
    `SELECT id, workflow_name, trigger_type, trigger_outbox_id, idempotency_key, input, status, current_step, last_error, created_at, updated_at, started_at, completed_at, canceled_at
     FROM _forge_workflow_runs WHERE id = $1`,
    [runId],
  );

  if (runResult.rows.length === 0) {
    return { run: null, steps: [] };
  }

  const stepsResult = await adapter.query(
    `SELECT id, run_id, step_name, step_index, status, input, output, attempts, max_attempts, next_attempt_at, last_error, started_at, completed_at, created_at
     FROM _forge_workflow_steps WHERE run_id = $1 ORDER BY step_index`,
    [runId],
  );

  return {
    run: runResult.rows[0] ?? null,
    steps: stepsResult.rows,
  };
}

export function startWorkflowWorker(
  adapter: DbAdapter,
  workspaceRoot: string,
  tableMap: Record<string, TableMapEntry>,
  runtimeGraphEntries: Parameters<typeof import("../outbox/process.ts").processOutboxBatch>[3],
  options: ProcessWorkflowBatchOptions & { intervalMs?: number } = {},
): { stop: () => void; isRunning: () => boolean } {
  const intervalMs = options.intervalMs ?? 2_000;
  let running = true;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (!running) {
      return;
    }
    try {
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
