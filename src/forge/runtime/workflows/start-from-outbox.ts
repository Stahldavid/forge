import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { DbAdapter } from "../db/adapter.ts";
import { createWorkflowRun } from "./create-run.ts";
import { loadWorkflowRegistry, loadWorkflowSubscriptions } from "./registry.ts";

function parsePayload(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export async function startWorkflowRunsForPendingOutbox(
  adapter: DbAdapter,
  workspaceRoot: string,
): Promise<{ started: number; skipped: number }> {
  const { workflows } = loadWorkflowRegistry(workspaceRoot);
  const { byEvent } = loadWorkflowSubscriptions(workspaceRoot);

  if (workflows.length === 0) {
    return { started: 0, skipped: 0 };
  }

  const outboxEvents = await adapter.query(
    `SELECT o.id, o.event_type, o.payload
     FROM _forge_outbox o
     ORDER BY o.id`,
  );

  let started = 0;
  let skipped = 0;

  for (const row of outboxEvents.rows) {
    const outboxId = Number(row.id);
    const eventType = String(row.event_type);
    const subscriptions = byEvent[eventType] ?? [];

    if (subscriptions.length === 0) {
      continue;
    }

    const payload = parsePayload(row.payload);

    for (const subscription of subscriptions) {
      const idempotencyKey = `${subscription.workflowName}:outbox:${outboxId}`;
      const result = await createWorkflowRun(adapter, workflows, {
        workflowName: subscription.workflowName,
        input: payload,
        triggerType: "event",
        triggerOutboxId: outboxId,
        idempotencyKey,
      });

      if (result.created) {
        started += 1;
      } else {
        skipped += 1;
      }
    }
  }

  return { started, skipped };
}

export type { TableMapEntry };
