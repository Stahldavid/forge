import { AgentFabricError } from "./errors.ts";
import type {
  AdapterManifest,
  AdapterOutcomeResult,
  AdapterStartResult,
  AgentAdapter,
  AttemptExecutionPermit,
  Digest,
  RuntimeObservation,
  WorkerResultReport,
} from "./types.ts";

export interface DeterministicAdapterFixture {
  effectiveRunSpecDigest: Digest;
  outcomeStatus: "succeeded" | "failed";
  resultDigest: Digest;
  evidenceDigests?: readonly Digest[];
}

interface AttemptRecord {
  permit: AttemptExecutionPermit;
  startedAt: number;
  cancelled: boolean;
}

export class DeterministicTestAdapter implements AgentAdapter {
  private readonly fixtures = new Map<Digest, DeterministicAdapterFixture>();
  private readonly attempts = new Map<string, AttemptRecord>();

  constructor(
    fixtures: readonly DeterministicAdapterFixture[],
    private readonly now: () => number,
  ) {
    for (const fixture of fixtures) this.fixtures.set(fixture.effectiveRunSpecDigest, fixture);
  }

  manifest(): AdapterManifest {
    return {
      adapterId: "forge-agent-fabric/deterministic-test-adapter",
      version: "0.1.0",
      capabilities: ["deterministic_fixture_execution", "observation", "cancellation"],
      supportsCancellation: true,
      supportsObservation: true,
    };
  }

  async startAttempt(permit: AttemptExecutionPermit): Promise<AdapterStartResult> {
    const existing = this.attempts.get(permit.attemptId);
    if (existing) {
      if (existing.permit.permitId !== permit.permitId) {
        throw new AgentFabricError(
          "AF_CONFLICT",
          `Attempt ${permit.attemptId} was started with a different permit`,
        );
      }
      return {
        status: "started",
        report: {
          startupReportId: `startup:${permit.attemptId}`,
          attemptId: permit.attemptId,
          observedSpecDigest: permit.effectiveRunSpecDigest,
          startedAt: existing.startedAt,
        },
      };
    }
    if (!this.fixtures.has(permit.effectiveRunSpecDigest)) {
      return { status: "unknown", reason: "fixture_not_found" };
    }
    const startedAt = this.now();
    this.attempts.set(permit.attemptId, { permit, startedAt, cancelled: false });
    return {
      status: "started",
      report: {
        startupReportId: `startup:${permit.attemptId}`,
        attemptId: permit.attemptId,
        observedSpecDigest: permit.effectiveRunSpecDigest,
        startedAt,
      },
    };
  }

  async observeAttempt(attemptId: string): Promise<readonly RuntimeObservation[]> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return [];
    return [
      {
        observationId: `observation:${attemptId}:adapter-state`,
        attemptId,
        sourceClass: "adapter_observation",
        claim: attempt.cancelled ? "cancelled" : "running_or_completed",
        observedAt: this.now(),
      },
    ];
  }

  async collectOutcome(attemptId: string): Promise<AdapterOutcomeResult> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return { status: "unknown", reason: "attempt_not_observed" };
    if (attempt.cancelled) return { status: "unknown", reason: "attempt_cancelled" };
    const fixture = this.fixtures.get(attempt.permit.effectiveRunSpecDigest);
    if (!fixture) return { status: "unknown", reason: "fixture_not_found" };
    const report: WorkerResultReport = {
      reportId: `report:${attemptId}`,
      attemptId,
      status: fixture.outcomeStatus,
      resultDigest: fixture.resultDigest,
      evidenceDigests: fixture.evidenceDigests ?? [],
      reportedAt: this.now(),
    };
    return { status: "reported", report };
  }

  async requestCancellation(attemptId: string): Promise<{ acknowledged: boolean }> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return { acknowledged: false };
    attempt.cancelled = true;
    return { acknowledged: true };
  }

  async observeTermination(attemptId: string): Promise<"terminated" | "running" | "unknown"> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return "unknown";
    return attempt.cancelled ? "terminated" : "running";
  }
}
