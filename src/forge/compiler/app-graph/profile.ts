import type { AppGraph } from "../types/app-graph.ts";

export interface AppGraphPhaseTimings {
  normalizeMs: number;
  parseMs: number;
  symbolsMs: number;
  duplicatesMs: number;
  moduleGraphMs: number;
  inputHashMs: number;
  totalMs: number;
}

const appGraphProfiles = new WeakMap<AppGraph, AppGraphPhaseTimings>();

export function recordAppGraphProfile(
  graph: AppGraph,
  timings: AppGraphPhaseTimings,
): void {
  appGraphProfiles.set(graph, timings);
}

export function getAppGraphProfile(
  graph: AppGraph,
): AppGraphPhaseTimings | undefined {
  return appGraphProfiles.get(graph);
}
