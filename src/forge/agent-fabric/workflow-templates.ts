import { createWorkflow, type WorkflowLimits, type WorkflowNode, type WorkflowState } from "./workflow-engine.ts";

/** Templates describe obligations; the caller supplies executors and evidence. */
export function createChangeReviewWorkflow(input: { workflowId: string; inputDigest: string; inputRefs?: string[]; limits?: Partial<WorkflowLimits> }): WorkflowState {
  const node = (nodeId: string, kind: WorkflowNode["kind"], dependsOn: string[], evidenceKind: string): WorkflowNode => ({ nodeId, kind, dependsOn, inputDigest: input.inputDigest, required: true, inputRefs: input.inputRefs ?? [], outputContract: { requiredEvidenceKinds: [evidenceKind] } });
  return createWorkflow({ workflowId: input.workflowId, limits: input.limits, nodes: [node("implement", "activity", [], "change-snapshot"), node("review", "activity", ["implement"], "adversarial-review"), node("verify", "verification", ["implement"], "verification"), node("accept", "join", ["review", "verify"], "acceptance")] });
}

export function createInvestigationWorkflow(input: { workflowId: string; inputDigest: string; hypotheses: { nodeId: string; inputDigest: string; inputRefs?: string[] }[]; limits?: Partial<WorkflowLimits> }): WorkflowState {
  return createWorkflow({ workflowId: input.workflowId, limits: input.limits, nodes: [...input.hypotheses.map(hypothesis => ({ ...hypothesis, kind: "activity" as const, required: true, dependsOn: [], outputContract: { requiredEvidenceKinds: ["hypothesis-evidence"] } })), { nodeId: "synthesize", kind: "join", required: true, dependsOn: input.hypotheses.map(hypothesis => hypothesis.nodeId), inputDigest: input.inputDigest, outputContract: { requiredEvidenceKinds: ["investigation-conclusion"] } }] });
}
