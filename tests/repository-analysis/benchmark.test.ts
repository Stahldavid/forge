import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { analyzeRepository } from "../../src/forge/repository-analysis/analyze.ts";
import { createRepositoryAgentBenchmarkPlan, evaluateRepositoryAgentBenchmark, type RepositoryAgentBenchmarkPlan, type RepositoryBenchmarkObservation } from "../../src/forge/repository-analysis/benchmark.ts";
import type { RepositoryManifest } from "../../src/forge/repository-manifest/types.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) { if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("forge-benchmark-")) throw new Error("Unsafe fixture cleanup"); rmSync(root, { recursive: true, force: true }); } });
async function fixture(checks = true) {
  const root = mkdtempSync(join(tmpdir(), "forge-benchmark-")); roots.push(root);
  writeFileSync(join(root, "seo.ts"), "export function validateSeoEnvironment() { return true; }");
  const manifest: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: ".", adapters: ["typescript"] }],
    ...(checks ? { checks: [{ id: "types", component: "web", argv: ["node", "-e", "throw new Error('must never execute')"], category: "typecheck" as const }] } : {}) };
  const snapshot = await analyzeRepository(root, manifest);
  const cases = [{ id: "seo", query: "Corrigir validateSeoEnvironment", scope: ["seo.ts"], expectedFiles: ["seo.ts"], forbiddenFiles: ["private.ts"] }];
  const model = { provider: "codex", name: "configured-model", settings: { reasoningEffort: "high", seed: 7 } };
  return { snapshot, cases, model, plan: createRepositoryAgentBenchmarkPlan(snapshot, cases, { model }) };
}
function observations(plan: RepositoryAgentBenchmarkPlan): RepositoryBenchmarkObservation[] {
  return plan.runs.map((run, index) => ({ planId: plan.planId, runId: run.runId, binding: structuredClone(plan.binding),
    taskDigest: run.taskDigest, executionDigest: run.executionDigest, model: structuredClone(plan.model), workerId: `isolated-worker-${index}`, status: "completed",
    artifactDigest: `sha256:${"a".repeat(64)}`, artifactEvidenceRef: `artifact:${index}`,
    checks: run.workerInput.checks.map(check => ({ id: check.id, status: "passed", evidenceRef: `executor-check:${index}:${check.id}` })),
    review: { reviewerId: "independent-reviewer", artifactDigest: `sha256:${"a".repeat(64)}`, outcome: "accepted", evidenceRef: `review:${index}` },
    metrics: { inputTokens: run.arm === "with-maps" ? 200 : 300, outputTokens: 100, latencyMs: run.arm === "with-maps" ? 1000 : 2000,
      sourceReads: run.arm === "with-maps" ? [{ path: "seo.ts", chars: 100, evidenceRef: "read:one" }] : [{ path: "seo.ts", chars: 100, evidenceRef: "read:one" }, { path: "seo.ts", chars: 40, evidenceRef: "read:two" }],
      evidenceRefs: [`executor:${index}`], provenance: "executor-observed" } }));
}
function rehash(plan: RepositoryAgentBenchmarkPlan): RepositoryAgentBenchmarkPlan {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : value;
  const hash = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
  for (const run of plan.runs) {
    const item = plan.cases.find(item => item.id === run.caseId)!;
    const { repositoryContext: _packet, ...common } = run.workerInput;
    run.taskDigest = hash({ case: item, common });
    run.executionDigest = hash({ binding: plan.binding, taskDigest: run.taskDigest, workerInput: run.workerInput });
    run.runId = hash({ binding: plan.binding, taskDigest: run.taskDigest, arm: run.arm, repetition: run.repetition });
  }
  const { planId: _id, ...body } = plan; plan.planId = hash(body); return plan;
}

test("planning is deterministic, counterbalanced, bound to source, and changes only maps", async () => {
  const { snapshot, cases, model, plan } = await fixture();
  expect(createRepositoryAgentBenchmarkPlan(snapshot, cases, { model }).planId).toBe(plan.planId);
  const repeated = createRepositoryAgentBenchmarkPlan(snapshot, cases, { model, repetitions: 2 });
  expect(repeated.runs.map(run => run.arm)).toEqual(["without-maps", "with-maps", "with-maps", "without-maps"]);
  expect(plan.execution).toBe("not-executed"); expect(plan.authorization).toBe("external-runner-required");
  const [control, mapped] = plan.runs;
  const { repositoryContext, ...withCommon } = mapped!.workerInput;
  expect(withCommon).toEqual(control!.workerInput);
  expect(repositoryContext?.snapshotId).toBe(snapshot.snapshotId);
  expect(JSON.stringify(control!.workerInput)).not.toContain("expectedFiles");
  expect(control!.workerInput.checks[0]!.argv).toEqual(["node", "-e", "throw new Error('must never execute')"]);
  expect(control!.taskDigest).toBe(mapped!.taskDigest); expect(control!.executionDigest).not.toBe(mapped!.executionDigest);
  model.settings.seed = 8; cases[0]!.scope[0] = "other.ts";
  expect(plan.model.settings.seed).toBe(7); expect(plan.runs[0]!.workerInput.scope).toEqual(["seo.ts"]);
  const changed = structuredClone(snapshot); changed.files["seo.ts"]!.hash = "b".repeat(64);
  expect(() => createRepositoryAgentBenchmarkPlan(changed, plan.cases, { model })).toThrow("snapshot");
});

test("missing runs, metrics, review, and application-check evidence stay unknown", async () => {
  const { plan } = await fixture();
  const empty = evaluateRepositoryAgentBenchmark(plan, []);
  expect(empty.comparablePairs).toBe(0); expect(empty.pairs[0]!.status).toBe("pending");
  expect(empty.results[0]!.metrics.inputTokens).toBeNull(); expect(empty.results[0]!.checks[0]!.status).toBe("unknown");
  const reports = observations(plan); delete reports[0]!.metrics; delete reports[1]!.metrics;
  const reviewed = evaluateRepositoryAgentBenchmark(plan, reports);
  expect(reviewed.comparablePairs).toBe(1); expect(reviewed.metrics.inputTokens).toEqual({ observedPairs: 0, meanDeltaWithMinusWithout: null });
  delete reports[0]!.review;
  expect(evaluateRepositoryAgentBenchmark(plan, reports).pairs[0]!.status).toBe("review-required");
  reports[0]!.review = observations(plan)[0]!.review; delete reports[0]!.checks;
  expect(evaluateRepositoryAgentBenchmark(plan, reports).pairs[0]!.status).toBe("checks-required");
});

test("paired reports use observed metrics only after independent review and declared checks", async () => {
  const { plan } = await fixture();
  const report = evaluateRepositoryAgentBenchmark(plan, observations(plan));
  expect(report.comparablePairs).toBe(1); expect(report.identitiesAuthenticated).toBe(false);
  expect(report.metrics.inputTokens).toEqual({ observedPairs: 1, meanDeltaWithMinusWithout: -100 });
  expect(report.metrics.latencyMs).toEqual({ observedPairs: 1, meanDeltaWithMinusWithout: -1000 });
  expect(report.metrics.sourceReadEvents).toEqual({ observedPairs: 1, meanDeltaWithMinusWithout: -1 });
  expect(report.metrics.uniqueSourceFiles).toEqual({ observedPairs: 1, meanDeltaWithMinusWithout: 0 });
  expect(report.metrics.sourceChars).toEqual({ observedPairs: 1, meanDeltaWithMinusWithout: -40 });
  expect(report.metrics.cachedInputTokens).toEqual({ observedPairs: 0, meanDeltaWithMinusWithout: null });
  const failed = observations(plan); failed[1]!.checks![0]!.status = "failed";
  const incomplete = evaluateRepositoryAgentBenchmark(plan, failed);
  expect(incomplete.comparablePairs).toBe(0); expect(incomplete.pairs[0]!.deltaWithMinusWithout.inputTokens).toBeNull();
});

test("foreign checkout, snapshot, task, model, artifact, identity, and duplicate reports are rejected", async () => {
  const { plan } = await fixture();
  for (const mutate of [
    (report: RepositoryBenchmarkObservation) => { report.binding.root += "-foreign"; },
    (report: RepositoryBenchmarkObservation) => { report.binding.snapshotId = `repo:${"b".repeat(64)}`; },
    (report: RepositoryBenchmarkObservation) => { report.binding.inputDigest = `sha256:${"b".repeat(64)}`; },
    (report: RepositoryBenchmarkObservation) => { report.taskDigest = `sha256:${"b".repeat(64)}`; },
    (report: RepositoryBenchmarkObservation) => { report.executionDigest = `sha256:${"b".repeat(64)}`; },
    (report: RepositoryBenchmarkObservation) => { report.model.name = "different-actual-model"; },
    (report: RepositoryBenchmarkObservation) => { report.model.settings.reasoningEffort = "low"; },
    (report: RepositoryBenchmarkObservation) => { report.review!.artifactDigest = `sha256:${"b".repeat(64)}`; },
    (report: RepositoryBenchmarkObservation) => { report.review!.reviewerId = report.workerId; },
    (report: RepositoryBenchmarkObservation) => { report.metrics!.inputTokens = -1; },
    (report: RepositoryBenchmarkObservation) => { report.metrics!.sourceReads![0]!.path = "../private.ts"; },
    (report: RepositoryBenchmarkObservation) => { report.metrics!.evidenceRefs = []; },
    (report: RepositoryBenchmarkObservation) => { report.checks![0]!.id = "undeclared-check"; },
    (report: RepositoryBenchmarkObservation) => { delete report.checks![0]!.evidenceRef; },
  ]) {
    const reports = observations(plan); mutate(reports[0]!);
    expect(() => evaluateRepositoryAgentBenchmark(plan, reports)).toThrow("incomparable");
  }
  const duplicate = observations(plan); duplicate[1] = duplicate[0]!;
  expect(() => evaluateRepositoryAgentBenchmark(plan, duplicate)).toThrow("incomparable");
  const identity = observations(plan); identity[1]!.workerId = identity[0]!.workerId;
  expect(() => evaluateRepositoryAgentBenchmark(plan, identity)).toThrow("isolated");
  const reviewer = observations(plan); reviewer[1]!.review!.reviewerId = reviewer[0]!.workerId;
  expect(() => evaluateRepositoryAgentBenchmark(plan, reviewer)).toThrow("independent");
  const tampered = structuredClone(plan); tampered.runs[0]!.workerInput.model.name = "other-model";
  expect(() => evaluateRepositoryAgentBenchmark(tampered, [])).toThrow("plan");
});

test("failed static retrieval cases stay in the plan and bounded reviewed contracts reject invalid options", async () => {
  const { snapshot, model } = await fixture(false);
  const plan = createRepositoryAgentBenchmarkPlan(snapshot, [{ id: "missing", query: "SEO", expectedFiles: ["missing.ts"] }], { model });
  expect(plan.cases[0]!.expectedFiles).toEqual(["missing.ts"]);
  expect(plan.runs[0]!.workerInput.scope).toEqual(["."]);
  expect(plan.runs[1]!.workerInput.repositoryContext!.writeScope).toEqual([]);
  expect(evaluateRepositoryAgentBenchmark(plan, observations(plan)).comparablePairs).toBe(1);
  expect(() => createRepositoryAgentBenchmarkPlan(snapshot, [{ id: "unsafe", query: "SEO", expectedFiles: ["../secret"] }], { model })).toThrow("quality");
  for (const repetitions of [0, 11, 1.5]) expect(() => createRepositoryAgentBenchmarkPlan(snapshot, plan.cases, { model, repetitions })).toThrow("options");
  expect(() => createRepositoryAgentBenchmarkPlan(snapshot, plan.cases, { model, maxChars: 1000 })).toThrow("options");
  expect(() => createRepositoryAgentBenchmarkPlan(snapshot, plan.cases, { model: { ...model, settings: { apiKey: "must-not-be-in-plan" } } })).toThrow("options");
  const reports = observations(plan); reports[0]!.metrics!.sourceReads![0]!.chars = undefined;
  expect(evaluateRepositoryAgentBenchmark(plan, reports).metrics.sourceChars).toEqual({ observedPairs: 0, meanDeltaWithMinusWithout: null });
});

test("rehashed plans retain strict case/check/packet contracts, depth bounds and neutral credential diagnostics", async () => {
  const { snapshot, cases, model, plan } = await fixture();
  for (const key of ["api_key", "openai-api-key", "access_token", "refreshToken", "client_secret", "private.key", "authorization", "cookies"]) {
    try { createRepositoryAgentBenchmarkPlan(snapshot, cases, { model: { ...model, settings: { [key]: "private-placeholder" } } }); throw new Error("Expected credential rejection"); }
    catch (error) { expect((error as Error).message).toBe("Invalid repository benchmark options"); expect((error as Error).message).not.toContain("private-placeholder"); }
  }
  expect(createRepositoryAgentBenchmarkPlan(snapshot, cases, { model: { ...model, settings: { max_tokens: 4000 } } }).model.settings.max_tokens).toBe(4000);
  for (const mutate of [
    (value: RepositoryAgentBenchmarkPlan) => { value.cases[0]!.expectedFiles = ["../outside.ts"]; },
    (value: RepositoryAgentBenchmarkPlan) => { (value.cases[0] as any).extra = true; },
    (value: RepositoryAgentBenchmarkPlan) => { for (const run of value.runs) run.workerInput.checks[0]!.cwd = "../outside"; },
    (value: RepositoryAgentBenchmarkPlan) => { for (const run of value.runs) run.workerInput.checks[0]!.argv = []; },
    (value: RepositoryAgentBenchmarkPlan) => { value.runs[1]!.workerInput.repositoryContext!.nodes[0]!.metadata.extra = "x".repeat(50001); },
    (value: RepositoryAgentBenchmarkPlan) => { value.runs[1]!.workerInput.repositoryContext!.edges.push({ id: "fake", from: "unknown", to: "unknown", kind: "calls", evidence: value.runs[1]!.workerInput.repositoryContext!.nodes[0]!.evidence, metadata: {} }); },
    (value: RepositoryAgentBenchmarkPlan) => { value.runs[1]!.workerInput.repositoryContext!.writeScope = ["."]; },
    (value: RepositoryAgentBenchmarkPlan) => { value.binding.root = "relative-root"; },
  ]) { const forged = structuredClone(plan); mutate(forged); expect(() => evaluateRepositoryAgentBenchmark(rehash(forged), [])).toThrow("plan"); }
  const deep = structuredClone(plan); let metadata: any = deep.runs[1]!.workerInput.repositoryContext!.nodes[0]!.metadata;
  for (let index = 0; index < 40; index++) { metadata.next = {}; metadata = metadata.next; }
  expect(() => evaluateRepositoryAgentBenchmark(deep, [])).toThrow("plan");
  const cyclic = structuredClone(plan); (cyclic.runs[1]!.workerInput.repositoryContext!.nodes[0]!.metadata as any).cycle = cyclic;
  expect(() => evaluateRepositoryAgentBenchmark(cyclic, [])).toThrow("plan");
});
