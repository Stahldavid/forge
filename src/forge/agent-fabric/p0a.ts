import { ForgeAgentConductor } from "./hardened-conductor.ts";
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

function recordUncertainty(
  conductor: ForgeAgentConductor,
  permit: AttemptExecutionPermit,
  phase: "startup" | "outcome",
  reason: string,
): P0aActivityExecutionResult {
  return {
    status: "unknown",
    observation: conductor.recordAttemptUncertainty(permit, phase, reason),
  };
}

export async function executeP0aActivity(
  input: ExecuteP0aActivityInput,
): Promise<P0aActivityExecutionResult> {
  input.conductor.authorizeAttemptDispatch(input.permit);

  let startup;
  try {
    startup = await input.adapter.startAttempt(input.permit);
  } catch (error) {
    return recordUncertainty(
      input.conductor,
      input.permit,
      "startup",
      describeUnknown(error),
    );
  }

  if (startup.status === "unknown") {
    return recordUncertainty(
      input.conductor,
      input.permit,
      "startup",
      startup.reason,
    );
  }

  try {
    input.conductor.acceptStartupReport(input.permit, startup.report);
  } catch (error) {
    return recordUncertainty(
      input.conductor,
      input.permit,
      "startup",
      `startup_report_rejected:${describeUnknown(error)}`,
    );
  }

  let outcome;
  try {
    outcome = await input.adapter.collectOutcome(input.permit.attemptId);
  } catch (error) {
    return recordUncertainty(
      input.conductor,
      input.permit,
      "outcome",
      describeUnknown(error),
    );
  }

  if (outcome.status === "unknown") {
    return recordUncertainty(
      input.conductor,
      input.permit,
      "outcome",
      outcome.reason,
    );
  }

  try {
    return input.conductor.commitOutcome(outcome.report as WorkerResultReport);
  } catch (error) {
    return recordUncertainty(
      input.conductor,
      input.permit,
      "outcome",
      `outcome_report_rejected:${describeUnknown(error)}`,
    );
  }
}
