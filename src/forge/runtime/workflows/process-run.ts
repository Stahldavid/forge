import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { WorkflowDefinition } from "../../compiler/types/workflow-registry.ts";
import type { DbAdapter } from "../db/adapter.ts";
import { processWorkflowStep } from "./process-step.ts";
import { sanitizeWorkflowError } from "./sanitize.ts";
import type { WorkflowRunRow, WorkflowStepRow } from "./types.ts";

function rowToStep(row: Record<string, unknown>): WorkflowStepRow {
  return {
    id: Number(row.id),
    run_id: Number(row.run_id),
    step_name: String(row.step_name),
    step_index: Number(row.step_index),
    status: String(row.status) as WorkflowStepRow["status"],
    input: row.input,
    output: row.output,
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
    next_attempt_at: String(row.next_attempt_at),
    locked_at: row.locked_at != null ? String(row.locked_at) : null,
    locked_by: row.locked_by != null ? String(row.locked_by) : null,
    last_error: row.last_error != null ? String(row.last_error) : null,
    started_at: row.started_at != null ? String(row.started_at) : null,
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
    created_at: String(row.created_at),
  };
}

async function findNextPendingStep(
  adapter: DbAdapter,
  runId: number,
): Promise<WorkflowStepRow | null> {
  const result = await adapter.query(
    `SELECT s.id, s.run_id, s.step_name, s.step_index, s.status, s.input, s.output, s.attempts, s.max_attempts, s.next_attempt_at, s.locked_at, s.locked_by, s.last_error, s.started_at, s.completed_at, s.created_at
     FROM _forge_workflow_steps s
     WHERE s.run_id = $1 AND s.status = 'pending' AND s.next_attempt_at <= now()
     ORDER BY s.step_index
     LIMIT 1`,
    [runId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToStep(result.rows[0]!);
}

async function allStepsCompleted(adapter: DbAdapter, runId: number): Promise<boolean> {
  const result = await adapter.query(
    `SELECT COUNT(*)::int AS pending FROM _forge_workflow_steps
     WHERE run_id = $1 AND status NOT IN ('completed', 'skipped')`,
    [runId],
  );
  return Number(result.rows[0]?.pending ?? 0) === 0;
}

async function hasDeadStep(adapter: DbAdapter, runId: number): Promise<boolean> {
  const result = await adapter.query(
    `SELECT COUNT(*)::int AS dead FROM _forge_workflow_steps
     WHERE run_id = $1 AND status = 'dead'`,
    [runId],
  );
  return Number(result.rows[0]?.dead ?? 0) > 0;
}

export async function processWorkflowRun(
  adapter: DbAdapter,
  workspaceRoot: string,
  tableMap: Record<string, TableMapEntry>,
  workflow: WorkflowDefinition,
  run: WorkflowRunRow,
  workerId: string,
  mock: boolean,
): Promise<"completed" | "dead" | "retry" | "noop" | "canceled"> {
  if (run.status === "canceled" || run.status === "completed" || run.status === "dead") {
    return "noop";
  }

  const freshRun = await adapter.query(
    `SELECT status, canceled_at FROM _forge_workflow_runs WHERE id = $1`,
    [run.id],
  );
  const status = String(freshRun.rows[0]?.status ?? run.status);
  if (status === "canceled") {
    return "canceled";
  }

  const nextStep = await findNextPendingStep(adapter, run.id);
  if (!nextStep) {
    if (await hasDeadStep(adapter, run.id)) {
      await adapter.query(
        `UPDATE _forge_workflow_runs SET status = 'dead', updated_at = now() WHERE id = $1`,
        [run.id],
      );
      return "dead";
    }

    if (await allStepsCompleted(adapter, run.id)) {
      await adapter.query(
        `UPDATE _forge_workflow_runs
         SET status = 'completed', completed_at = now(), updated_at = now(), current_step = NULL
         WHERE id = $1`,
        [run.id],
      );
      return "completed";
    }

    return "noop";
  }

  const priorCompleted = await adapter.query(
    `SELECT COUNT(*)::int AS incomplete FROM _forge_workflow_steps
     WHERE run_id = $1 AND step_index < $2 AND status != 'completed'`,
    [run.id, nextStep.step_index],
  );
  if (Number(priorCompleted.rows[0]?.incomplete ?? 0) > 0) {
    return "noop";
  }

  const claimResult = await adapter.query(
    `UPDATE _forge_workflow_steps
     SET status = 'running', locked_at = now(), locked_by = $1, started_at = COALESCE(started_at, now())
     WHERE id = $2 AND status = 'pending'`,
    [workerId, nextStep.id],
  );

  if (claimResult.rowCount === 0) {
    return "noop";
  }

  await adapter.query(
    `UPDATE _forge_workflow_runs
     SET status = 'running', started_at = COALESCE(started_at, now()), current_step = $1, updated_at = now()
     WHERE id = $2`,
    [nextStep.step_name, run.id],
  );

  const stepResult = await processWorkflowStep(
    adapter,
    workspaceRoot,
    tableMap,
    workflow,
    run,
    nextStep,
    mock,
  );

  if (stepResult.status === "dead") {
    await adapter.query(
      `UPDATE _forge_workflow_runs
       SET status = 'dead', last_error = $1, updated_at = now()
       WHERE id = $2`,
      [sanitizeWorkflowError(stepResult.error ?? "step dead"), run.id],
    );
    return "dead";
  }

  if (stepResult.status === "retry") {
    await adapter.query(
      `UPDATE _forge_workflow_runs SET status = 'failed', last_error = $1, updated_at = now() WHERE id = $2`,
      [sanitizeWorkflowError(stepResult.error ?? "step failed"), run.id],
    );
    return "retry";
  }

  if (await allStepsCompleted(adapter, run.id)) {
    await adapter.query(
      `UPDATE _forge_workflow_runs
       SET status = 'completed', completed_at = now(), updated_at = now(), current_step = NULL, last_error = NULL
       WHERE id = $1`,
      [run.id],
    );
    return "completed";
  }

  await adapter.query(
    `UPDATE _forge_workflow_runs SET status = 'running', updated_at = now() WHERE id = $1`,
    [run.id],
  );
  return "noop";
}
