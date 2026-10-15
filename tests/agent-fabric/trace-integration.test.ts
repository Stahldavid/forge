import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createTraceFixture } from "./trace-fixture.ts";
import { ProgramRunStore } from "../../src/forge/agent-fabric/program-store.ts";
import { programDigest, type ProgramRunV2 } from "../../src/forge/agent-fabric/program-contract.ts";
import { projectFabricTrace } from "../../src/forge/agent-fabric/trace-projector.ts";
import { explainDeltaTrace } from "../../src/forge/delta/trace-projection.ts";
import { observeTraceRunGit, readTraceOwnerConfiguration } from "../../src/forge/agent-fabric/trace-owner-runtime.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { DeltaStore, probeDeltaStoreBusy } from "../../src/forge/delta/store.ts";
import { shutdownDeltaBroker } from "../../src/forge/delta/broker.ts";
import { explainFabricTrace } from "../../src/forge/agent-fabric/trace-reader.ts";

function completeExplanation(value: Awaited<ReturnType<DeltaStore["traceExplain"]>>) {
  if (!("entities" in value)) throw new Error("Expected a projected fixture explanation");
  return value;
}

let fixture: Awaited<ReturnType<typeof createTraceFixture>>, finalRun: ProgramRunV2;
beforeAll(async () => {
  fixture = await createTraceFixture(); const completed = await fixture.complete(); finalRun = completed.run;
  expect(completed.observation.exactIntegration).toBe(true);
  await projectFabricTrace({ root: fixture.root, identity: fixture.identity, delta: fixture.delta, generationId: "fixture-main" });
}, 120000);
afterAll(async () => { if (fixture) await fixture.close(); });
const runKey = () => ({ ...fixture.identity, runId: finalRun.runId });

test("T01 trace follows real fixture commands through reviewed candidate, gate, applied receipt and Git", async () => {
  const explanation = completeExplanation(await fixture.delta.traceExplain({ runKey: runKey(), limit: 256 }));
  expect(explanation.projection.status).toBe("fabric-current-at-cut");
  expect(explanation.execution?.observedStatus).toBe("applied");
  const predicates = explanation.relations?.map(item => item.relation.predicate) ?? [];
  for (const predicate of ["requested-by", "recorded-as", "produced-by", "assessed-by", "includes-check", "gated-by", "applied-as", "contains-candidate-content", "commit-linked-by-host"]) expect(predicates).toContain(predicate);
  expect(explanation.git?.observation).toBe("observed");
  expect(explanation.origin?.transcriptStored).toBe(false);
  expect(explanation.relations?.filter(item => item.relation.predicate === "commit-linked-by-host").every(item => item.relation.provenance.claimKind === "declared")).toBe(true);
});
test("T02 replay at an unchanged cut reads no historical suffix and writes no new occurrences", async () => {
  const before = await fixture.delta.traceStatus("fixture-main");
  const replay = await projectFabricTrace({ root: fixture.root, identity: fixture.identity, delta: fixture.delta, generationId: "fixture-main" });
  expect(replay.results[0].sourceVersions).toBe(0); expect(replay.results[0].inserted).toBe(0);
  expect((await fixture.delta.traceStatus("fixture-main")).counts).toEqual(before.counts);
});
test("T10 a pinned old source cut stays historical after later metadata", async () => {
  const store = await fixture.store(), old = await store.cut(finalRun.runId); if (!old) throw new Error("Missing cut");
  const closure = await store.traceArtifacts(finalRun.runId, { journalRef: old.journalRef });
  const annotation = closure.artifacts.find(item => item.type === "annotation"); if (!annotation) throw new Error("No annotation");
  const current = await fixture.read();
  finalRun = await fixture.service.execute("program-trace-annotate", { runId: current.runId, requestId: "fixture-correction", expectedVersion: current.version,
    annotation: { type: "correction", supersedesRef: annotation.ref, reason: "clarify fixture evidence", replacement: { summary: "fixture only", producer: "fixture-controller" } } }) as ProgramRunV2;
  const page = await store.historySuffix(finalRun.runId, { cut: old, limit: 256 }); expect(page.cut.version).toBe(old.version); expect(page.entries[0].version).toBe(old.version);
  await projectFabricTrace({ root: fixture.root, identity: fixture.identity, delta: fixture.delta, generationId: "fixture-main" });
  const historical = completeExplanation(await fixture.delta.traceExplain({ runKey: runKey(), generationId: "fixture-main", atVersion: old.version }));
  expect(historical.entities?.some(item => item.kind === "correction")).toBe(false);
});
test("T24 terminal annotation changes only metadata persistence and preserves dispatch count", async () => {
  const before = await fixture.read(), store = await fixture.store(), closure = await store.traceArtifacts(before.runId, { journalRef: (await store.cut(before.runId))!.journalRef });
  const target = closure.artifacts.find(item => item.type === "annotation"); if (!target) throw new Error("No target");
  const body = { runId: before.runId, requestId: "terminal-metadata-only", expectedVersion: before.version, annotation: { type: "correction", supersedesRef: target.ref, reason: "fixture metadata", replacement: { summary: "unchanged execution", producer: "fixture-controller" } } };
  const after = await fixture.service.execute("program-trace-annotate", body) as ProgramRunV2;
  expect(after.version).toBe(before.version + 1);
  const strip = (run: ProgramRunV2) => { const copy = structuredClone(run); delete copy.traceBindingsRef; return { ...copy, version: 0 }; };
  expect(strip(after)).toEqual(strip(before));
  expect((await fixture.service.execute("program-trace-annotate", body) as ProgramRunV2).version).toBe(after.version);
  finalRun = after;
});
test("T10 source mutation and a new run after enumeration stay outside the pinned pass", async () => {
  const before = await fixture.read(), store = await fixture.store(), cut = (await store.cut(before.runId))!;
  const closure = await store.traceArtifacts(before.runId, { journalRef: cut.journalRef });
  const target = closure.artifacts.find(item => item.type === "annotation"); if (!target) throw new Error("No annotation");
  let newRunId = "";
  const sink = { traceStatus: fixture.delta.traceStatus.bind(fixture.delta), traceProjectBatch: fixture.delta.traceProjectBatch.bind(fixture.delta), traceActivateGeneration: fixture.delta.traceActivateGeneration.bind(fixture.delta),
    traceCreateGeneration: async (request: Parameters<DeltaStore["traceCreateGeneration"]>[0]) => {
      const result = await fixture.delta.traceCreateGeneration(request);
      finalRun = await fixture.service.execute("program-trace-annotate", { runId: before.runId, requestId: "after-inventory", expectedVersion: before.version, annotation: { type: "correction", supersedesRef: target.ref, reason: "after enumeration", replacement: { summary: "new source version", producer: "fixture-controller" } } }) as ProgramRunV2;
      newRunId = (await fixture.startAdditional("after-enumeration-run")).runId;
      return result;
    } };
  const first = await projectFabricTrace({ root: fixture.root, identity: fixture.identity, delta: sink, generationId: "inventory-race", activate: false });
  expect(first.cuts).toHaveLength(1); expect(first.cuts[0].cut.version).toBe(cut.version);
  expect(first.cuts.some(item => item.runKey.runId === newRunId)).toBe(false);
  const next = await projectFabricTrace({ root: fixture.root, identity: fixture.identity, delta: fixture.delta, generationId: "inventory-race", activate: false });
  expect(next.cuts.some(item => item.runKey.runId === newRunId)).toBe(true);
  expect(next.cuts.find(item => item.runKey.runId === before.runId)!.cut.version).toBeGreaterThan(cut.version);
});
test("T26 T27 fresh projection generations rebuild the same logical graph without erasing Agent Memory", async () => {
  await projectFabricTrace({ root: fixture.root, identity: fixture.identity, delta: fixture.delta, generationId: "fixture-main" });
  const before = completeExplanation(await fixture.delta.traceExplain({ runKey: runKey(), generationId: "fixture-main" })), memory = await fixture.recordMemory();
  await projectFabricTrace({ root: fixture.root, identity: fixture.identity, delta: fixture.delta, generationId: "fixture-rebuilt" });
  const after = completeExplanation(await fixture.delta.traceExplain({ runKey: runKey(), generationId: "fixture-rebuilt" }));
  const logical = (value: typeof after) => programDigest({ entities: value.entities, relations: value.relations?.map(item => item.relation) });
  expect(logical(after)).toBe(logical(before));
  expect((await fixture.delta.traceReadAgentMemoryEvent(memory.eventId))?.id).toBe(memory.eventId);
  expect((await fixture.delta.traceStatus()).generationId).toBe("fixture-rebuilt");
});
test("T11 T12 late Agent Memory needs a verified explicit annotation and does not reopen the run", async () => {
  const late = await createTraceFixture({ lateOrigin: true, identitySuffix: "late" });
  try {
    let run = await late.finish(); expect(run.status).toBe("acceptance-ready");
    await projectFabricTrace({ root: late.root, identity: late.identity, delta: late.delta, generationId: "late-fixture" });
    let explanation = completeExplanation(await late.delta.traceExplain({ runKey: { ...late.identity, runId: run.runId } }));
    expect(explanation.agentMemory?.availability).toBe("pending");
    const event = await late.recordMemory();
    await projectFabricTrace({ root: late.root, identity: late.identity, delta: late.delta, generationId: "late-fixture" });
    expect(completeExplanation(await late.delta.traceExplain({ runKey: { ...late.identity, runId: run.runId } })).agentMemory?.availability).toBe("pending");
    const store = await late.store(), closure = await store.traceArtifacts(run.runId, { journalRef: (await store.cut(run.runId))!.journalRef });
    const origin = closure.artifacts.find(item => item.type === "origin"); if (!origin) throw new Error("Origin missing");
    const before = run;
    run = await late.service.execute("program-trace-annotate", { runId: run.runId, requestId: "late-link", expectedVersion: run.version, annotation: { type: "origin-event-bound", originRef: origin.ref, event } }) as ProgramRunV2;
    expect(run.status).toBe(before.status); expect(run.totalAttempts).toBe(before.totalAttempts); expect(run.semanticVersion).toBe(before.semanticVersion);
    await projectFabricTrace({ root: late.root, identity: late.identity, delta: late.delta, generationId: "late-fixture" });
    explanation = completeExplanation(await late.delta.traceExplain({ runKey: { ...late.identity, runId: run.runId } }));
    expect(explanation.agentMemory?.bindings.length).toBe(1);
    expect(explanation.agentMemory?.availability).toBe("primary-source-unverified");
  } finally { await late.close(); }
}, 120000);
test("T13 deleting the fixture primary event preserves the binding and reports source-expired", async () => {
  const expired = await createTraceFixture({ identitySuffix: "expired" });
  let reopened: DeltaStore | undefined;
  try {
    const { run } = await expired.complete(), key = { ...expired.identity, runId: run.runId };
    await projectFabricTrace({ root: expired.root, identity: expired.identity, delta: expired.delta, generationId: "expiry-fixture" });
    const event = await expired.recordMemory();
    const before = await explainFabricTrace(expired.root, { runKey: key }) as { agentMemory: { availability: string } };
    expect(before.agentMemory.availability).toBe("available");
    await expired.close(true); await shutdownDeltaBroker(expired.root);
    const deadline = Date.now() + 10000;
    while (probeDeltaStoreBusy(expired.root)) { if (Date.now() > deadline) throw new Error("Fixture broker did not close"); await new Promise(resolve => setTimeout(resolve, 20)); }
    const adapterPath = new URL("../../src/forge/runtime/db/pglite-adapter.ts", import.meta.url).href;
    const script = `const {createPgliteAdapter}=await import(${JSON.stringify(adapterPath)});const db=await createPgliteAdapter(${JSON.stringify(expired.delta.storePath)});try{await db.query('DELETE FROM agent_memory_events WHERE id=$1',[${JSON.stringify(event.eventId)}])}finally{await db.close()}`;
    execFileSync(process.env.FORGE_TRACE_NODE ?? process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), env: process.env });
    reopened = await DeltaStore.open(expired.root, { access: "write" });
    const result = await explainFabricTrace(expired.root, { runKey: key }) as { agentMemory: { availability: string; bindings: { historicalBinding: string; primaryAvailability: string }[] }; origin: { transcriptStored: boolean } };
    expect(result.agentMemory.bindings[0].historicalBinding).toBe("preserved");
    expect(result.agentMemory.bindings[0].primaryAvailability).toBe("source-expired");
    expect(result.agentMemory.availability).toBe("source-expired");
    expect(result.origin.transcriptStored).toBe(false);
  } finally { await reopened?.close(); await expired.close(); }
}, 120000);
test("T18 pre-run outside dirt cannot be erased into a clean-baseline claim", async () => {
  const dirty = await createTraceFixture({ identitySuffix: "pre-run-dirt", dirtyOutsideAtStart: true });
  try {
    await rm(join(dirty.root, "outside.txt"));
    const { observation } = await dirty.complete();
    expect(observation.exactIntegration).toBe(false);
    expect(observation.reasons).toContain("clean-baseline-not-proven");
  } finally { await dirty.close(); }
}, 120000);
test("T14 unavailable projection sink never dispatches or changes the source run", async () => {
  const before = await fixture.read();
  const offline = { traceCreateGeneration: async () => { throw new Error("fixture sink unavailable"); }, traceStatus: fixture.delta.traceStatus.bind(fixture.delta), traceProjectBatch: fixture.delta.traceProjectBatch.bind(fixture.delta), traceActivateGeneration: fixture.delta.traceActivateGeneration.bind(fixture.delta) };
  await expect(projectFabricTrace({ root: fixture.root, identity: fixture.identity, delta: offline, generationId: "offline" })).rejects.toThrow("fixture sink unavailable");
  expect(await fixture.read()).toEqual(before);
});
test("partial primary reads preserve page uncertainty and reject another store identity", async () => {
  const partial = await explainFabricTrace(fixture.root, { runKey: runKey(), offset: 1, limit: 1 }) as { projection: { status: string }; agentMemory: { availability: string } };
  expect(partial.projection.status).toBe("partial"); expect(partial.agentMemory.availability).toBe("unknown-in-partial-result");
  await expect(explainFabricTrace(fixture.root, { runKey: { ...runKey(), fabricStoreId: "another-store" } })).rejects.toThrow("identity mismatch");
});
test("T17 confirmed apply without commit remains distinct from observed Git commit", async () => {
  const late = await createTraceFixture({ identitySuffix: "no-commit" });
  try {
    let run = await late.finish();
    run = await late.service.execute("program-apply", { runId: run.runId, requestId: "fixture-no-commit-apply", expectedVersion: run.version, authorization: "fixture only" }) as ProgramRunV2;
    expect(run.status).toBe("applied");
    const observation = await observeTraceRunGit({ root: late.root, identity: late.identity, run, candidateDigest: run.acceptedCandidate!.digest, commitOid: "" });
    await late.service.execute("program-trace-annotate", { runId: run.runId, requestId: "no-commit-stamp", expectedVersion: run.version, annotation: { type: "git-observation", observation } });
    await projectFabricTrace({ root: late.root, identity: late.identity, delta: late.delta, generationId: "no-commit-generation" });
    expect(completeExplanation(await late.delta.traceExplain({ runKey: { ...late.identity, runId: run.runId } })).git?.observation).toBe("not-observed");
  } finally { await late.close(); }
}, 120000);
test("T25 the preserved alpha72 reader rejects trace4 without changing its bytes", async () => {
  const old = process.env.FORGE_TRACE_LEGACY_SOURCE;
  if (!old) throw new Error("Set FORGE_TRACE_LEGACY_SOURCE to the preserved alpha72 source for this pilot");
  const store = await fixture.store(), cut = (await store.cut(finalRun.runId))!;
  expect(cut.format).toBe(4);
  const record = join(store.directory, `${programDigest(finalRun.runId).slice(7)}.json`), before = await readFile(record);
  for (const operation of ["read", "list", "mutate"]) {
    const script = `const {ProgramRunStore}=await import(${JSON.stringify(old)});const s=await ProgramRunStore.open(${JSON.stringify(fixture.root)});try{${operation === "list" ? "await s.list()" : operation === "mutate" ? `await s.transact(${JSON.stringify(finalRun.runId)},'legacy-write',x=>x)` : `await s.read(${JSON.stringify(finalRun.runId)})`};process.exit(3)}catch{process.stdout.write('legacy-refused')}`;
    const output = execFileSync(process.env.FORGE_TRACE_NODE ?? process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
    expect(output).toBe("legacy-refused"); expect(await readFile(record)).toEqual(before);
  }
}, 120000);
test("T28 explanation and typed source export omit absolute roots, raw prompts and command args", async () => {
  const result = await fixture.delta.traceExplain({ runKey: runKey() }), store = await fixture.store();
  const closure = await store.traceArtifacts(finalRun.runId, { journalRef: (await store.cut(finalRun.runId))!.journalRef });
  const output = JSON.stringify([result, closure]); expect(output).not.toContain(fixture.root); expect(output).not.toContain("contentBase64"); expect(output).not.toContain("argv"); expect(output).not.toContain("rawPrompt");
});
test("T30 readonly absent queries create neither a store nor an owner", async () => {
  const empty = await mkdtemp(join(tmpdir(), "forge-trace-empty-"));
  try {
    expect(await ProgramRunStore.openReadOnly(empty)).toBeUndefined();
    const answer = await explainDeltaTrace(empty, { runKey: { ...fixture.identity, runId: "absent-fixture" } }) as { projection: { status: string } };
    expect(answer.projection.status).toBe("unavailable");
    expect(await stat(join(empty, ".forge")).then(() => true, () => false)).toBe(false);
    expect(await readTraceOwnerConfiguration(empty)).toBeUndefined();
    await expect(explainFabricTrace(empty, { runKey: { ...fixture.identity, repositoryId: "/CANARY_ABSOLUTE_PATH", runId: "absent-fixture" } })).rejects.toThrow("Invalid opaque");
  } finally { await rm(empty, { recursive: true, force: true }); }
});
test("trace CLI parses explicit projection mutations and readonly requests", () => {
  expect(parseCli(["trace", "project", "--file", "request.json", "--json"]).command?.kind).toBe("trace");
  expect(parseCli(["trace", "project"]).command).toBeNull();
  expect(parseCli(["trace", "status", "--json"]).command?.kind).toBe("trace");
});
test("a conflicting projection still preserves uncertainty about bindings outside the requested page", async () => {
  const status = await fixture.delta.traceStatus();
  const generationId = status.generationId; if (!generationId) throw new Error("Expected active fixture generation");
  const projected = completeExplanation(await fixture.delta.traceExplain({ runKey: runKey(), generationId }));
  const source = projected.sources[0]!;
  await expect(fixture.delta.traceProjectBatch({ generationId, runKey: runKey(), cut: { version: source.version, journalRef: source.journalRef, stateRef: source.stateRef },
    facts: [{ journalVersion: source.version, journalRef: source.journalRef, stateRef: source.stateRef, factKind: source.factKind, factIdentity: source.factIdentity, sourceDigest: programDigest("fixture-conflict"), entities: [] }] })).rejects.toMatchObject({ code: "TRACE_SOURCE_CONFLICT" });
  const result = await explainFabricTrace(fixture.root, { runKey: runKey(), generationId, offset: 1, limit: 1 }) as { projection: { status: string }; agentMemory: { availability: string } };
  expect(result.projection.status).toBe("conflict"); expect(result.agentMemory.availability).toBe("unknown-in-partial-result");
});

test("v2 real source file queries explain a persisted correction without altering owner execution", async () => {
  const current = await createTraceFixture({ identitySuffix: "query-corrections-v2" });
  try {
    const completed = await current.complete(), before = completed.run;
    const key = { ...current.identity, runId: before.runId }, candidateId = before.acceptedCandidate!.candidateId;
    const result = await projectFabricTrace({ root: current.root, identity: current.identity, delta: current.delta, generationId: "query-v2" });
    expect(result.extractorVersion).toBe("fabric-trace-v2");
    expect(await current.delta.traceStatus("query-v2")).toMatchObject({ extractorVersion: "fabric-trace-v2" });
    for (const filter of [{ candidateId }, { path: "src/a.txt" }, { candidateId, path: "src/a.txt" }]) {
      const explanation = completeExplanation(await current.delta.traceExplain({ runKey: key, generationId: "query-v2", ...filter }));
      expect(explanation).toMatchObject({ target: { match: "found-at-cut" }, git: { observation: "observed", contentMatch: "matches" } });
      expect(explanation.git.evidence.some(evidence => Array.isArray(evidence.paths) && evidence.paths.includes("src"))).toBe(true);
      const ids = new Set(explanation.entities.map(entity => entity.id));
      expect(explanation.relations.every(({ relation }) => ids.has(relation.from) && ids.has(relation.to))).toBe(true);
    }
    const store = await current.store(), oldCut = (await store.cut(before.runId))!;
    const closure = await store.traceArtifacts(before.runId, { journalRef: oldCut.journalRef });
    const annotation = closure.artifacts.find(item => item.type === "annotation" && item.value.type === "git-observation");
    if (!annotation) throw new Error("Expected Git annotation in actual fixture closure");
    const after = await current.service.execute("program-trace-annotate", { runId: before.runId, requestId: "query-correction-v2", expectedVersion: before.version,
      annotation: { type: "correction", supersedesRef: annotation.ref, reason: "clarify https://private.invalid/source token=canary", replacement: { summary: "declared fixture clarification", producer: "fixture-controller" } } }) as ProgramRunV2;
    const strip = (run: ProgramRunV2) => { const copy = structuredClone(run); delete copy.traceBindingsRef; return { ...copy, version: 0 }; };
    expect(strip(after)).toEqual(strip(before));
    await projectFabricTrace({ root: current.root, identity: current.identity, delta: current.delta, generationId: "query-v2" });
    const explanation = completeExplanation(await current.delta.traceExplain({ runKey: key, generationId: "query-v2", candidateId, path: "src/a.txt" }));
    expect(explanation.git.observation).toBe("unknown"); expect(explanation.git.contentMatch).toBe("not-evaluated");
    expect(explanation.git.evidence.some(evidence => evidence.superseded === true)).toBe(true);
    expect(explanation.corrections).toMatchObject([{ supersedesRef: annotation.ref, replacement: { summary: "declared fixture clarification", producer: "fixture-controller" }, claimKind: "declared", authority: "none", details: "available" }]);
    expect(explanation.corrections[0]!.reason).toContain("REDACTED"); expect(JSON.stringify(explanation)).not.toContain("canary"); expect(JSON.stringify(explanation)).not.toContain("private.invalid");
    const historical = completeExplanation(await current.delta.traceExplain({ runKey: key, generationId: "query-v2", candidateId, path: "src/a.txt", atVersion: oldCut.version }));
    expect(historical.git.observation).toBe("observed"); expect(historical.corrections).toEqual([]);
    await current.delta.traceCreateGeneration({ generationId: "query-v1-preserved", extractorVersion: "fabric-trace-v1" });
    await expect(projectFabricTrace({ root: current.root, identity: current.identity, delta: current.delta, generationId: "query-v1-preserved" })).rejects.toMatchObject({ code: "TRACE_SOURCE_CONFLICT" });
    expect(await current.delta.traceStatus("query-v1-preserved")).toMatchObject({ extractorVersion: "fabric-trace-v1", counts: { sources: 0 } });
  } finally { await current.close(); }
}, 120000);
