import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { digestCanonical, sha256Digest } from "./canonical.ts";
import type {
  AdapterManifest, AdapterOutcomeResult, AdapterStartResult, AgentAdapter,
  AttemptExecutionPermit, Clock, Digest, RuntimeObservation, WorkerResultReport,
} from "./types.ts";
import type { LocalAdaptiveRole } from "./local-adaptive-harness.ts";

const WORKER_PATH = fileURLToPath(new URL("./local-adaptive-digest-worker.mjs", import.meta.url));
const MAX_OUTPUT_BYTES = 512;
const MAX_WALL_MS = 1_000;

/** Runs one fixed digest worker. Node process isolation here is a bound on this
 * trusted worker program, not a sandbox for arbitrary user or model code. */
export class LocalAdaptiveProcessAdapter implements AgentAdapter {
  private child: ChildProcessWithoutNullStreams | undefined;
  private outcome: Promise<AdapterOutcomeResult> | undefined;
  private aborted = false;
  private timedOut = false;
  private oversized = false;
  private reportedPid: number | undefined;

  constructor(
    private readonly role: LocalAdaptiveRole,
    private readonly input: string,
    private readonly clock: Clock,
    private readonly signal?: AbortSignal,
  ) {}

  get pid(): number | undefined { return this.reportedPid; }

  manifest(): AdapterManifest {
    return { adapterId: "fabric.local.digest-process/v1", version: "1",
      capabilities: ["fabric.local.read"], supportsCancellation: true,
      supportsObservation: false };
  }

  async startAttempt(permit: AttemptExecutionPermit): Promise<AdapterStartResult> {
    if (this.child || this.outcome) return { status: "unknown", reason: "worker_already_started" };
    if (this.signal?.aborted) return { status: "unknown", reason: "cancelled_before_start" };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(process.execPath, [WORKER_PATH], {
        cwd: tmpdir(), env: {}, stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true, shell: false,
      });
    } catch {
      return { status: "unknown", reason: "worker_spawn_failed" };
    }
    this.child = child;
    let output = "";
    const deadline = setTimeout(() => {
      this.timedOut = true;
      child.kill();
    }, MAX_WALL_MS);
    const abort = () => {
      this.aborted = true;
      child.kill();
    };
    this.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdin.on("error", () => { /* Exit is handled by the close event. */ });
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output, "utf8") > MAX_OUTPUT_BYTES) {
        this.oversized = true;
        child.kill();
      }
    });
    // A worker may print diagnostics, but they are never surfaced as authority.
    child.stderr.resume();
    this.outcome = new Promise<AdapterOutcomeResult>((resolve) => {
      child.once("close", (code) => {
        clearTimeout(deadline);
        this.signal?.removeEventListener("abort", abort);
        if (this.aborted || this.timedOut || this.oversized) {
          resolve({ status: "unknown", reason: this.aborted ? "worker_cancelled" :
            this.timedOut ? "worker_timeout" : "worker_output_oversized" });
          return;
        }
        if (code !== 0) {
          resolve({ status: "reported", report: this.report(permit, "failed",
            digestCanonical({ role: this.role, failure: "worker_exit" }, sha256Digest)) });
          return;
        }
        let parsed: unknown;
        try { parsed = JSON.parse(output); } catch {
          resolve({ status: "unknown", reason: "worker_output_invalid" });
          return;
        }
        const value = parsed as Record<string, unknown>;
        const expected = digestCanonical({ role: this.role, input: this.input }, sha256Digest);
        if (!value || typeof value !== "object" || Array.isArray(value) ||
            Object.keys(value).sort().join(",") !== "pid,resultDigest,role" ||
            value.pid !== child.pid || value.role !== this.role || value.resultDigest !== expected) {
          resolve({ status: "unknown", reason: "worker_digest_mismatch" });
          return;
        }
        this.reportedPid = child.pid;
        resolve({ status: "reported", report: this.report(permit, "succeeded", expected) });
      });
    });
    const started = await new Promise<boolean>((resolve) => {
      child.once("spawn", () => resolve(true));
      child.once("error", () => resolve(false));
    });
    if (!started) {
      child.kill();
      return { status: "unknown", reason: "worker_spawn_failed" };
    }
    child.stdin.end(JSON.stringify({ role: this.role, input: this.input }));
    return { status: "started", report: {
      startupReportId: `startup:${permit.attemptId}`, attemptId: permit.attemptId,
      observedSpecDigest: permit.effectiveRunSpecDigest, startedAt: this.clock.now(),
    } };
  }

  async collectOutcome(_attemptId: string): Promise<AdapterOutcomeResult> {
    return this.outcome ?? { status: "unknown", reason: "worker_not_started" };
  }

  async observeAttempt(_attemptId: string): Promise<readonly RuntimeObservation[]> { return []; }

  async requestCancellation(_attemptId: string): Promise<{ acknowledged: boolean }> {
    this.aborted = true;
    return { acknowledged: this.child?.kill() ?? false };
  }

  async observeTermination(_attemptId: string): Promise<"terminated" | "running" | "unknown"> {
    if (!this.child) return "unknown";
    return this.child.exitCode === null ? "running" : "terminated";
  }

  private report(permit: AttemptExecutionPermit, status: "succeeded" | "failed", resultDigest: Digest): WorkerResultReport {
    return {
      reportId: `report:${permit.attemptId}`, attemptId: permit.attemptId,
      permitId: permit.permitId, intentId: permit.intentId,
      planRevisionId: permit.planRevisionId,
      effectiveRunSpecDigest: permit.effectiveRunSpecDigest,
      fencingToken: permit.fencingToken, status, resultDigest,
      evidenceDigests: [], reportedAt: this.clock.now(),
    };
  }
}
