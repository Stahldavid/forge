import { expect, test } from "bun:test";
import { programDigest, type ProgramRunV2, type ProgramAssessment, type ProgramRegistry, type WorkflowProgramV2 } from "../../src/forge/agent-fabric/program-contract.ts";
import { extractFabricTrace, TRACE_EXTRACTOR_VERSION } from "../../src/forge/agent-fabric/trace-extractor.ts";
import type { ProgramHistoryEntry, ProgramRunStore } from "../../src/forge/agent-fabric/program-store.ts";
import type { TraceProjectionFact } from "../../src/forge/delta/trace-projection.ts";

const identity = { repositoryId: "fixture-extractor-repo", checkoutId: "fixture-extractor-checkout", fabricStoreId: "fixture-extractor-store" };
const d = (label: string) => programDigest({ fixture: label });
function snapshot(): ProgramRunV2 {
  const candidate = { candidateId: "fixture-candidate", digest: d("candidate"), baselineDigest: d("baseline"), parents: [], deltas: [], producerAttempts: ["fixture-attempt"] };
  const assessment: ProgramAssessment = { candidateDigest: candidate.digest, verdict: "approved", findings: [], checks: [{ id: "fixture-check", passed: true }], attemptIds: ["fixture-attempt"],
    operationId: "repair/assessment", generation: 1, semanticDigest: d("operation-contract"), inputDigest: d("operation-input"), environmentRef: d("environment-A"), contractDigest: d("assessment-contract-A") };
  const program: WorkflowProgramV2 = { schemaVersion: 2, id: "fixture-program", version: 1, inputSchema: { id: "any", version: "v1" }, outputSchema: { id: "any", version: "v1" }, acceptance: { id: "fixture", version: "v1" }, policy: { id: "fixture", version: "v1" }, steps: [], result: {} };
  const registry: ProgramRegistry = { schemas: {}, policies: {}, acceptance: {}, populations: {}, executors: {} };
  return { schemaVersion: 2, runId: "fixture-run", requestId: "fixture-start", requestDigest: d("start"), program, registry, programDigest: programDigest(program), registryDigest: programDigest(registry),
    inputRef: d("input"), baselineDigest: candidate.baselineDigest, createdAt: "2026-10-15T09:00:00.000Z", deadlineAt: "2026-10-15T09:01:00.000Z", version: 1, semanticVersion: 1, revision: 1, planRevision: 1,
    status: "acceptance-ready", operations: { "repair/assessment": { id: "repair/assessment", status: "completed", semanticDigest: assessment.semanticDigest!, inputDigest: assessment.inputDigest!, generation: 1, attempts: ["fixture-attempt"] } },
    attempts: { "fixture-attempt": { attemptId: "fixture-attempt", operationId: "repair/assessment", generation: 1, inputDigest: d("attempt-input"), executorDigest: d("executor"), startedAt: "2026-10-15T09:00:00.000Z", outcome: "completed" } },
    seals: { fixture: d("seal") }, signals: [], candidates: { [candidate.candidateId]: candidate }, acceptedCandidate: candidate, assessments: { "fixture-assessment": assessment }, gateRef: d("gate"),
    coverageReceipts: {}, deltas: {}, waits: {}, repairs: {}, collections: {}, totalAttempts: 1 };
}
function gate(state: ProgramRunV2) { return { semanticVersion: state.semanticVersion, programDigest: state.programDigest, candidateDigest: state.acceptedCandidate!.digest, seals: structuredClone(state.seals), assessment: structuredClone(state.assessments["fixture-assessment"]) }; }
function entry(state: ProgramRunV2): ProgramHistoryEntry { return { runId: state.runId, version: state.version, journalRef: d(`journal-${state.version}`), stateRef: programDigest(state), stateDigest: programDigest(state), type: "fixture-source", at: state.createdAt, state }; }
async function extract(state: ProgramRunV2, receipt: unknown, previous?: ProgramRunV2) {
  const store = { async get(ref: string) { if (ref !== state.gateRef && ref !== state.receiptRef) throw new Error("Unexpected fixture artifact access"); return receipt; } } as unknown as ProgramRunStore;
  return extractFabricTrace({ store, identity }, entry(state), previous);
}
function assessmentData(facts: TraceProjectionFact[]) { return facts.flatMap(fact => fact.entities ?? []).find(entity => entity.kind === "assessment")?.data; }
function gateData(facts: TraceProjectionFact[]) { return facts.flatMap(fact => fact.entities ?? []).find(entity => entity.kind === "gate")?.data; }
const predicates = (facts: TraceProjectionFact[]) => facts.flatMap(fact => fact.relations ?? []).map(relation => relation.predicate);

test.each(["applying", "apply-uncertain"] as const)("%s without a committed receipt remains an application attempt", async status => {
  const state = snapshot(); state.status = status;
  state.intent = { id: "fixture-application", candidateDigest: state.acceptedCandidate!.digest } as ProgramRunV2["intent"];
  const before = structuredClone(state), facts = await extract(state, gate(state));
  expect(predicates(facts)).toContain("application-attempt"); expect(predicates(facts)).not.toContain("applied-as"); expect(state).toEqual(before);
});

test("a source-confirmed applied snapshot emits application separately from Git and host causality", async () => {
  const state = snapshot(); state.status = "applied"; state.receiptRef = d("application-receipt");
  state.intent = { id: "fixture-application", candidateDigest: state.acceptedCandidate!.digest } as ProgramRunV2["intent"];
  const facts = await extract(state, gate(state)); expect(predicates(facts)).toContain("applied-as");
  expect(predicates(facts)).not.toContain("commit-linked-by-host"); expect(predicates(facts)).not.toContain("contains-candidate-content");
});

test("matching owner gate preserves the exact assessment context without granting authority", async () => {
  const state = snapshot(), facts = await extract(state, gate(state)), assessment = assessmentData(facts);
  expect(assessment).toMatchObject({ current: true, validity: "owner-gated-at-cut", generation: 1, environmentRef: d("environment-A"), contractDigest: d("assessment-contract-A"), inputDigest: d("operation-input"), semanticDigest: d("operation-contract") });
  expect(facts.flatMap(fact => fact.relations ?? []).every(relation => relation.provenance.authority === "none")).toBe(true);
  expect(gateData(facts)).toMatchObject({ current: true, validity: "owner-gated-at-cut" });
});

test("an unchanged approved report cannot become current under an older gate semantic version", async () => {
  const state = snapshot(), receipt = gate(state); receipt.semanticVersion = 0;
  const facts = await extract(state, receipt);
  expect(assessmentData(facts)).toMatchObject({ result: "approved", current: false, validity: "historical-or-unverified" });
  expect(gateData(facts)).toMatchObject({ current: false, validity: "historical-or-unverified" });
});

const changes: [string, (state: ProgramRunV2) => void][] = [
  ["semantic version", state => { state.semanticVersion++; }],
  ["program contract", state => { state.programDigest = d("new-program-contract"); }],
  ["generation", state => { state.operations["repair/assessment"]!.generation++; }],
  ["operation input", state => { state.operations["repair/assessment"]!.inputDigest = d("new-operation-input"); }],
  ["operation contract", state => { state.operations["repair/assessment"]!.semanticDigest = d("new-operation-contract"); }],
  ["environment", state => { state.assessments["fixture-assessment"]!.environmentRef = d("environment-B"); }],
  ["assessment contract", state => { state.assessments["fixture-assessment"]!.contractDigest = d("assessment-contract-B"); }],
  ["seal", state => { state.seals.fixture = d("new-seal"); }],
  ["attempt outcome", state => { state.attempts["fixture-attempt"]!.outcome = "uncertain"; }],
  ["accepted candidate", state => { state.acceptedCandidate = { ...state.acceptedCandidate!, digest: d("different-candidate") }; }],
];
for (const [label, mutate] of changes) test(`independent ${label} change keeps approval historical, including incremental projection`, async () => {
  const before = snapshot(), receipt = gate(before), oldFacts = await extract(before, receipt); expect(assessmentData(oldFacts)?.current).toBe(true);
  expect(gateData(oldFacts)?.current).toBe(true);
  const after = structuredClone(before); after.version++; mutate(after);
  const initial = await extract(after, receipt), incremental = await extract(after, receipt, before);
  expect(assessmentData(initial)).toMatchObject({ result: "approved", current: false, validity: "historical-or-unverified" });
  expect(assessmentData(incremental)).toMatchObject({ result: "approved", current: false, validity: "historical-or-unverified" });
  expect(gateData(initial)).toMatchObject({ current: false, validity: "historical-or-unverified" });
  expect(gateData(incremental)).toMatchObject({ current: false, validity: "historical-or-unverified" });
  expect(incremental.some(fact => fact.factKind === "gate-state")).toBe(true);
  expect(predicates(oldFacts)).toContain("gated-by"); expect(predicates(incremental)).not.toContain("gated-by");
  expect(after.assessments["fixture-assessment"]?.candidateDigest).toBe(before.assessments["fixture-assessment"]?.candidateDigest);
});


test("v2 extracts sanitized declared correction details without changing execution or gates", async () => {
  const state = snapshot(); state.traceBindingsRef = d("trace-bindings");
  const before = structuredClone(state), correctionRef = d("correction"), targetRef = d("annotation");
  const store = {
    async get() { return gate(state); },
    async traceArtifacts() { return { runKey: { ...identity, runId: state.runId }, artifacts: [{ type: "annotation", ref: correctionRef, value: {
      type: "correction", supersedesRef: targetRef, reason: "clarify https://private.invalid/path token=canary", replacement: { summary: "source /private/file.txt\nunchanged", producer: "fixture-controller" },
      provenance: { capture: "host-reported", claimKind: "declared", authority: "none" },
    } }] }; },
  } as unknown as ProgramRunStore;
  const facts = await extractFabricTrace({ store, identity }, entry(state));
  const correction = facts.flatMap(fact => fact.entities ?? []).find(entity => entity.kind === "correction");
  expect(TRACE_EXTRACTOR_VERSION).toBe("fabric-trace-v2");
  expect(correction?.data).toMatchObject({ annotationRef: correctionRef, supersedesRef: targetRef, replacementProducer: "fixture-controller" });
  expect(correction?.data?.reason).toContain("REDACTED"); expect(correction?.data?.replacementSummary).toContain("REDACTED");
  expect(JSON.stringify(correction)).not.toContain("canary"); expect(JSON.stringify(correction)).not.toContain("private.invalid"); expect(JSON.stringify(correction)).not.toContain("/private/file");
  expect(String(correction?.data?.replacementSummary)).not.toContain("\n");
  expect(facts.flatMap(fact => fact.relations ?? []).filter(edge => edge.predicate === "supersedes")).toMatchObject([{ provenance: { claimKind: "declared", authority: "none" } }]);
  expect(state).toEqual(before); expect(assessmentData(facts)?.current).toBe(true);
});
