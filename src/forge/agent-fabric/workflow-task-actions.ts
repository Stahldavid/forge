import type { AttachedTaskState } from "./attached-task-contract.ts";
import { attachedFail, attachedId, attachedObject, attachedText } from "./attached-task-contract.ts";
import {
  claimWorkflow, completeWorkflow, createWorkflow, nextWorkflow, reconcileWorkflow,
  recoverWorkflow, replanWorkflow, validateWorkflowState,
  type WorkflowState,
} from "./workflow-engine.ts";

export type { WorkflowState } from "./workflow-engine.ts";

const COMMON = ["taskId", "requestId", "expectedVersion"];
export const WORKFLOW_TASK_MUTATIONS = [
  "workflow-plan", "workflow-claim", "workflow-result", "workflow-replan",
  "workflow-reconcile", "workflow-recover",
] as const;

function current(state: AttachedTaskState): WorkflowState {
  if (!state.workflow) attachedFail("AF_WORKFLOW_MISSING", "Task has no workflow; record workflow-plan first");
  return validateWorkflowState(state.workflow);
}

/** Results describe the source version actually observed, not merely a caller-supplied digest. */
export function workflowSourceProblems(state: AttachedTaskState, snapshotDigest: string): string[] {
  if (!state.workflow) return [];
  const workflow = current(state);
  return workflow.nodes.filter(node => {
    const generation = workflow.generations.find(item => item.nodeId === node.nodeId)!.generation;
    const run = [...workflow.runs].reverse().find(item => item.nodeId === node.nodeId &&
      item.generation === generation && item.status === "succeeded");
    if (!run) return false;
    return !state.workflowSnapshots?.some(item => item.nodeId === node.nodeId &&
      item.attemptId === run.attemptId && item.snapshotDigest === snapshotDigest);
  }).map(node => node.nodeId);
}

function sourceBoundSchedule(state: AttachedTaskState, snapshotDigest: string): unknown {
  const schedule = nextWorkflow(current(state));
  const staleNodeIds = workflowSourceProblems(state, snapshotDigest);
  return { ...schedule, snapshotDigest, staleNodeIds,
    packets: staleNodeIds.length ? [] : schedule.packets,
    complete: schedule.complete && staleNodeIds.length === 0,
    blockedReasons: [...schedule.blockedReasons, ...staleNodeIds.map(id => `source snapshot changed for ${id}; replan before reusing its result`)] };
}

/** Persistence/CAS is supplied by AttachedTaskService, never by the pure scheduler. */
export function applyWorkflowTaskAction(
  state: AttachedTaskState, action: string, body: Record<string, unknown>, snapshotDigest: string,
): { state: AttachedTaskState; result?: unknown } {
  let workflow: WorkflowState;
  if (action === "workflow-plan") {
    attachedObject(body, [...COMMON, "workflow"]);
    if (state.workflow) attachedFail("AF_WORKFLOW_EXISTS", "Use workflow-replan to revise an existing workflow");
    workflow = createWorkflow(body.workflow as Parameters<typeof createWorkflow>[0]);
  } else if (action === "workflow-claim") {
    attachedObject(body, [...COMMON, "nodeId", "attemptId", "executorId", "expectedRevision"]);
    if (workflowSourceProblems(state, snapshotDigest).length) attachedFail("AF_WORKFLOW_STALE_SOURCE", "Source snapshot changed; replan before dispatching another step");
    if (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) attachedFail("AF_WORKFLOW_REVISION", "expectedRevision is required");
    workflow = claimWorkflow(current(state), {
      nodeId: attachedId(body.nodeId, "nodeId"), attemptId: attachedId(body.attemptId, "attemptId"),
      executorId: attachedId(body.executorId, "executorId"),
      expectedRevision: body.expectedRevision as number,
    });
  } else if (action === "workflow-result" || action === "workflow-reconcile") {
    attachedObject(body, [...COMMON, "attemptId", "result", "observedSnapshotDigest"]);
    const input = { attemptId: attachedId(body.attemptId, "attemptId"),
      result: body.result as Parameters<typeof completeWorkflow>[1]["result"] };
    if (input.result?.status === "succeeded" && body.observedSnapshotDigest !== snapshotDigest) {
      attachedFail("AF_WORKFLOW_STALE_RESULT", "Successful result must name the source snapshot actually observed; obsolete evidence cannot be relabelled");
    }
    workflow = action === "workflow-result" ? completeWorkflow(current(state), input)
      : reconcileWorkflow(current(state), input as Parameters<typeof reconcileWorkflow>[1]);
  } else if (action === "workflow-replan") {
    attachedObject(body, [...COMMON, "expectedRevision", "nodes", "reason", "evidenceRefs"]);
    const stale = new Set(workflowSourceProblems(state, snapshotDigest));
    const proposedNodes = body.nodes as Parameters<typeof replanWorkflow>[1]["nodes"];
    if (!Array.isArray(proposedNodes)) attachedFail("AF_WORKFLOW_INPUT", "nodes must be an array");
    // A source change cannot be hidden by resubmitting the same declared input digest.
    const nodes = proposedNodes.map(node => stale.has(node.nodeId)
      ? { ...node, inputDigest: `sha256:${snapshotDigest}` } : node);
    workflow = replanWorkflow(current(state), {
      expectedRevision: body.expectedRevision as number,
      nodes,
      reason: attachedText(body.reason, "reason"),
      evidenceRefs: body.evidenceRefs as string[],
    });
  } else if (action === "workflow-recover") {
    attachedObject(body, [...COMMON, "reason"]);
    workflow = recoverWorkflow(current(state), attachedText(body.reason, "reason"));
  } else attachedFail("AF_WORKFLOW_ACTION", `Unknown workflow mutation: ${action}`);
  const updated = { ...state, workflow: nextWorkflow(workflow).state };
  if (action === "workflow-result" || action === "workflow-reconcile") {
    const run = updated.workflow.runs.find(item => item.attemptId === body.attemptId)!;
    if (run.status === "succeeded") updated.workflowSnapshots = [
      ...(state.workflowSnapshots ?? []).filter(item => item.nodeId !== run.nodeId),
      { nodeId: run.nodeId, attemptId: run.attemptId, snapshotDigest },
    ];
  }
  return { state: updated, result: sourceBoundSchedule(updated, snapshotDigest) };
}

export function readWorkflowTaskAction(state: AttachedTaskState, action: string, snapshotDigest: string): unknown {
  if (action !== "workflow-next") attachedFail("AF_WORKFLOW_ACTION", `Unknown workflow read: ${action}`);
  return sourceBoundSchedule(state, snapshotDigest);
}
