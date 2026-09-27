/** Opt-in live evidence for P0b-A. Requires OPENAI_API_KEY and FORGE_P0B_SMOKE_MODEL. */
import { execFileSync } from "node:child_process";
import {
  ForgeAgentConductor, MemoryControlJournal, P0bModelAdapter,
  createForgeModelExecutor, createRunPlanRevision, digestCanonical,
  executeP0bActivity, replayControlState, sha256Digest, stableStringify,
  type OwnerAuthorizationVerifier,
} from "../src/forge/agent-fabric/index.ts";

function requireValue(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the opt-in live smoke`);
  return value;
}

async function main(): Promise<void> {
  const model = requireValue("FORGE_P0B_SMOKE_MODEL");
  requireValue("OPENAI_API_KEY");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const now = Date.now();
  const verifier: OwnerAuthorizationVerifier = {
    verify(_authorization, authorizationDigest) {
      return { verifierId: "p0b-live-smoke/v1", authorizationDigest,
        evidenceDigest: sha256Digest("local-operator-authorized-smoke") };
    },
    verifyRecorded(_authorization, evidence) {
      return evidence.verifierId === "p0b-live-smoke/v1" &&
        evidence.evidenceDigest === sha256Digest("local-operator-authorized-smoke");
    },
  };
  const journal = new MemoryControlJournal();
  const conductor = new ForgeAgentConductor(
    "run:p0b-live", journal, { now: Date.now }, sha256Digest, verifier,
  );
  const targetId = `target:openai:${model}`;
  conductor.registerOwnerAuthorization({
    authorizationId: "auth:p0b-live", principalId: "owner:local-operator",
    rootExecutionId: "run:p0b-live", goalIds: ["goal:p0b-live"],
    subjectIds: ["worker:p0b-live"], capabilities: ["model.invoke"],
    sourceIds: ["source:p0b-smoke"], targetIds: [targetId],
    effectClasses: ["bounded_external_inference"], notBefore: now - 1000,
    expiresAt: now + 90_000, maximumAttempts: 1, maximumDelegationDepth: 0,
    resourceCeilings: {},
  });
  conductor.registerGoal({
    goalId: "goal:p0b-live", revision: 1, authorityInvocationId: "auth:p0b-live",
    objectives: ["capture one model text result"], nonObjectives: ["run tools", "accept a goal"],
    acceptanceCriteria: ["structural result reviewed"],
    allowedEffectClasses: ["bounded_external_inference"],
    prohibitedEffectClasses: ["consequential"],
    sourceBoundary: { sourceIds: ["source:p0b-smoke"], allowExpansion: false },
  });
  const harness = {
    harnessSpecId: "harness:p0b-live", systemPromptLayers: [], toolIds: [], pluginIds: [],
    memoryMode: "none" as const, delegationPolicy: "none" as const,
  };
  const profile = {
    executionProfileId: "profile:p0b-live", isolation: "process" as const,
    network: "provider_only" as const, filesystem: "read_only" as const,
    durability: "ephemeral" as const, maximumWallClockMs: 30_000,
  };
  const revision = createRunPlanRevision("run:p0b-live", "goal:p0b-live", {
    programId: "program:p0b-live", version: 1,
    nodes: [{ nodeId: "node:p0b-live", kind: "activity", dependsOn: [],
      agentSpecId: "agent:p0b-live", harnessSpecId: harness.harnessSpecId,
      executionProfileId: profile.executionProfileId }],
  }, "plan:p0b-live", sha256Digest);
  conductor.activatePlan(revision, null);
  conductor.registerGrant({
    grantId: "grant:p0b-live", rootAuthorizationId: "auth:p0b-live",
    subjectId: "worker:p0b-live", parentGrantId: null,
    capabilities: ["model.invoke"], sourceIds: ["source:p0b-smoke"],
    targetIds: [targetId], effectClasses: ["bounded_external_inference"],
    notBefore: now - 1000, expiresAt: now + 90_000,
    maximumAttempts: 1, delegationDepthRemaining: 0, resourceCeilings: {},
  });
  const context = {
    schemaVersion: 1 as const, sourceIds: ["source:p0b-smoke"],
    content: "Smoke context: the answer has no authority to run actions.",
  };
  const contextPackDigest = digestCanonical(context, sha256Digest);
  const invocation = {
    schemaVersion: 1 as const, provider: "openai" as const, model,
    systemPrompt: "Return one short text sentence. Do not call tools.",
    prompt: "Acknowledge the smoke context in a short sentence.",
    contextPackDigest, maxOutputTokens: 64, maximumRequestBytes: 2048,
    maximumResultBytes: 2048, outputMode: "text" as const,
  };
  const materializationDigest = digestCanonical(invocation, sha256Digest);
  const spec = {
    effectiveRunSpecId: "spec:p0b-live", rootExecutionId: "run:p0b-live",
    goalId: "goal:p0b-live", planRevisionId: revision.revisionId,
    nodeId: "node:p0b-live", agentSpecId: "agent:p0b-live",
    harnessSpecId: harness.harnessSpecId, executionProfileId: profile.executionProfileId,
    contextPackDigest, materializationDigest,
  };
  const effectiveRunSpecDigest = digestCanonical(spec, sha256Digest);
  conductor.commitDispatchIntent({
    intentId: "intent:p0b-live", rootExecutionId: "run:p0b-live",
    planRevisionId: revision.revisionId, taskNodeId: "node:p0b-live",
    effectiveRunSpecDigest, sourceIds: ["source:p0b-smoke"], targetId,
    requiredCapability: "model.invoke", effectClass: "bounded_external_inference",
    createdAt: Date.now(),
  });
  const claim = conductor.claimDispatch({
    claimId: "claim:p0b-live", intentId: "intent:p0b-live",
    workerId: "worker:p0b-live", attemptId: "attempt:p0b-live",
    leaseDurationMs: 80_000,
  });
  const permit = conductor.issuePermit({
    permitId: "permit:p0b-live", claimId: claim.claimId,
    grantId: "grant:p0b-live", maximumValidityMs: 60_000,
  });
  let physicalRequests = 0;
  const secrets = {
    optional(name: string) {
      return name === "OPENAI_API_KEY" ? process.env.OPENAI_API_KEY : undefined;
    },
    get(name: string) {
      const value = this.optional(name);
      if (!value) throw new Error("Required provider credential is absent");
      return value;
    },
    has(name: string) { return Boolean(this.optional(name)); },
  };
  const adapter = new P0bModelAdapter({
    conductor, now: Date.now,
    resolveSpec: () => spec, resolveContext: () => context,
    resolveInvocation: () => invocation,
    resolveTarget: () => ({ targetId, provider: "openai", allowedModels: [model] }),
    resolveHarness: () => harness, resolveProfile: () => profile,
    executeModel: createForgeModelExecutor(secrets, () => { physicalRequests += 1; }),
  });
  const outcome = await executeP0bActivity({ conductor, adapter, permit });
  const artifact = adapter.resultArtifact(permit.attemptId);
  const replay = replayControlState(journal.readAll(), { ownerAuthorizationVerifier: verifier });
  if (outcome.status !== "succeeded" || physicalRequests !== 1 || !artifact ||
      outcome.resultDigest !== sha256Digest(artifact) ||
      stableStringify(replay) !== stableStringify(conductor.state())) {
    throw new Error(`P0b live smoke failed structurally: status=${outcome.status}, physicalRequests=${physicalRequests}`);
  }
  process.stdout.write(`${JSON.stringify({
    status: "passed", head, environment: "local-windows", provider: "openai", model,
    targetId, effectClass: "bounded_external_inference", contextPackDigest,
    materializationDigest, effectiveRunSpecDigest, permitId: permit.permitId,
    attemptId: permit.attemptId, physicalRequests, resultDigest: outcome.resultDigest,
    replayWithoutProviderCallback: true,
  })}\n`);
}

main().catch((error: unknown) => {
  // Do not print provider errors: they can contain request headers or secret-bearing payloads.
  process.stderr.write(`P0b live smoke unavailable or failed: ${error instanceof Error ? error.name : "unknown"}\n`);
  process.exitCode = 1;
});
