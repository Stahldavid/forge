import type { Diagnostic } from "./diagnostic.ts";

export interface ActionSubscription {
  eventType: string;
  actionName: string;
  exportName: string;
  file: string;
  symbolId: string;
}

export interface ActionSubscriptions {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  subscriptions: ActionSubscription[];
  byEvent: Record<string, ActionSubscription[]>;
  diagnostics: Diagnostic[];
}
