import type { DbAdapter } from "../db/adapter.ts";

export async function cancelWorkflowRun(
  adapter: DbAdapter,
  runId: number,
): Promise<boolean> {
  const result = await adapter.query(
    `UPDATE _forge_workflow_runs
     SET status = 'canceled', canceled_at = now(), updated_at = now()
     WHERE id = $1 AND status NOT IN ('completed', 'canceled', 'dead')`,
    [runId],
  );

  if (result.rowCount === 0) {
    return false;
  }

  await adapter.query(
    `UPDATE _forge_workflow_steps
     SET status = 'skipped', locked_at = NULL, locked_by = NULL
     WHERE run_id = $1 AND status IN ('pending', 'running')`,
    [runId],
  );

  return true;
}
