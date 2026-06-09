import { createDiagnostic } from "../diagnostics/create.ts";
import {
  FORGE_WORKFLOW_INVALID_STEP,
  FORGE_WORKFLOW_INVALID_TRIGGER,
} from "../diagnostics/codes.ts";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type {
  WorkflowDefinition,
  WorkflowRegistry,
  WorkflowSubscription,
  WorkflowSubscriptions,
} from "../types/workflow-registry.ts";
import {
  WORKFLOW_REGISTRY_ANALYZER_VERSION,
  WORKFLOW_REGISTRY_SCHEMA_VERSION,
} from "./constants.ts";
import {
  parseWorkflowStepNamesFromSlice,
  parseWorkflowTriggerFromSlice,
} from "./parse.ts";

function stableSortWorkflows(workflows: WorkflowDefinition[]): WorkflowDefinition[] {
  return [...workflows].sort((a, b) => {
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });
}

function stableSortSubscriptions(
  subscriptions: WorkflowSubscription[],
): WorkflowSubscription[] {
  return [...subscriptions].sort((a, b) => {
    if (a.eventType !== b.eventType) {
      return a.eventType < b.eventType ? -1 : 1;
    }
    if (a.workflowName !== b.workflowName) {
      return a.workflowName < b.workflowName ? -1 : 1;
    }
    if (a.file !== b.file) {
      return a.file < b.file ? -1 : 1;
    }
    return a.symbolId < b.symbolId ? -1 : a.symbolId > b.symbolId ? 1 : 0;
  });
}

function buildByEvent(
  subscriptions: WorkflowSubscription[],
): Record<string, WorkflowSubscription[]> {
  const byEvent: Record<string, WorkflowSubscription[]> = {};

  for (const subscription of subscriptions) {
    const list = byEvent[subscription.eventType] ?? [];
    list.push(subscription);
    byEvent[subscription.eventType] = list;
  }

  for (const eventType of Object.keys(byEvent).sort()) {
    byEvent[eventType] = stableSortSubscriptions(byEvent[eventType]!);
  }

  return byEvent;
}

export function buildWorkflowRegistry(appGraph: AppGraph): WorkflowRegistry {
  const workflows: WorkflowDefinition[] = [];
  const diagnostics: WorkflowRegistry["diagnostics"] = [];

  for (const symbol of appGraph.symbols) {
    if (symbol.kind !== "workflow") {
      continue;
    }

    const sourceSlice =
      typeof symbol.meta.sourceSlice === "string" ? symbol.meta.sourceSlice : "";

    if (sourceSlice.length === 0) {
      continue;
    }

    const triggerEventType = parseWorkflowTriggerFromSlice(sourceSlice);
    if (/trigger\s*:/.test(sourceSlice) && triggerEventType === null) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: FORGE_WORKFLOW_INVALID_TRIGGER,
          message: `cannot parse trigger for workflow '${symbol.qualifiedName}'`,
          file: symbol.file,
          span: symbol.span,
        }),
      );
    }

    const stepNames = parseWorkflowStepNamesFromSlice(sourceSlice);
    if (stepNames.length === 0 && /step\s*\(/.test(sourceSlice)) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: FORGE_WORKFLOW_INVALID_STEP,
          message: `cannot parse steps for workflow '${symbol.qualifiedName}'`,
          file: symbol.file,
          span: symbol.span,
        }),
      );
    }

    workflows.push({
      name: symbol.name,
      exportName: symbol.name,
      file: symbol.file,
      symbolId: symbol.id,
      ...(triggerEventType !== null ? { triggerEventType } : {}),
      steps: stepNames.map((name, index) => ({ name, index })),
    });
  }

  const sorted = stableSortWorkflows(workflows);

  return {
    schemaVersion: WORKFLOW_REGISTRY_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: WORKFLOW_REGISTRY_ANALYZER_VERSION,
    inputHash: hashStable(
      canonicalJson({
        appInputHash: appGraph.inputHash,
        analyzerVersion: WORKFLOW_REGISTRY_ANALYZER_VERSION,
      }),
    ),
    workflows: sorted,
    diagnostics: diagnostics.sort((a, b) => {
      const fileA = a.file ?? "";
      const fileB = b.file ?? "";
      if (fileA !== fileB) {
        return fileA < fileB ? -1 : 1;
      }
      return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
    }),
  };
}

export function buildWorkflowSubscriptions(
  registry: WorkflowRegistry,
): WorkflowSubscriptions {
  const subscriptions: WorkflowSubscription[] = [];

  for (const workflow of registry.workflows) {
    if (!workflow.triggerEventType) {
      continue;
    }

    subscriptions.push({
      eventType: workflow.triggerEventType,
      workflowName: workflow.name,
      exportName: workflow.exportName,
      file: workflow.file,
      symbolId: workflow.symbolId,
    });
  }

  const sorted = stableSortSubscriptions(subscriptions);

  return {
    schemaVersion: WORKFLOW_REGISTRY_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: WORKFLOW_REGISTRY_ANALYZER_VERSION,
    inputHash: hashStable(
      canonicalJson({
        registryInputHash: registry.inputHash,
        analyzerVersion: WORKFLOW_REGISTRY_ANALYZER_VERSION,
      }),
    ),
    subscriptions: sorted,
    byEvent: buildByEvent(sorted),
    diagnostics: [...registry.diagnostics],
  };
}
