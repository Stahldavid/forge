import { ForgeAgentConductor } from "./conductor.ts";
import type { AgentAdapter, AttemptExecutionPermit, WorkerResultReport } from "./types.ts";

export interface ExecuteP0aActivityInput {
  conductor: ForgeAgentConductor;
  adapter: AgentAdapter;
  permit: AttemptExecutionPermit;
}

function describeUnknown(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "adapter_operation_threw";
}

export async function executeP0aActivity(input: ExecuteP0aActivityInput) {
  input.conductor.authorizeAttemptDispatch(input.permit);

  let startup;
  try {
    startup = await input.adapter.startAttempt(input.permit);
  } catch (error) {
    input.conductor.recordStartupUnknown(input.permit, describeUnknown(error));
    return input.conductor.commitUnknownOutcome(input.permit.attemptId);
  }

  if (startup.status === "unknown") {
    input.conductor.recordStartupUnknown(input.permit, startup.reason);
    return input.conductor.commitUnknownOutcome(input.permit.attemptId);
  }

  input.conductor.acceptStartupReport(input.permit, startup.report);

  let outcome;
  try {
    outcome = await input.adapter.collectOutcome(input.permit.attemptId);
  } catch {
    return input.conductor.commitUnknownOutcome(input.permit.attemptId);
  }
  if (outcome.status === "unknown") {
    return input.conductor.commitUnknownOutcome(input.permit.attemptId);
  }
  return input.conductor.commitOutcome(outcome.report as WorkerResultReport);
}
