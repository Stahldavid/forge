import type { WorkflowDefinition } from "../../compiler/types/workflow-registry.ts";
import type { DbAdapter } from "../db/adapter.ts";
import type { CreateWorkflowRunInput, WorkflowRunRow } from "./types.ts";
import { findWorkflowDefinition } from "./registry.ts";

function parseJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function rowToRun(row: Record<string, unknown>): WorkflowRunRow {
  return {
    id: Number(row.id),
    workflow_name: String(row.workflow_name),
    trigger_type: String(row.trigger_type),
    trigger_outbox_id:
      row.trigger_outbox_id != null ? Number(row.trigger_outbox_id) : null,
    idempotency_key: String(row.idempotency_key),
    input: parseJsonValue(row.input),
    auth_context: parseJsonValue(row.auth_context),
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

export async function createWorkflowRun(
  adapter: DbAdapter,
  registry: WorkflowDefinition[],
  input: CreateWorkflowRunInput,
): Promise<{ created: boolean; run: WorkflowRunRow }> {
  const definition = findWorkflowDefinition(registry, input.workflowName);
  if (!definition) {
    throw new Error(`workflow '${input.workflowName}' not found in registry`);
  }

  const insertResult = await adapter.query(
    `INSERT INTO _forge_workflow_runs (workflow_name, trigger_type, trigger_outbox_id, idempotency_key, input, auth_context, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.workflowName,
      input.triggerType,
      input.triggerOutboxId ?? null,
      input.idempotencyKey,
      JSON.stringify(input.input),
      JSON.stringify(input.authContext ?? null),
    ],
  );

  let runId: number;

  if (insertResult.rows.length > 0) {
    runId = Number(insertResult.rows[0]!.id);

    for (const step of definition.steps) {
      await adapter.query(
        `INSERT INTO _forge_workflow_steps (run_id, step_name, step_index, status)
         VALUES ($1, $2, $3, 'pending')`,
        [runId, step.name, step.index],
      );
    }

    const runResult = await adapter.query(
      `SELECT id, workflow_name, trigger_type, trigger_outbox_id, idempotency_key, input, auth_context, status, current_step, last_error, created_at, updated_at, started_at, completed_at, canceled_at
       FROM _forge_workflow_runs WHERE id = $1`,
      [runId],
    );

    return {
      created: true,
      run: rowToRun(runResult.rows[0]!),
    };
  }

  const existing = await adapter.query(
    `SELECT id, workflow_name, trigger_type, trigger_outbox_id, idempotency_key, input, status, current_step, last_error, created_at, updated_at, started_at, completed_at, canceled_at
     FROM _forge_workflow_runs WHERE idempotency_key = $1`,
    [input.idempotencyKey],
  );

  return {
    created: false,
    run: rowToRun(existing.rows[0]!),
  };
}
