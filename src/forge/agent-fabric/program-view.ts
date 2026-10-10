import { programDigest, type ProgramOperationRecord, type WorkflowProgramV2, type ProgramRunV2 } from "./program-contract.ts";
import { programGraph } from "./program-structure.ts";

/** Suggested next actions never grant authorization or observe external effects. */
export function programDiagnostics(state: ProgramRunV2) {
  const diagnostics: { code: string; message: string; operationId?: string; attemptId?: string; actions: string[] }[] = [];
  if (state.status === "apply-uncertain") diagnostics.push({ code: "publication-unknown", message: state.reason ?? "Observe target files before reconciling publication", actions: ["program-reconcile"] });
  for (const attempt of Object.values(state.attempts)) {
    if (attempt.outcome === "uncertain") diagnostics.push({ code: "effects-unknown", message: attempt.reason ?? "Observe worker termination and workspace effects", attemptId: attempt.attemptId, operationId: attempt.operationId, actions: ["program-reconcile"] });
    else if (["invalid_output", "infrastructure_failed"].includes(attempt.outcome)) diagnostics.push({ code: attempt.outcome, message: attempt.reason ?? attempt.outcome, attemptId: attempt.attemptId, operationId: attempt.operationId, actions: ["program-explain", "program-replan"] });
  }
  if (state.reason && /budget|token/i.test(state.reason)) diagnostics.push({ code: "resource-admission-blocked", message: state.reason, actions: ["program-explain"] });
  if (state.status === "paused") diagnostics.push({ code: "paused", message: "Explicit resume is required after resolving uncertain work", actions: ["program-resume"] });
  if (state.status === "waiting") diagnostics.push({ code: "waiting", message: state.reason ?? "Waiting for a typed authorized signal or deadline", actions: ["program-signal", "program-explain"] });
  return diagnostics;
}

/** Inspection only; static templates are distinct from observed expansion instances. */
export function programVisualization(program: WorkflowProgramV2, operations: Record<string, ProgramOperationRecord> = {}) {
  const nodes = programGraph(program).map(({ id, step, dependencies }) => ({ id, kind: step.kind, dependencies, status: operations[id]?.status ?? "template" }));
  const key = (id: string) => `n${programDigest(id).slice(7, 31)}`;
  const label = (value: string) => value.replace(/[&<>"\[\]{}\n\r]/g, "_");
  const lines = ["flowchart TD", ...nodes.map(node => `  ${key(node.id)}["${label(`${node.id}: ${node.kind} (${node.status})`)}"]`)];
  for (const node of nodes) for (const dependency of node.dependencies) lines.push(`  ${key(dependency)} --> ${key(node.id)}`);
  return { nodes, instances: Object.values(operations).map(operation => ({ id: operation.id, kind: operation.kind, status: operation.status, generation: operation.generation, retired: operation.retired ?? false })), mermaid: lines.join("\n"), semantics: "Static template dependency graph; runtime expansions appear separately in instances" };
}
