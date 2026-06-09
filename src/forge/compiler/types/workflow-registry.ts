import type { Diagnostic } from "./diagnostic.ts";

export interface WorkflowStepDefinition {
  name: string;
  index: number;
}

export interface WorkflowDefinition {
  name: string;
  exportName: string;
  file: string;
  symbolId: string;
  triggerEventType?: string;
  steps: WorkflowStepDefinition[];
}

export interface WorkflowSubscription {
  eventType: string;
  workflowName: string;
  exportName: string;
  file: string;
  symbolId: string;
}

export interface WorkflowRegistry {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  workflows: WorkflowDefinition[];
  diagnostics: Diagnostic[];
}

export interface WorkflowSubscriptions {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  subscriptions: WorkflowSubscription[];
  byEvent: Record<string, WorkflowSubscription[]>;
  diagnostics: Diagnostic[];
}
