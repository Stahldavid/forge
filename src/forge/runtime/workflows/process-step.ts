import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { WorkflowDefinition } from "../../compiler/types/workflow-registry.ts";
import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import {
  FORGE_WORKFLOW_STEP_DEAD,
  FORGE_WORKFLOW_STEP_FAILED,
} from "../../compiler/diagnostics/codes.ts";
import { adapterAsTransaction } from "../db/adapter.ts";
import type { DbAdapter } from "../db/adapter.ts";
import { createGeneratedDbClient } from "../db/generated-client.ts";
import { createActionContext } from "../context/create-context.ts";
import { systemAuthFromSnapshot } from "../auth/resolve.ts";
import type { AuthContext } from "../auth/types.ts";
import { resolveWorkflowStepHandler } from "./resolve-step.ts";
import { computeNextAttemptAt, formatTimestamp } from "./retry.ts";
import { sanitizeWorkflowError } from "./sanitize.ts";
import { createTelemetryContext } from "../telemetry/context.ts";
import { generateTraceId } from "../telemetry/correlation.ts";
import type { WorkflowRunRow, WorkflowStepRow } from "./types.ts";

export interface ProcessStepResult {
  ok: boolean;
  status: "completed" | "retry" | "dead";
  output?: unknown;
  error?: string;
}

async function loadCompletedStepOutputs(
  adapter: DbAdapter,
  runId: number,
): Promise<Record<string, { output: unknown }>> {
  const result = await adapter.query(
    `SELECT step_name, output FROM _forge_workflow_steps
     WHERE run_id = $1 AND status = 'completed'
     ORDER BY step_index`,
    [runId],
  );

  const steps: Record<string, { output: unknown }> = {};
  for (const row of result.rows) {
    const output = row.output;
    steps[String(row.step_name)] = {
      output:
        typeof output === "string"
          ? (() => {
              try {
                return JSON.parse(output);
              } catch {
                return output;
              }
            })()
          : output,
    };
  }
  return steps;
}

export async function processWorkflowStep(
  adapter: DbAdapter,
  workspaceRoot: string,
  tableMap: Record<string, TableMapEntry>,
  workflow: WorkflowDefinition,
  run: WorkflowRunRow,
  step: WorkflowStepRow,
  mock: boolean,
): Promise<ProcessStepResult> {
  const resolved = await resolveWorkflowStepHandler(
    workspaceRoot,
    workflow,
    step.step_name,
    mock,
  );

  if (!resolved.ok) {
    return await handleStepFailure(adapter, step, resolved.error);
  }

  try {
    const tx = adapterAsTransaction(adapter);
    const snapshot = (run.auth_context as AuthContext | undefined) ?? { kind: "anonymous" };
    const tenantId =
      snapshot.kind === "user"
        ? snapshot.tenantId
        : snapshot.kind === "system"
          ? snapshot.tenantId
          : undefined;
    const auth = systemAuthFromSnapshot(snapshot, tenantId);
    const db = createGeneratedDbClient(tx, tableMap, { auth });
    const completedSteps = await loadCompletedStepOutputs(adapter, run.id);

    const inputObj =
      run.input && typeof run.input === "object"
        ? (run.input as Record<string, unknown>)
        : {};
    const traceId =
      typeof inputObj.traceId === "string" ? inputObj.traceId : generateTraceId();

    const telemetry = createTelemetryContext({
      adapter,
      traceId,
      runtime: { kind: "workflow", name: run.workflow_name },
      workflow: { runId: String(run.id), stepName: step.step_name },
      bufferInTransaction: false,
      workspaceRoot,
      sinks: ["local"],
    });

    const baseCtx = createActionContext(db, telemetry, auth, {
      workspaceRoot,
      runtimeKind: "workflow",
      mockAi: mock,
    });

    const ctx = {
      input: run.input,
      steps: completedSteps,
      db: baseCtx.db,
      env: baseCtx.env,
      telemetry,
      auth,
      ai: baseCtx.ai,
    };

    const runRecord = {
      id: run.id,
      workflowName: run.workflow_name,
      status: run.status,
      input: run.input,
      currentStep: step.step_name,
    };

    const output = await resolved.handler(ctx, runRecord);

    await telemetry.flush("local");

    await adapter.query(
      `UPDATE _forge_workflow_steps
       SET status = 'completed', output = $1, completed_at = now(), locked_at = NULL, locked_by = NULL, last_error = NULL
       WHERE id = $2`,
      [JSON.stringify(output ?? null), step.id],
    );

    return { ok: true, status: "completed", output };
  } catch (error) {
    const message = error instanceof Error ? error.message : "workflow step failed";
    return await handleStepFailure(adapter, step, message);
  }
}

async function handleStepFailure(
  adapter: DbAdapter,
  step: WorkflowStepRow,
  rawError: string,
): Promise<ProcessStepResult> {
  const errorMessage = sanitizeWorkflowError(rawError);
  const nextAttempts = step.attempts + 1;

  if (nextAttempts >= step.max_attempts) {
    await adapter.query(
      `UPDATE _forge_workflow_steps
       SET status = 'dead', attempts = $1, last_error = $2, locked_at = NULL, locked_by = NULL
       WHERE id = $3`,
      [nextAttempts, errorMessage, step.id],
    );

    createDiagnostic({
      severity: "error",
      code: FORGE_WORKFLOW_STEP_DEAD,
      message: `step ${step.step_name} dead after ${nextAttempts} attempts: ${errorMessage}`,
    });

    return { ok: false, status: "dead", error: errorMessage };
  }

  const nextAttemptAt = formatTimestamp(computeNextAttemptAt(nextAttempts));
  await adapter.query(
    `UPDATE _forge_workflow_steps
     SET status = 'pending', attempts = $1, last_error = $2, next_attempt_at = $3, locked_at = NULL, locked_by = NULL
     WHERE id = $4`,
    [nextAttempts, errorMessage, nextAttemptAt, step.id],
  );

  createDiagnostic({
    severity: "warning",
    code: FORGE_WORKFLOW_STEP_FAILED,
    message: `step ${step.step_name} scheduled retry ${nextAttempts}: ${errorMessage}`,
  });

  return { ok: false, status: "retry", error: errorMessage };
}
