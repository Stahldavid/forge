export type OutboxDeliveryStatus =
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "dead";

export interface OutboxEventRow {
  id: number;
  event_type: string;
  payload: unknown;
  auth_context?: unknown;
  created_at: string;
}

export interface OutboxDeliveryRow {
  id: number;
  outbox_id: number;
  action_name: string;
  status: OutboxDeliveryStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface ClaimedDelivery extends OutboxDeliveryRow {
  payload: unknown;
  event_type: string;
  auth_context?: unknown;
}

export interface ProcessOutboxBatchOptions {
  limit?: number;
  workerId?: string;
  mock?: boolean;
  telemetrySinks?: string[];
  workspaceRoot?: string;
}

export interface ProcessOutboxBatchResult {
  processed: number;
  failed: number;
  dead: number;
  claimed: number;
  errors: string[];
}

export interface OutboxWorkerOptions extends ProcessOutboxBatchOptions {
  intervalMs?: number;
}

export interface OutboxWorkerHandle {
  stop: () => void;
  isRunning: () => boolean;
}

export interface OutboxSummary {
  pending: number;
  processing: number;
  processed: number;
  failed: number;
  dead: number;
  events: number;
}
