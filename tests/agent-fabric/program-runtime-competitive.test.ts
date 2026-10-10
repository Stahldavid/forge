import { describe, test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProgramActivityScheduler } from "../../src/forge/agent-fabric/program-scheduler.ts";
import { recordProgramObservation, summarizeProgramUsage, programResourceLiability } from "../../src/forge/agent-fabric/program-observation.ts";
import { ProgramRunService } from "../../src/forge/agent-fabric/program-service.ts";
import { ProgramRunStore } from "../../src/forge/agent-fabric/program-store.ts";
import { programDigest, type ProgramAttempt, type ProgramRegistry, type ProgramRunV2, type WorkflowProgramV2 } from "../../src/forge/agent-fabric/program-contract.ts";
import type { ProgramWorkerAdapter } from "../../src/forge/agent-fabric/program-worker.ts";
import { schemaRef, policyRef, acceptanceRef, executorRef, populationRef, recipeRef, defineWorkflow, map, repair, compose, gate, output, outputCandidate, acceptedCandidate, acceptedCandidates, coverageReceipt, population, coverageFor, item, field, candidateFromBaseline } from "../../src/forge/agent-fabric/program-dsl.ts";

const ref = (id: string) => ({ id, version: "v1" });
function registry(): ProgramRegistry {
  return { schemas: { "any@v1": {} }, executors: { "read@v1": { ...ref("read"), kind: "command", effect: "read", role: "investigator", argv: [process.execPath], timeoutMs: 10000, writeScope: [], network: "host", isolation: "cooperative", schema: ref("any") } },
    policies: { "local@v1": { ...ref("local"), maxItems: 10, concurrency: 3, maxAttempts: 10, maxOperations: 20, maxDepth: 5, deadlineMs: 30000, maxOutputBytes: 100000, writeScope: [], executors: ["read@v1"], allowNetwork: true, allowCooperativeCommands: true } },
    acceptance: { "goal@v1": { ...ref("goal"), criteria: ["complete"], writeScope: [], requiredChecks: [], requireReview: false, allowNoWork: true } }, populations: {} };
}
function workflow(count = 1): WorkflowProgramV2 {
  return { schemaVersion: 2, operatorVersion: 2, mode: "data", id: "observe", version: 1, inputSchema: ref("any"), outputSchema: ref("any"), policy: ref("local"), acceptance: ref("goal"), steps: Array.from({ length: count }, (_, index) => ({ id: `read${index}`, kind: "agent", options: { executor: ref("read"), input: {} } })), result: { $expr: "output", args: [`read${count - 1}`] } };
}
async function finish(service: ProgramRunService, runId: string): Promise<ProgramRunV2> {
  for (let count = 0; count < 300; count++) { const state = await service.execute("program-status", { runId }) as ProgramRunV2; if (state.status !== "executing") return state; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error("Deterministic fixture stalled");
}
describe("competitive runtime guarantees", () => {
  test("three eligible runs rotate instead of starving the third", async () => {
    const scheduler = new ProgramActivityScheduler(1), signal = new AbortController().signal;
    const release = await scheduler.acquire("hold", 1, [], signal), order: string[] = [];
    const tickets = ["a", "a", "a", "b", "b", "b", "c", "c", "c"].map(run => scheduler.acquire(run, 1, [], signal).then(done => { order.push(run); done(); }));
    release(); await Promise.all(tickets); expect(order).toEqual(["a", "b", "c", "a", "b", "c", "a", "b", "c"]);
    expect(scheduler.snapshot().active).toBe(0);
  });
  test("observations deduplicate, cumulative usage does not double count and uncertainty retains liability", () => {
    const attempt = { attemptId: "a", operationId: "o", generation: 1, inputDigest: "i", executorDigest: "e", startedAt: new Date().toISOString(), outcome: "running", resourceReservation: { tokens: 100, status: "held" } } as ProgramAttempt;
    const observation = { id: "one", type: "usage", source: "sdk", at: new Date().toISOString(), semantics: "cumulative" as const, usage: { input_tokens: 20, output_tokens: 5 } };
    recordProgramObservation(attempt, observation); recordProgramObservation(attempt, observation);
    recordProgramObservation(attempt, { ...observation, id: "two", usage: { input_tokens: 30, output_tokens: 10 } });
    expect(summarizeProgramUsage(attempt).totalTokens).toBe(40); expect(programResourceLiability(attempt)).toBe(100);
    expect(() => recordProgramObservation(attempt, { ...observation, usage: { input_tokens: 200, output_tokens: 5 } })).toThrow("identity changed");
    attempt.resourceReservation!.status = "released"; expect(programResourceLiability(attempt)).toBe(40);
    expect(() => recordProgramObservation(attempt, { ...observation, id: "mixed", semantics: "incremental" })).toThrow("mixes cumulative");
    expect(attempt.observations?.mixed).toBeUndefined();
    expect(() => recordProgramObservation(attempt, { ...observation, id: "missing", usage: { input_tokens: 2 } as typeof observation.usage })).toThrow("input/output counters");
    expect(() => recordProgramObservation(attempt, { ...observation, id: "cached", usage: { input_tokens: 2, cached_input_tokens: 3, output_tokens: 0 } })).toThrow("cached usage");
  });
  test("invalid output retains observed usage across owner restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-runtime-")); let service: ProgramRunService | undefined;
    try {
      const catalog = registry(); const adapter: ProgramWorkerAdapter = async input => ({ directory: root, inputDigest: "fixture", async execute() {
        const observation = { id: "usage", type: "usage", source: "fixture", at: new Date().toISOString(), usage: { input_tokens: 20, output_tokens: 5 } };
        await input.onObservation?.(observation); await input.onObservation?.(observation); return { outcome: "invalid_output", reason: "bad schema" };
      } });
      service = await ProgramRunService.open(root, catalog, adapter, { ownerCapacity: 2 });
      const started = await service.execute("program-start", { requestId: "usage", program: workflow(), input: {} }) as ProgramRunV2;
      const state = await finish(service, started.runId); const attempt = Object.values(state.attempts)[0];
      expect(attempt.outcome).toBe("invalid_output"); expect(attempt.usageSummary?.totalTokens).toBe(25);
      await service.close(); service = await ProgramRunService.open(root, catalog, adapter);
      expect(Object.values((await service.execute("program-status", { runId: state.runId }) as ProgramRunV2).attempts)[0].usageSummary?.totalTokens).toBe(25);
    } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
  });
  test("admission reserves final checks, stops before overspend and retains unknown consumption", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-budget-")); let service: ProgramRunService | undefined;
    try {
      const catalog = registry(); catalog.policies["local@v1"].resources = { maxTokens: 100, reserveTokensPerAttempt: 60, finalReserveTokens: 20, unknownUsage: "allow" };
      let dispatches = 0; const adapter: ProgramWorkerAdapter = async () => ({ directory: root, inputDigest: "fixture", async execute() { dispatches++; return { outcome: "completed", data: {} }; } });
      service = await ProgramRunService.open(root, catalog, adapter, { ownerMaxTokens: 100 });
      const started = await service.execute("program-start", { requestId: "budget", program: workflow(2), input: {} }) as ProgramRunV2;
      const state = await finish(service, started.runId); expect(dispatches).toBe(1); expect(state.status).toBe("needs-attention");
      expect(programResourceLiability(Object.values(state.attempts)[0])).toBe(60);
      await service.close(); service = await ProgramRunService.open(root, catalog, adapter, { ownerMaxTokens: 100 });
      const explanation = await service.execute("program-explain", { runId: state.runId }) as { resources: { liabilityTokens: number } }; expect(explanation.resources.liabilityTokens).toBe(60);
    } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
  });
  test("immutable dedup avoids repeat writes and still rejects corrupt content", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-store-"));
    try { const store = await ProgramRunStore.open(root), value = { ok: true }; await store.put(value); const written = store.metrics.bytesWritten; await store.put(value); expect(store.metrics.bytesWritten).toBe(written); expect(store.metrics.deduplicatedWrites).toBe(1); await writeFile(join(store.directory, "artifacts", `${programDigest(value).slice(7)}.json`), "{}"); await expect(store.put(value)).rejects.toThrow("corrupted"); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  test("final reserve cannot be bypassed by activity input and exempt checks do not invent usage", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-final-budget-")); let service: ProgramRunService | undefined;
    try {
      const catalog = registry(); catalog.policies["local@v1"].resources = { maxTokens: 70, reserveTokensPerAttempt: 60, finalReserveTokens: 20, unknownUsage: "block" };
      let dispatches = 0; const adapter: ProgramWorkerAdapter = async () => ({ directory: root, inputDigest: "fixture", async execute() { dispatches++; return { outcome: "completed", data: {} }; } });
      service = await ProgramRunService.open(root, catalog, adapter);
      const forged = workflow(); forged.steps[0].options.input = { assessmentContext: { phase: "final" } };
      const started = await service.execute("program-start", { requestId: "forged", program: forged, input: {} }) as ProgramRunV2;
      expect((await finish(service, started.runId)).status).toBe("needs-attention"); expect(dispatches).toBe(0);
      await service.close(); catalog.executors["read@v1"].tokenAccounting = "none";
      service = await ProgramRunService.open(root, catalog, adapter);
      const checks = await service.execute("program-start", { requestId: "checks", program: workflow(2), input: {} }) as ProgramRunV2;
      const state = await finish(service, checks.runId); expect(state.status).toBe("completed");
      expect(Object.values(state.attempts).every(attempt => summarizeProgramUsage(attempt).certainty === "not-applicable" && programResourceLiability(attempt) === 0)).toBe(true);
    } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
  });
  test("thread recovery requires explicit termination evidence and passes compatible original workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-recovery-")); let service: ProgramRunService | undefined;
    try {
      let dispatches = 0; const digest = programDigest({ workspace: "observed" });
      const adapter: ProgramWorkerAdapter = async input => ({ directory: root, inputDigest: "fixture", recovery: { directory: root, inputDigest: "inventory", workspaceDigest: digest }, async execute() {
        dispatches++; if (dispatches === 1) { await input.onThread("thread-fixture"); return { outcome: "uncertain", reason: "termination unknown" }; }
        expect(input.recovery).toMatchObject({ threadId: "thread-fixture", directory: root, workspaceDigest: digest, terminationObserved: true, generationCompatible: true });
        if (dispatches === 2) return { outcome: "uncertain", reason: "resumed SDK emitted no thread.started before interruption" };
        return { outcome: "completed", data: {} };
      } });
      service = await ProgramRunService.open(root, registry(), adapter);
      const started = await service.execute("program-start", { requestId: "recover", program: workflow(), input: {} }) as ProgramRunV2;
      let state = await finish(service, started.runId); const attemptId = Object.keys(state.attempts)[0];
      await expect(service.execute("program-reconcile", { runId: state.runId, requestId: "bad-evidence", expectedVersion: state.version, attemptId, resolution: "failed", reason: "observed", resumeThread: true, observation: { terminated: false, workspaceDigest: digest } })).rejects.toThrow("observed termination");
      state = await service.execute("program-reconcile", { runId: state.runId, requestId: "good-evidence", expectedVersion: state.version, attemptId, resolution: "failed", reason: "process ended and files inspected", resumeThread: true, observation: { terminated: true, workspaceDigest: digest } }) as ProgramRunV2;
      await service.execute("program-resume", { runId: state.runId, requestId: "resume", expectedVersion: state.version });
      state = await finish(service, state.runId); const second = Object.values(state.attempts).find(attempt => attempt.attemptId !== attemptId)!;
      expect(second.threadId).toBe("thread-fixture");
      state = await service.execute("program-reconcile", { runId: state.runId, requestId: "good-second-evidence", expectedVersion: state.version, attemptId: second.attemptId, resolution: "failed", reason: "resumed process ended and files inspected", resumeThread: true, observation: { terminated: true, workspaceDigest: digest } }) as ProgramRunV2;
      await service.execute("program-resume", { runId: state.runId, requestId: "resume-second", expectedVersion: state.version });
      expect((await finish(service, state.runId)).status).toBe("completed"); expect(dispatches).toBe(3);
    } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
  });
  test("trusted capacity decrease preserves active work and applied usage reconciliation preserves publication", async () => {
    const scheduler = new ProgramActivityScheduler(2), signal = new AbortController().signal;
    const first = await scheduler.acquire("a", 2, [], signal), second = await scheduler.acquire("b", 2, [], signal);
    scheduler.setOwnerCapacity(1); let admitted = false;
    const queued = scheduler.acquire("c", 2, [], signal).then(release => { admitted = true; return release; });
    first(); await Promise.resolve(); expect(admitted).toBe(false); expect(scheduler.snapshot().active).toBe(1);
    second(); const third = await queued; expect(admitted).toBe(true); third();
    const root = await mkdtemp(join(tmpdir(), "forge-runtime-review-")); let service: ProgramRunService | undefined;
    try {
      const adapter: ProgramWorkerAdapter = async () => ({ directory: root, inputDigest: "fixture", async execute() { return { outcome: "completed", data: {} }; } });
      service = await ProgramRunService.open(root, registry(), adapter, { ownerCapacity: 2 });
      await service.updateRuntimeOptions({ ownerCapacity: 1 });
      const started = await service.execute("program-start", { requestId: "terminal-usage", program: workflow(), input: {} }) as ProgramRunV2;
      let state = await finish(service, started.runId); const attemptId = Object.keys(state.attempts)[0];
      // Seed the terminal publication state: this check exercises accounting-only reconciliation,
      // not filesystem apply, which has separate coverage.
      state = await service.store.transact(state.runId, "fixture-publication", current => { current!.status = "applied"; current!.gateRef = programDigest({ frozen: "gate" }); return current!; });
      const gateRef = state.gateRef;
      state = await service.execute("program-reconcile", { runId: state.runId, requestId: "observed-terminal-usage", expectedVersion: state.version, attemptId, resolution: "usage", reason: "provider billing evidence", authorization: "owner-fixture", usage: { input_tokens: 8, output_tokens: 2 } }) as ProgramRunV2;
      expect(state.status).toBe("applied"); expect(state.gateRef).toBe(gateRef); expect(summarizeProgramUsage(state.attempts[attemptId]).totalTokens).toBe(10);
      await expect(service.execute("program-resume", { runId: state.runId, requestId: "forbidden-resume", expectedVersion: state.version })).rejects.toThrow("Terminal runs");
      expect((await service.execute("program-explain", { runId: state.runId }) as { scheduler: { ownerLimit: number } }).scheduler.ownerLimit).toBe(1);
    } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
  });
  test("concurrent runs preserve each other's final reserves before dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-owner-budget-")); let service: ProgramRunService | undefined;
    try {
      const catalog = registry(); catalog.policies["local@v1"].resources = { maxTokens: 100, reserveTokensPerAttempt: 60, finalReserveTokens: 20, unknownUsage: "allow" };
      let dispatches = 0; const adapter: ProgramWorkerAdapter = async () => ({ directory: root, inputDigest: "fixture", async execute() { dispatches++; await new Promise(resolve => setTimeout(resolve, 15)); return { outcome: "completed", data: {} }; } });
      service = await ProgramRunService.open(root, catalog, adapter, { ownerMaxTokens: 100 });
      const runs = await Promise.all(["owner-a", "owner-b"].map(requestId => service!.execute("program-start", { requestId, program: workflow(), input: {} }) as Promise<ProgramRunV2>));
      const states = await Promise.all(runs.map(run => finish(service!, run.runId))); expect(dispatches).toBe(1); expect(states.map(state => state.status).sort()).toEqual(["completed", "needs-attention"]);
    } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
  });
  test("closed population conflict resolution requires fresh final review and item checks on the resolved candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-compose-resolution-")); let service: ProgramRunService | undefined;
    try {
      const catalog = registry();
      catalog.policies["local@v1"].writeScope = ["src"]; catalog.policies["local@v1"].maxOperations = 100; catalog.policies["local@v1"].maxAttempts = 50;
      catalog.acceptance["goal@v1"] = { ...catalog.acceptance["goal@v1"], writeScope: ["src"], requireReview: true, requiredChecksByScope: { item: ["check@v1"], final: ["finalcheck@v1"] }, assessmentBindings: { fix: "item", integration: "final" }, obligations: [{ id: "correct", scope: "item", criteria: ["correct"] }] };
      for (const id of ["implement", "resolver", "review", "check", "finalcheck"]) catalog.executors[`${id}@v1`] = { ...catalog.executors["read@v1"], id, effect: ["implement", "resolver"].includes(id) ? "isolated-write" : "read", role: ["implement", "resolver"].includes(id) ? "implementer" : id === "review" ? "reviewer" : "investigator", writeScope: ["implement", "resolver"].includes(id) ? ["src"] : [] };
      catalog.policies["local@v1"].executors = Object.keys(catalog.executors);
      catalog.populations["members@v1"] = { ...ref("members"), members: ["a", "b"], exclusions: [], baselineDigest: programDigest({ root }), evidence: "owner fixture inventory", allowNoWork: false };
      let omitResolutionCoverage = true, conflictLayout: "exact" | "hierarchy" | "case" = "exact";
      const adapter: ProgramWorkerAdapter = async input => ({ directory: root, inputDigest: "fixture", async execute() {
        if (["implement", "resolver"].includes(input.executor.id)) {
          const member = (input.data as { workItem?: { id?: string } }).workItem?.id;
          const path = input.executor.id === "implement" && member === "b" ? conflictLayout === "hierarchy" ? "src/shared/nested" : conflictLayout === "case" ? "src/SHARED" : "src/shared" : "src/shared";
          return { outcome: "completed", data: {}, artifact: { digest: programDigest(input.attemptId), files: [{ path, beforeDigest: null, contentBase64: Buffer.from(input.executor.id === "resolver" ? "resolved all" : input.attemptId).toString("base64") }] } };
        }
        if (input.executor.id === "review") return { outcome: "completed", data: { verdict: "approved", findings: [], coveredObligationIds: (input.data as { assessmentContext: { obligationIds: string[] } }).assessmentContext.obligationIds.filter(id => !omitResolutionCoverage || !id.startsWith("resolution-")) } };
        return { outcome: "completed", data: { passed: true } };
      } });
      service = await ProgramRunService.open(root, catalog, adapter);
      const recipe = { recipe: recipeRef("repair", "v2"), implement: executorRef("implement", "v1"), review: executorRef("review", "v1"), writeScope: ["src"], maxRepairRounds: 2, maxAssessmentAttempts: 3, maxInfrastructureAttempts: 2, progressPolicy: { unchangedCandidateRounds: 2, repeatedFindingsRounds: 2 } };
      const create = (checks: string[]) => defineWorkflow({ ...workflow(), inputSchema: schemaRef("any", "v1"), outputSchema: schemaRef("any", "v1"), policy: policyRef("local", "v1"), acceptance: acceptanceRef("goal", "v1"), mode: "candidate", population: populationRef("members", "v1"), steps: [
        map("members", { items: [{ id: "a" }, { id: "b" }], key: field(item(), "id"), completion: "all-required", coverage: coverageFor(population(), { items: [{ id: "a" }, { id: "b" }] }), body: { steps: [repair("fix", { ...recipe, entryMode: "implement-first", initialCandidate: candidateFromBaseline(), assessmentScope: "item", checks: ["check@v1"] })], result: output("fix") } }),
        compose("resolve", { candidates: acceptedCandidates("members"), resolver: executorRef("resolver", "v1") }),
        repair("integration", { ...recipe, entryMode: "assess-first", initialCandidate: outputCandidate("resolve"), assessmentScope: "final", checks }),
        gate("final", { candidate: acceptedCandidate("integration"), coverage: coverageReceipt("members") })], result: output("final") });
      const rejected = await service.execute("program-start", { requestId: "missing-item-recheck", program: create(["finalcheck@v1"]), input: {} }) as ProgramRunV2;
      expect((await finish(service, rejected.runId)).status).toBe("needs-attention");
      omitResolutionCoverage = false;
      const accepted = await service.execute("program-start", { requestId: "rechecked", program: create(["finalcheck@v1"]), input: {} }) as ProgramRunV2;
      const state = await finish(service, accepted.runId); expect(state.status).toBe("acceptance-ready");
      expect(Object.values(state.compositionResolutions ?? {})).toHaveLength(1); expect(state.acceptedCandidate?.deltas).toHaveLength(1);
      const final = Object.values(state.assessments).find(assessment => assessment.phase === "final");
      expect(final?.satisfiedObligationIds?.length).toBe(4); expect(final?.checks.map(check => check.id).sort()).toEqual(["check@v1", "finalcheck@v1"]);
      for (const layout of ["hierarchy", "case"] as const) {
        conflictLayout = layout;
        const collision = await service.execute("program-start", { requestId: `resolve-${layout}`, program: create(["finalcheck@v1"]), input: {} }) as ProgramRunV2;
        const resolved = await finish(service, collision.runId);
        expect(resolved.status).toBe("acceptance-ready"); expect(Object.values(resolved.compositionResolutions ?? {})).toHaveLength(1); expect(resolved.acceptedCandidate?.deltas).toHaveLength(1);
      }
    } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
  });
});
