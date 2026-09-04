import { digestCanonical } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import type {
  DigestFunction,
  PlanDelta,
  RunPlanRevision,
  WorkflowNode,
  WorkflowProgramVersion,
} from "./types.ts";

function normalizedNode(node: WorkflowNode): WorkflowNode {
  return {
    ...node,
    dependsOn: [...node.dependsOn].sort(),
  };
}

export function validateWorkflowNodes(nodes: readonly WorkflowNode[]): void {
  const byId = new Map<string, WorkflowNode>();
  for (const node of nodes) {
    if (byId.has(node.nodeId)) {
      throw new AgentFabricError("AF_INVALID_PLAN", `Duplicate workflow node: ${node.nodeId}`);
    }
    byId.set(node.nodeId, node);
  }

  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) {
        throw new AgentFabricError(
          "AF_INVALID_PLAN",
          `Node ${node.nodeId} depends on missing node ${dependency}`,
        );
      }
      if (dependency === node.nodeId) {
        throw new AgentFabricError(
          "AF_INVALID_PLAN",
          `Node ${node.nodeId} cannot depend on itself`,
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      throw new AgentFabricError("AF_INVALID_PLAN", `Workflow cycle detected at ${nodeId}`);
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const dependency of byId.get(nodeId)?.dependsOn ?? []) {
      visit(dependency);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const nodeId of byId.keys()) visit(nodeId);
}

export function computeRunPlanContentDigest(
  programVersionId: string,
  nodes: readonly WorkflowNode[],
  digest: DigestFunction,
) {
  const normalized = nodes.map(normalizedNode).sort((left, right) =>
    left.nodeId.localeCompare(right.nodeId)
  );
  validateWorkflowNodes(normalized);
  return digestCanonical({ programVersionId, nodes: normalized }, digest);
}

export function createRunPlanRevision(
  rootExecutionId: string,
  goalId: string,
  program: WorkflowProgramVersion,
  revisionId: string,
  digest: DigestFunction,
): RunPlanRevision {
  validateWorkflowNodes(program.nodes);
  const nodes = program.nodes.map(normalizedNode).sort((left, right) =>
    left.nodeId.localeCompare(right.nodeId)
  );
  return {
    revisionId,
    rootExecutionId,
    goalId,
    programVersionId: `${program.programId}@${program.version}`,
    revisionNumber: 1,
    parentRevisionId: null,
    sourcePlanDeltaId: null,
    nodes,
    contentDigest: computeRunPlanContentDigest(
      `${program.programId}@${program.version}`,
      nodes,
      digest,
    ),
  };
}

export function applyPlanDelta(
  base: RunPlanRevision,
  delta: PlanDelta,
  digest: DigestFunction,
): RunPlanRevision {
  if (delta.rootExecutionId !== base.rootExecutionId || delta.baseRevisionId !== base.revisionId) {
    throw new AgentFabricError(
      "AF_INVALID_PLAN",
      `Plan delta ${delta.deltaId} is stale or targets another execution`,
    );
  }

  const nodes = new Map(base.nodes.map((node) => [node.nodeId, normalizedNode(node)]));
  for (const operation of delta.operations) {
    if (operation.kind === "add_node") {
      if (nodes.has(operation.node.nodeId)) {
        throw new AgentFabricError(
          "AF_INVALID_PLAN",
          `Cannot add existing workflow node ${operation.node.nodeId}`,
        );
      }
      nodes.set(operation.node.nodeId, normalizedNode(operation.node));
      continue;
    }
    if (operation.kind === "replace_node") {
      if (!nodes.has(operation.node.nodeId)) {
        throw new AgentFabricError(
          "AF_INVALID_PLAN",
          `Cannot replace missing workflow node ${operation.node.nodeId}`,
        );
      }
      nodes.set(operation.node.nodeId, normalizedNode(operation.node));
      continue;
    }
    if (!nodes.delete(operation.nodeId)) {
      throw new AgentFabricError(
        "AF_INVALID_PLAN",
        `Cannot remove missing workflow node ${operation.nodeId}`,
      );
    }
  }

  const nextNodes = [...nodes.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  validateWorkflowNodes(nextNodes);
  return {
    ...base,
    revisionId: delta.nextRevisionId,
    revisionNumber: base.revisionNumber + 1,
    parentRevisionId: base.revisionId,
    sourcePlanDeltaId: delta.deltaId,
    nodes: nextNodes,
    contentDigest: computeRunPlanContentDigest(base.programVersionId, nextNodes, digest),
  };
}
