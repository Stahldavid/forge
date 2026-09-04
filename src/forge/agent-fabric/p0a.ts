import { ForgeAgentConductor } from "./conductor.ts";
import type {
  AgentAdapter,
  AttemptExecutionPermit,
  AttemptUncertaintyObservation,
  AuthoritativeOutcomeCommit,
  WorkerResultReport,
} from "./types.ts";

export interface ExecuteP0aActivityInput {
  conductor: ForgeAgentConductor;
  adapter: AgentAdapter;
  permit: AttemptExecutionPermit;
}

export type P0aActivityExecutionResult =
  | AuthoritativeOutcomeCommit
  | { status: "unknown"; observation: AttemptUncertaintyObservation };

function describeUnknown(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "adapter_operation_threw";
}

export async function executeP0aActivity(
  input: ExecuteP0aActivityInput,
): Promise<P0aActivityExecutionResult> {
  input.conductor.authorizeAttemptDispatch(input.permit);

  let startup;
  try {
    startup = await input.adapter.startAttempt(input.permit);
  } catch (error) {
    return {
      status: "unknown",
      observation: input.conductor.recordAttemptUncertainty(
        input.permit,
        "startup",
        describeUnknown(error),
      ),
    };
  }

  if (startup.status === "unknown") {
    return {
      status: "unknown",
      observation: input.conductor.recordAttemptUncertainty(
        input.permit,
        "startup",
        startup.reason,
      ),
    };
  }

  input.conductor.acceptStartupReport(input.permit, startup.report);

  let outcome;
  try {
    outcome = await input.adapter.collectOutcome(input.permit.attemptId);
  } catch (error) {
    return {
      status: "unknown",
      observation: input.conductor.recordAttemptUncertainty(
        input.permit,
        "outcome",
        describeUnknown(error),
      ),
    };
  }
  if (outcome.status === "unknown") {
    return {
      status: "unknown",
      observation: input.conductor.recordAttemptUncertainty(
        input.permit,
        "outcome",
        outcome.reason,
      ),
    };
  }
  return input.conductor.commitOutcome(outcome.report as WorkerResultReport);
}
