export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "dead";

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "dead"
  | "skipped";

export interface WorkflowRunRow {
  id: number;
  workflow_name: string;
  trigger_type: string;
  trigger_outbox_id: number | null;
  idempotency_key: string;
  input: unknown;
  status: WorkflowRunStatus;
  current_step: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
}

export interface WorkflowStepRow {
  id: number;
  run_id: number;
  step_name: string;
  step_index: number;
  status: WorkflowStepStatus;
  input: unknown;
  output: unknown;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface CreateWorkflowRunInput {
  workflowName: string;
  input: unknown;
  triggerType: string;
  triggerOutboxId?: number;
  idempotencyKey: string;
}

export interface ProcessWorkflowBatchOptions {
  limit?: number;
  workerId?: string;
  mock?: boolean;
}

export interface ProcessWorkflowBatchResult {
  claimed: number;
  completed: number;
  failed: number;
  dead: number;
  runsStarted: number;
  errors: string[];
}
