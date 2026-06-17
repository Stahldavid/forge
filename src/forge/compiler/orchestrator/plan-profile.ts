import type { EmitPlan } from "../types/emit.ts";

export interface PlanPhaseTimings {
  coreArtifactsMs: number;
  agentArtifactsMs: number;
  supportArtifactsMs: number;
  fileRenderMs: number;
  finalizeMs: number;
  totalMs: number;
}

const planProfiles = new WeakMap<EmitPlan, PlanPhaseTimings>();

export function recordPlanProfile(
  plan: EmitPlan,
  timings: PlanPhaseTimings,
): void {
  planProfiles.set(plan, timings);
}

export function getPlanProfile(plan: EmitPlan): PlanPhaseTimings | undefined {
  return planProfiles.get(plan);
}
