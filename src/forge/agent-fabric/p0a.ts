import { ForgeAgentConductor } from "./conductor.ts";
import type { AgentAdapter, AttemptExecutionPermit, WorkerResultReport } from "./types.ts";

export interface ExecuteP0aActivityInput {
  conductor: ForgeAgentConductor;
  adapter: AgentAdapter;
  permit: AttemptExecutionPermit;
}

export async function executeP0aActivity(input: ExecuteP0aActivityInput) {
  const startup = await input.adapter.startAttempt(input.permit);
  if (startup.status === "unknown") {
    input.conductor.recordStartupUnknown(input.permit, startup.reason);
    return input.conductor.commitUnknownOutcome(input.permit.attemptId);
  }
  input.conductor.acceptStartupReport(input.permit, startup.report);
  const outcome = await input.adapter.collectOutcome(input.permit.attemptId);
  if (outcome.status === "unknown") {
    return input.conductor.commitUnknownOutcome(input.permit.attemptId);
  }
  return input.conductor.commitOutcome(outcome.report as WorkerResultReport);
}
