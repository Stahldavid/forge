import { programDigest, type ProgramOperationRecord, type WorkflowProgramV2 } from "./program-contract.ts";
import { programGraph } from "./program-structure.ts";

/** Inspection only; static templates are distinct from observed expansion instances. */
export function programVisualization(program: WorkflowProgramV2, operations: Record<string, ProgramOperationRecord> = {}) {
  const nodes = programGraph(program).map(({ id, step, dependencies }) => ({ id, kind: step.kind, dependencies, status: operations[id]?.status ?? "template" }));
  const key = (id: string) => `n${programDigest(id).slice(7, 31)}`;
  const label = (value: string) => value.replace(/[&<>"\[\]{}\n\r]/g, "_");
  const lines = ["flowchart TD", ...nodes.map(node => `  ${key(node.id)}["${label(`${node.id}: ${node.kind} (${node.status})`)}"]`)];
  for (const node of nodes) for (const dependency of node.dependencies) lines.push(`  ${key(dependency)} --> ${key(node.id)}`);
  return { nodes, instances: Object.values(operations).map(operation => ({ id: operation.id, kind: operation.kind, status: operation.status, generation: operation.generation, retired: operation.retired ?? false })), mermaid: lines.join("\n"), semantics: "Static template dependency graph; runtime expansions appear separately in instances" };
}
