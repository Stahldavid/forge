import { AgentFabricError } from "./errors.ts";
import { ForgeAgentConductor } from "./conductor.ts";
import type { AgentAdapter, AttemptExecutionPermit, WorkerResultReport } from "./types.ts";

export interface ExecuteP0aActivityInput {
  conductor: ForgeAgentConductor;
  adapter: AgentAdapter;
  permit: AttemptExecutionPermit;
}

export async function executeP0aActivity(input: ExecuteP0aActivityInput) {
  input.conductor.startAttempt(input.permit);
  const startup = await input.adapter.startAttempt(input.permit);
  if (startup.status === "unknown") {
    return input.conductor.commitUnknownOutcome(input.permit.attemptId);
  }
  if (startup.report.observedSpecDigest !== input.permit.effectiveRunSpecDigest) {
    throw new AgentFabricError(
      "AF_PERMIT_REJECTED",
      "Adapter started a different EffectiveRunSpec",
    );
  }
  const outcome = await input.adapter.collectOutcome(input.permit.attemptId);
  if (outcome.status === "unknown") {
    return input.conductor.commitUnknownOutcome(input.permit.attemptId);
  }
  return input.conductor.commitOutcome(outcome.report as WorkerResultReport);
}
