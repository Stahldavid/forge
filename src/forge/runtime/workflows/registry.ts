import { nodeFileSystem } from "../../compiler/fs/index.ts";
import { join } from "node:path";
import type { WorkflowDefinition } from "../../compiler/types/workflow-registry.ts";
import type { WorkflowSubscription } from "../../compiler/types/workflow-registry.ts";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../compiler/primitives/header.ts";

interface WorkflowRegistryJson {
  workflows: WorkflowDefinition[];
}

interface WorkflowSubscriptionsJson {
  subscriptions: WorkflowSubscription[];
  byEvent: Record<string, WorkflowSubscription[]>;
}

export function loadWorkflowRegistry(workspaceRoot: string): WorkflowRegistryJson {
  const absolute = join(workspaceRoot, GENERATED_DIR, "workflowRegistry.json");
  if (!nodeFileSystem.exists(absolute)) {
    return { workflows: [] };
  }

  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  const parsed = JSON.parse(raw) as WorkflowRegistryJson;
  return {
    workflows: parsed.workflows ?? [],
  };
}

export function loadWorkflowSubscriptions(
  workspaceRoot: string,
): WorkflowSubscriptionsJson {
  const absolute = join(workspaceRoot, GENERATED_DIR, "workflowSubscriptions.json");
  if (!nodeFileSystem.exists(absolute)) {
    return { subscriptions: [], byEvent: {} };
  }

  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  const parsed = JSON.parse(raw) as WorkflowSubscriptionsJson;
  return {
    subscriptions: parsed.subscriptions ?? [],
    byEvent: parsed.byEvent ?? {},
  };
}

export function findWorkflowDefinition(
  registry: WorkflowDefinition[],
  workflowName: string,
): WorkflowDefinition | undefined {
  return registry.find((workflow) => workflow.name === workflowName);
}
