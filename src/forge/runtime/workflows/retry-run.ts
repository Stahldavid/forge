import type { DbAdapter } from "../db/adapter.ts";

export async function retryWorkflowRun(
  adapter: DbAdapter,
  runId: number,
  stepName?: string,
): Promise<boolean> {
  const runResult = await adapter.query(
    `SELECT id, status FROM _forge_workflow_runs WHERE id = $1`,
    [runId],
  );

  if (runResult.rows.length === 0) {
    return false;
  }

  if (stepName) {
    const stepResult = await adapter.query(
      `UPDATE _forge_workflow_steps
       SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL, locked_at = NULL, locked_by = NULL, output = NULL, completed_at = NULL
       WHERE run_id = $1 AND step_name = $2`,
      [runId, stepName],
    );
    if (stepResult.rowCount === 0) {
      return false;
    }
  } else {
    await adapter.query(
      `UPDATE _forge_workflow_steps
       SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL, locked_at = NULL, locked_by = NULL
       WHERE run_id = $1 AND status IN ('failed', 'dead')`,
      [runId],
    );
  }

  await adapter.query(
    `UPDATE _forge_workflow_runs
     SET status = 'pending', last_error = NULL, completed_at = NULL, canceled_at = NULL, updated_at = now()
     WHERE id = $1`,
    [runId],
  );

  return true;
}
