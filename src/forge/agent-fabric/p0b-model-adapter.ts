import { generateText } from "ai";
import { resolveLanguageModel } from "../runtime/ai/providers.ts";
import type { ForgeAiProvider } from "../runtime/ai/types.ts";
import type { SecretsContext } from "../runtime/secrets/types.ts";
import { digestCanonical, sha256Digest, stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import { ForgeAgentConductor } from "./hardened-conductor.ts";
import { executeP0aActivity, type P0aActivityExecutionResult } from "./p0a.ts";
import type {
  AdapterOutcomeResult, AdapterStartResult, AgentAdapter, AttemptExecutionPermit,
  Digest, EffectiveRunSpec, ExecutionProfile, HarnessSpec, RuntimeObservation,
  WorkerResultReport,
} from "./types.ts";

/** P0b-A has no retrieval, tools, delegation, persistence, or user-selected endpoint. */
export interface ModelContextPack {
  schemaVersion: 1;
  sourceIds: readonly string[];
  content: string;
}

export interface MaterializedModelInvocation {
  schemaVersion: 1;
  provider: ForgeAiProvider;
  model: string;
  systemPrompt: string;
  prompt: string;
  contextPackDigest: Digest;
  maxOutputTokens: number;
  maximumRequestBytes: number;
  maximumResultBytes: number;
  outputMode: "text";
  purpose?: string;
  temperature?: number;
}

export interface ModelTarget {
  targetId: string;
  provider: ForgeAiProvider;
  allowedModels: readonly string[];
}

export interface ModelInvocationResult {
  text: string;
}

export type ModelExecutor = (
  invocation: Readonly<MaterializedModelInvocation>,
  context: Readonly<ModelContextPack>,
  signal: AbortSignal,
) => Promise<ModelInvocationResult>;

export interface P0bModelAdapterOptions {
  conductor: ForgeAgentConductor;
  now: () => number;
  resolveSpec: (digest: Digest) => EffectiveRunSpec | undefined;
  resolveContext: (digest: Digest) => ModelContextPack | undefined;
  resolveInvocation: (digest: Digest) => MaterializedModelInvocation | undefined;
  resolveTarget: (targetId: string) => ModelTarget | undefined;
  resolveHarness: (id: string) => HarnessSpec | undefined;
  resolveProfile: (id: string) => ExecutionProfile | undefined;
  executeModel: ModelExecutor;
}

export interface P0bBounds {
  maximumRequestBytes: number;
  maximumResultBytes: number;
  maximumOutputTokens: number;
  maximumWallClockMs: number;
}

export const P0B_MAXIMUM_BOUNDS: P0bBounds = Object.freeze({
  maximumRequestBytes: 64 * 1024,
  maximumResultBytes: 64 * 1024,
  maximumOutputTokens: 4096,
  maximumWallClockMs: 120_000,
});

function reject(reason: string): never {
  throw new AgentFabricError("AF_PERMIT_REJECTED", `P0b model preflight rejected: ${reason}`);
}

function exactKeys(value: object, required: readonly string[], optional: readonly string[] = []): void {
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      keys.some((key) => !required.includes(key) && !optional.includes(key))) {
    reject("unsupported or missing materialization field");
  }
}

function positiveBound(value: number, ceiling: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= ceiling;
}

function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function copyFrozen<T>(value: T): T {
  const copy = JSON.parse(stableStringify(value)) as T;
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}

interface PreparedAttempt {
  invocation: Readonly<MaterializedModelInvocation>;
  context: Readonly<ModelContextPack>;
  wallClockMs: number;
}

interface AttemptRecord {
  permit: AttemptExecutionPermit;
  startedAt: number;
  controller: AbortController;
  cancelled: boolean;
  settled: Promise<AdapterOutcomeResult>;
}

/** The transport is injected only by trusted setup, never by model materialization. */
export function createForgeModelExecutor(
  secrets: SecretsContext,
  onPhysicalRequest?: () => void,
  trustedTransport: typeof fetch = fetch,
): ModelExecutor {
  return async (invocation, context, signal) => {
    let requests = 0;
    const transport = Object.assign(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests += 1;
      if (requests !== 1) throw new Error("p0b_duplicate_physical_request");
      onPhysicalRequest?.();
      // Native fetch follows 3xx by default, which would hide extra requests and hosts.
      return trustedTransport(input, { ...init, redirect: "manual" });
    }, { preconnect: fetch.preconnect });
    const model = await resolveLanguageModel(
      invocation.provider, invocation.model, secrets, transport,
    );
    const result = await generateText({
      model,
      system: invocation.systemPrompt,
      prompt: `${context.content}\n\n${invocation.prompt}`,
      maxOutputTokens: invocation.maxOutputTokens,
      temperature: invocation.temperature,
      maxRetries: 0,
      abortSignal: signal,
    });
    return { text: result.text };
  };
}

export class P0bModelAdapter implements AgentAdapter {
  private readonly attempts = new Map<string, AttemptRecord>();
  private readonly resultArtifacts = new Map<string, string>();

  constructor(private readonly options: P0bModelAdapterOptions) {}

  isBoundTo(conductor: ForgeAgentConductor): boolean {
    return conductor === this.options.conductor;
  }

  /** Ephemeral complete text artifact; its digest is the report's resultDigest. */
  resultArtifact(attemptId: string): string | undefined {
    return this.resultArtifacts.get(attemptId);
  }

  manifest() {
    return {
      adapterId: "forge-agent-fabric/p0b-model-adapter",
      version: "0.1.0",
      capabilities: ["bounded_external_inference", "observation", "cancellation"],
      supportsCancellation: true,
      supportsObservation: true,
    };
  }

  /** Deterministic preflight. Call before executeP0aActivity so rejection is not uncertainty. */
  preflight(permit: AttemptExecutionPermit): PreparedAttempt {
    this.options.conductor.authorizeAttemptDispatch(permit);
    const state = this.options.conductor.state();
    const intent = own(state.dispatchIntents, permit.intentId);
    const grant = own(state.grants, permit.grantId);
    const revision = intent && own(state.planRevisions, intent.planRevisionId);
    const goal = revision && own(state.goals, revision.goalId);
    const authorization = grant && own(state.authorizations, grant.rootAuthorizationId);
    if (!intent || !grant || !revision || !goal || !authorization ||
        intent.effectClass !== "bounded_external_inference" ||
        !goal.allowedEffectClasses.includes(intent.effectClass) ||
        goal.prohibitedEffectClasses.includes(intent.effectClass) ||
        !authorization.effectClasses.includes(intent.effectClass) ||
        !grant.effectClasses.includes(intent.effectClass) ||
        !authorization.targetIds.includes(intent.targetId) ||
        !grant.targetIds.includes(intent.targetId) ||
        !intent.sourceIds.every((id) => goal.sourceBoundary.sourceIds.includes(id) &&
          authorization.sourceIds.includes(id) && grant.sourceIds.includes(id))) {
      reject("effect, source, target, or authority mismatch");
    }

    const spec = this.options.resolveSpec(permit.effectiveRunSpecDigest);
    if (!spec || digestCanonical(spec, sha256Digest) !== permit.effectiveRunSpecDigest ||
        spec.rootExecutionId !== intent.rootExecutionId ||
        spec.goalId !== goal.goalId ||
        spec.planRevisionId !== intent.planRevisionId ||
        spec.nodeId !== intent.taskNodeId) {
      reject("effective run spec mismatch");
    }
    const node = revision.nodes.find((candidate) => candidate.nodeId === spec.nodeId);
    if (!node || node.kind !== "activity" || node.agentSpecId !== spec.agentSpecId ||
        node.harnessSpecId !== spec.harnessSpecId ||
        node.executionProfileId !== spec.executionProfileId) {
      reject("workflow node mismatch");
    }
    const context = this.options.resolveContext(spec.contextPackDigest);
    if (!context || digestCanonical(context, sha256Digest) !== spec.contextPackDigest) {
      reject("context pack digest mismatch");
    }
    exactKeys(context, ["schemaVersion", "sourceIds", "content"]);
    if (context.schemaVersion !== 1 || !Array.isArray(context.sourceIds) ||
        typeof context.content !== "string" ||
        !context.sourceIds.every((id) => typeof id === "string" && intent.sourceIds.includes(id))) {
      reject("context source mismatch");
    }
    const invocation = this.options.resolveInvocation(spec.materializationDigest);
    if (!invocation || digestCanonical(invocation, sha256Digest) !== spec.materializationDigest) {
      reject("model materialization digest mismatch");
    }
    exactKeys(invocation, [
      "schemaVersion", "provider", "model", "systemPrompt", "prompt", "contextPackDigest",
      "maxOutputTokens", "maximumRequestBytes", "maximumResultBytes", "outputMode",
    ], ["purpose", "temperature"]);
    const target = this.options.resolveTarget(intent.targetId);
    if (!target || target.targetId !== intent.targetId ||
        !Array.isArray(target.allowedModels) || target.allowedModels.length === 0 ||
        target.allowedModels.length > 16 ||
        !target.allowedModels.every((model) => typeof model === "string" && model.length > 0) ||
        !["openai", "anthropic", "gateway"].includes(invocation.provider) ||
        typeof invocation.model !== "string" || invocation.model.length === 0 ||
        !target.allowedModels.includes(invocation.model) ||
        target.provider !== invocation.provider ||
        invocation.contextPackDigest !== spec.contextPackDigest ||
        invocation.schemaVersion !== 1 || invocation.outputMode !== "text" ||
        typeof invocation.systemPrompt !== "string" || typeof invocation.prompt !== "string" ||
        (invocation.temperature !== undefined &&
          (!Number.isFinite(invocation.temperature) || invocation.temperature < 0 || invocation.temperature > 2))) {
      reject("provider, model, or invocation mismatch");
    }
    const harness = this.options.resolveHarness(spec.harnessSpecId);
    const profile = this.options.resolveProfile(spec.executionProfileId);
    if (!harness || harness.harnessSpecId !== spec.harnessSpecId ||
        harness.toolIds.length !== 0 || harness.pluginIds.length !== 0 ||
        harness.delegationPolicy !== "none" || harness.memoryMode !== "none" ||
        !profile || profile.executionProfileId !== spec.executionProfileId ||
        profile.network !== "provider_only" || profile.filesystem !== "read_only" ||
        profile.durability !== "ephemeral") {
      reject("harness or execution profile outside P0b-A");
    }
    if (!positiveBound(invocation.maxOutputTokens, P0B_MAXIMUM_BOUNDS.maximumOutputTokens) ||
        !positiveBound(invocation.maximumRequestBytes, P0B_MAXIMUM_BOUNDS.maximumRequestBytes) ||
        !positiveBound(invocation.maximumResultBytes, P0B_MAXIMUM_BOUNDS.maximumResultBytes) ||
        !positiveBound(profile.maximumWallClockMs, P0B_MAXIMUM_BOUNDS.maximumWallClockMs) ||
        Buffer.byteLength(stableStringify({ invocation, context }), "utf8") >
          invocation.maximumRequestBytes) {
      reject("request, output, result, or wall-clock bound exceeded");
    }
    if (profile.maximumWallClockMs > permit.expiresAt - this.options.now()) {
      reject("permit expires before wall-clock bound");
    }
    // Resolver callbacks are synchronous but may observe a changed authority state.
    this.options.conductor.authorizeAttemptDispatch(permit);
    return {
      invocation: copyFrozen(invocation),
      context: copyFrozen(context),
      wallClockMs: profile.maximumWallClockMs,
    };
  }

  async startAttempt(permit: AttemptExecutionPermit): Promise<AdapterStartResult> {
    const existing = this.attempts.get(permit.attemptId);
    if (existing) {
      if (stableStringify(existing.permit) !== stableStringify(permit)) {
        throw new AgentFabricError("AF_CONFLICT", "Attempt was started with a different permit");
      }
      return this.startReport(existing);
    }
    const prepared = this.preflight(permit);
    const startedAt = this.options.now();
    const controller = new AbortController();
    const record: AttemptRecord = {
      permit: copyFrozen(permit), startedAt, controller, cancelled: false,
      settled: Promise.resolve({ status: "unknown", reason: "not_started" }),
    };
    this.attempts.set(permit.attemptId, record);
    record.settled = this.run(record, prepared);
    return this.startReport(record);
  }

  private startReport(record: AttemptRecord): AdapterStartResult {
    return { status: "started", report: {
      startupReportId: `startup:${record.permit.attemptId}`,
      attemptId: record.permit.attemptId,
      observedSpecDigest: record.permit.effectiveRunSpecDigest,
      startedAt: record.startedAt,
    } };
  }

  private async run(record: AttemptRecord, prepared: PreparedAttempt): Promise<AdapterOutcomeResult> {
    const { permit, controller } = record;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rejectTimeout) => {
      timer = setTimeout(() => {
        controller.abort();
        rejectTimeout(new Error("provider_timeout"));
      }, prepared.wallClockMs);
    });
    try {
      this.options.conductor.authorizeAttemptDispatch(permit);
      const result = await Promise.race([
        this.options.executeModel(prepared.invocation, prepared.context, controller.signal), timeout,
      ]);
      if (record.cancelled || controller.signal.aborted ||
          this.options.now() >= permit.expiresAt) {
        return { status: "unknown", reason: "late_or_cancelled_provider_result" };
      }
      if (!result || typeof result.text !== "string" ||
          Buffer.byteLength(result.text, "utf8") > prepared.invocation.maximumResultBytes) {
        return { status: "unknown", reason: "invalid_or_oversized_provider_result" };
      }
      this.resultArtifacts.set(permit.attemptId, result.text);
      const report: WorkerResultReport = {
        reportId: `report:${permit.attemptId}`,
        attemptId: permit.attemptId,
        permitId: permit.permitId,
        intentId: permit.intentId,
        planRevisionId: permit.planRevisionId,
        effectiveRunSpecDigest: permit.effectiveRunSpecDigest,
        fencingToken: permit.fencingToken,
        status: "succeeded",
        resultDigest: sha256Digest(result.text),
        evidenceDigests: [digestCanonical({
          provider: prepared.invocation.provider,
          model: prepared.invocation.model,
          materializationDigest: digestCanonical(prepared.invocation, sha256Digest),
          contextPackDigest: prepared.invocation.contextPackDigest,
          resultDigest: sha256Digest(result.text),
        }, sha256Digest)],
        reportedAt: this.options.now(),
      };
      return { status: "reported", report };
    } catch {
      // Provider errors may occur before or after remote acceptance. Neither is proof of failure.
      return { status: "unknown", reason: "provider_dispatch_or_transport_unknown" };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async observeAttempt(attemptId: string): Promise<readonly RuntimeObservation[]> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return [];
    return [{
      observationId: `observation:${attemptId}:adapter-state`,
      attemptId,
      sourceClass: "adapter_observation",
      claim: attempt.cancelled ? "cancellation_requested" : "started_or_settled",
      observedAt: this.options.now(),
    }];
  }

  async collectOutcome(attemptId: string): Promise<AdapterOutcomeResult> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return { status: "unknown", reason: "attempt_not_observed" };
    const result = await attempt.settled;
    return attempt.cancelled
      ? { status: "unknown", reason: "cancellation_termination_unproven" }
      : result;
  }

  async requestCancellation(attemptId: string): Promise<{ acknowledged: boolean }> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return { acknowledged: false };
    attempt.cancelled = true;
    attempt.controller.abort();
    return { acknowledged: true };
  }

  async observeTermination(_attemptId: string): Promise<"terminated" | "running" | "unknown"> {
    // Abort acknowledgement cannot prove remote termination.
    return "unknown";
  }
}

export async function executeP0bActivity(input: {
  conductor: ForgeAgentConductor;
  adapter: P0bModelAdapter;
  permit: AttemptExecutionPermit;
}): Promise<P0aActivityExecutionResult> {
  if (!input.adapter.isBoundTo(input.conductor)) reject("adapter/conductor mismatch");
  input.adapter.preflight(input.permit);
  return executeP0aActivity(input);
}
