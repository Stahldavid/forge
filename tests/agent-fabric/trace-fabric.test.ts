import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, readdir, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProgramRunService } from "../../src/forge/agent-fabric/program-service.ts";
import { ProgramRunStore } from "../../src/forge/agent-fabric/program-store.ts";
import { programDigest, type ProgramRunV2, type ProgramRegistry } from "../../src/forge/agent-fabric/program-contract.ts";
import { defineWorkflow, schemaRef, policyRef, acceptanceRef, literal } from "../../src/forge/agent-fabric/program-dsl.ts";
import { normalizeTraceOrigin, normalizeTraceAnnotation, normalizeTraceManifest, traceRelativePath, traceSummary, traceAgentMemorySliceDigest, type TraceOrigin, type TraceManifest, type TraceAgentMemorySlice, type TraceRuntimeOptions } from "../../src/forge/agent-fabric/trace-contract.ts";
import type { TraceGitObservation } from "../../src/forge/agent-fabric/trace-git.ts";

const roots: string[] = [], services: ProgramRunService[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const identity = { repositoryId: "fixture-repo", checkoutId: "fixture-checkout", fabricStoreId: "fixture-store" };
const externalOrigin = { issuerNamespace: "fixture-host", integration: "manual-import", externalSessionId: "fixture-session", turnId: "fixture-turn" };
const slice: TraceAgentMemorySlice = { sourceNamespace: "fixture-host", integration: "manual-import", externalSessionId: "fixture-session", turnId: "fixture-turn", eventType: "fixture.confirmed" };
const event = { memoryStoreId: "fixture-memory", eventId: "fixture-event", sourceNamespace: "fixture-host", eventDigest: traceAgentMemorySliceDigest(slice) };
const originInput = { origin: externalOrigin, agentMemoryRefs: [] };
function registry(): ProgramRegistry { return { schemas: { "any@v1": {} }, executors: {}, populations: {}, policies: { "local@v1": { id: "local", version: "v1", maxItems: 8, concurrency: 1, maxAttempts: 8, maxOperations: 8, maxDepth: 4, deadlineMs: 30000, maxOutputBytes: 65536, writeScope: [], executors: [], allowCooperativeCommands: false, allowNetwork: false } }, acceptance: { "goal@v1": { id: "goal", version: "v1", criteria: ["fixture-preserved"], writeScope: [], requiredChecks: [], requireReview: false, allowNoWork: true, allowPartial: false } } }; }
const workflow = () => defineWorkflow({ id: "fixture-trace", version: 1, inputSchema: schemaRef("any", "v1"), outputSchema: schemaRef("any", "v1"), policy: policyRef("local", "v1"), acceptance: acceptanceRef("goal", "v1"), steps: [], result: literal({ done: true }) });
async function fixture(trace: TraceRuntimeOptions = { identity, capture: "fixture-observed" }) {
  const root = await mkdtemp(join(tmpdir(), "forge-trace-fabric-")); roots.push(root);
  const service = await ProgramRunService.open(root, registry(), async () => { throw new Error("Unexpected worker dispatch"); }, { trace }); services.push(service); return { root, service, trace };
}
async function start(service: ProgramRunService, trace: unknown = { origins: [originInput] }, requestId = "fixture-start") {
  const request = { requestId, program: workflow(), input: {}, ...(trace === null ? {} : { trace }) };
  const initial = await service.execute("program-start", request) as ProgramRunV2;
  for (let count = 0; count < 1000; count++) { const state = (await service.store.read(initial.runId))!; if (state.status !== "executing") return { initial, state, request }; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error("Fixture did not settle");
}
async function manifest(store: ProgramRunStore, state: ProgramRunV2) { return store.get<TraceManifest>(state.traceBindingsRef!); }

describe("Fabric trace persistence and metadata authority", () => {
  test("publishes origin in the initial snapshot before any execution; format4 survives later transitions", async () => {
    const f = await fixture(), { initial, state, request } = await start(f.service);
    expect(initial.version).toBe(1); expect(initial.traceBindingsRef).toBeDefined(); expect(state.status).toBe("completed");
    const history = await f.service.store.history(state.runId), original = await f.service.store.get<ProgramRunV2>(history[0].stateRef);
    expect(original.traceBindingsRef).toBe(initial.traceBindingsRef); expect((await f.service.store.cut(state.runId))!.format).toBe(4);
    const m = await manifest(f.service.store, state), origin = await f.service.store.get<TraceOrigin>(m.originRefs[0]);
    expect(m.runKey).toEqual({ ...identity, runId: state.runId }); expect(origin.provenance).toEqual({ capture: "fixture-observed", claimKind: "declared", authority: "none" });
    const replay = await f.service.execute("program-start", request) as ProgramRunV2; expect(replay.version).toBe(state.version);
    await expect(f.service.execute("program-start", { ...request, trace: { origins: [{ ...originInput, origin: { ...externalOrigin, turnId: "other" } }] } })).rejects.toMatchObject({ code: "AF_PROGRAM_CONFLICT" });
  });
  test("trusted baseline observation is captured before run publication and consumer cannot supply it", async () => {
    let observed = 0;
    const stamp = { schema: "forge.trace-git-baseline.v1" as const, ...identity, objectFormat: "unknown" as const, head: "", baselineDigest: programDigest("fixture-pending-baseline"), index: "unknown" as const, worktree: "unknown" as const };
    const f = await fixture({ identity, observeGitBaseline: async () => { observed++; return stamp; } });
    const { initial } = await start(f.service); expect(observed).toBe(1);
    const m = await manifest(f.service.store, initial), origin = await f.service.store.get<TraceOrigin>(m.originRefs[0]); expect(origin.gitBaseline).toEqual(stamp);
    await expect(start(f.service, { origins: [{ ...originInput, gitBaseline: { ...stamp, index: "clean" } }] }, "fixture-forged-baseline")).rejects.toMatchObject({ code: "TRACE_INVALID_REFERENCE" });
    expect((await f.service.store.get<TraceOrigin>(m.originRefs[0])).gitBaseline?.index).toBe("unknown");
  });
  test.each(["completed", "applied", "canceled", "apply-uncertain"] as const)("late confirmed memory binding only changes persistence after %s", async status => {
    const f = await fixture({ identity, resolveAgentMemoryEvent: async () => ({ committed: true, memoryStoreId: event.memoryStoreId, eventId: event.eventId, slice }) });
    let { state } = await start(f.service); state = await f.service.store.transact(state.runId, "fixture-terminal", current => ({ ...current!, status }));
    const m = await manifest(f.service.store, state), request = { runId: state.runId, requestId: "fixture-late-event", expectedVersion: state.version, annotation: { type: "origin-event-bound", originRef: m.originRefs[0], event } };
    const annotated = await f.service.execute("program-trace-annotate", request) as ProgramRunV2;
    const operational = (value: ProgramRunV2) => { const { version: _version, traceBindingsRef: _trace, ...fields } = value; return fields; };
    expect(operational(annotated)).toEqual(operational(state)); expect(annotated.version).toBe(state.version + 1);
    const newManifest = await manifest(f.service.store, annotated); expect(newManifest.annotationRefs).toHaveLength(1);
    const annotation = normalizeTraceAnnotation(await f.service.store.get(newManifest.annotationRefs[0])); expect(annotation.type).toBe("origin-event-bound");
    f.trace.resolveAgentMemoryEvent = async () => undefined;
    const replay = await f.service.execute("program-trace-annotate", request) as ProgramRunV2; expect(replay.version).toBe(annotated.version);
    await expect(f.service.execute("program-trace-annotate", { ...request, annotation: { ...request.annotation, event: { ...event, eventId: "changed" } } })).rejects.toMatchObject({ code: "TRACE_SOURCE_CONFLICT" });
  });
  test("pending/forged memory sources fail closed and trusted late binding verifies digest and origin", async () => {
    const runtime: TraceRuntimeOptions = { identity, resolveAgentMemoryEvent: async () => undefined }, f = await fixture(runtime), { state } = await start(f.service), m = await manifest(f.service.store, state);
    const request = { runId: state.runId, requestId: "fixture-bind", expectedVersion: state.version, annotation: { type: "origin-event-bound", originRef: m.originRefs[0], event } };
    await expect(f.service.execute("program-trace-annotate", request)).rejects.toMatchObject({ code: "TRACE_SOURCE_UNAVAILABLE" });
    runtime.resolveAgentMemoryEvent = async () => ({ committed: true, memoryStoreId: event.memoryStoreId, eventId: event.eventId, slice: { ...slice, externalSessionId: "forged-session" } });
    await expect(f.service.execute("program-trace-annotate", request)).rejects.toMatchObject({ code: "TRACE_SOURCE_CONFLICT" });
    expect((await f.service.store.read(state.runId))!.version).toBe(state.version);
  });
  test("distinct annotation requests preserve occurrences, corrections append and stale writes do not replace evidence", async () => {
    const f = await fixture({ identity, resolveAgentMemoryEvent: async () => ({ committed: true, memoryStoreId: event.memoryStoreId, eventId: event.eventId, slice }) });
    let { state } = await start(f.service); const originRef = (await manifest(f.service.store, state)).originRefs[0];
    const annotation = { type: "origin-event-bound", originRef, event };
    state = await f.service.execute("program-trace-annotate", { runId: state.runId, requestId: "bind-first", expectedVersion: state.version, annotation }) as ProgramRunV2;
    state = await f.service.execute("program-trace-annotate", { runId: state.runId, requestId: "bind-second", expectedVersion: state.version, annotation }) as ProgramRunV2;
    const before = await manifest(f.service.store, state); expect(before.annotationRefs).toHaveLength(2); expect(before.annotationRefs[0]).not.toBe(before.annotationRefs[1]);
    const request = { runId: state.runId, requestId: "correct-first", expectedVersion: state.version, annotation: { type: "correction", supersedesRef: before.annotationRefs[0], reason: "Clarify fixture statement", replacement: { summary: "Fixture corrected statement", producer: "fixture-host" } } };
    const corrected = await f.service.execute("program-trace-annotate", request) as ProgramRunV2; const after = await manifest(f.service.store, corrected); expect(after.annotationRefs.slice(0, 2)).toEqual(before.annotationRefs);
    await expect(f.service.execute("program-trace-annotate", { ...request, requestId: "stale-correction" })).rejects.toMatchObject({ code: "TRACE_VERSION_CONFLICT" });
    const artifacts = await f.service.store.traceArtifacts(state.runId, { journalRef: (await f.service.store.cut(state.runId))!.journalRef }); expect(artifacts.artifacts.filter(value => value.type === "annotation")).toHaveLength(3);
  });
  test("initial confirmed memory references are owner-resolved; arbitrary confirmedSlices are rejected", async () => {
    const f = await fixture({ identity, resolveAgentMemoryEvent: async () => ({ committed: true, memoryStoreId: event.memoryStoreId, eventId: event.eventId, slice }) });
    const { state } = await start(f.service, { origins: [{ ...originInput, agentMemoryRefs: [event] }] });
    const m = await manifest(f.service.store, state), origin = await f.service.store.get<TraceOrigin>(m.originRefs[0]); expect(origin.confirmedSlices?.[0].slice).toEqual(slice);
    await expect(start(f.service, { origins: [{ ...originInput, confirmedSlices: [] }] }, "fixture-invalid")).rejects.toMatchObject({ code: "TRACE_INVALID_REFERENCE" });
  });
  test("Git annotations require trusted re-observation, exact callback agreement and committed apply evidence", async () => {
    const runtime: TraceRuntimeOptions = { identity }, f = await fixture(runtime), { state } = await start(f.service);
    const observation: TraceGitObservation = { schema: "forge.trace-git-observation.v1", ...identity, objectFormat: "unknown", commit: { status: "not-observed" }, head: { index: "unknown", worktree: "unknown" }, candidate: { digest: programDigest("candidate"), baselineDigest: state.baselineDigest, scope: ["src"] }, contentMatch: "not-evaluated", exactIntegration: false, hostLink: "not-reported", claims: [], reasons: [] };
    const request = { runId: state.runId, requestId: "fixture-git-observation", expectedVersion: state.version, annotation: { type: "git-observation", observation } };
    await expect(f.service.execute("program-trace-annotate", request)).rejects.toMatchObject({ code: "TRACE_SOURCE_UNAVAILABLE" });
    runtime.resolveGitObservation = async requested => ({ ...requested, head: { ...requested.head, worktree: "dirty" } });
    await expect(f.service.execute("program-trace-annotate", request)).rejects.toMatchObject({ code: "TRACE_SOURCE_CONFLICT" });
    runtime.resolveGitObservation = async requested => requested;
    const cut = (await f.service.store.cut(state.runId))!, invalidApply = { ...observation, apply: { receiptRef: programDigest("fake-receipt"), sourceJournalRef: cut.journalRef } };
    await expect(f.service.execute("program-trace-annotate", { ...request, annotation: { ...request.annotation, observation: invalidApply } })).rejects.toMatchObject({ code: "TRACE_INVALID_REFERENCE" });
    const annotated = await f.service.execute("program-trace-annotate", request) as ProgramRunV2; expect(annotated.status).toBe(state.status); expect(annotated.version).toBe(state.version + 1);
    const m = await manifest(f.service.store, annotated), annotation = normalizeTraceAnnotation(await f.service.store.get(m.annotationRefs[0])); expect(annotation.provenance.claimKind).toBe("observed");
  });
  test("format3 legacy is readable/mutable and cannot be annotated or implicitly upgraded", async () => {
    const f = await fixture(), { state } = await start(f.service, null);
    expect((await f.service.store.cut(state.runId))!.format).toBe(3);
    await f.service.store.transact(state.runId, "legacy-mutation", current => ({ ...current!, reason: "fixture metadata" })); expect((await f.service.store.cut(state.runId))!.format).toBe(3);
    await expect(f.service.execute("program-trace-annotate", { runId: state.runId, requestId: "legacy", expectedVersion: state.version, annotation: {} })).rejects.toMatchObject({ code: "TRACE_UNSUPPORTED" });
    const orphan = await f.service.store.put({ schema: "forge.trace-manifest.v1" });
    await expect(f.service.store.transact(state.runId, "illegal-upgrade", current => ({ ...current!, traceBindingsRef: orphan }))).rejects.toMatchObject({ code: "TRACE_UNSUPPORTED" });
  });
  test("trace4 cannot downgrade; identity mismatch never reuses an origin from another store", async () => {
    const f = await fixture(), { state } = await start(f.service);
    await expect(f.service.store.transact(state.runId, "illegal-downgrade", current => { delete current!.traceBindingsRef; return current!; })).rejects.toMatchObject({ code: "TRACE_UNSUPPORTED" });
    const reader = await ProgramRunStore.openReadOnly(f.root, { ...identity, fabricStoreId: "different-store" }); await expect(reader!.read(state.runId)).rejects.toMatchObject({ code: "TRACE_IDENTITY_MISMATCH" });
    await expect(f.service.updateRuntimeOptions({ trace: { identity: { ...identity, checkoutId: "different" } } })).rejects.toMatchObject({ code: "TRACE_IDENTITY_MISMATCH" });
  });
});

describe("committed source cuts, bounded history, reachability and readonly operation", () => {
  test("read-only open of absent store does not create directories; existing reader denies every write API", async () => {
    const root = await mkdtemp(join(tmpdir(), "forge-trace-absent-")); roots.push(root);
    expect(await ProgramRunStore.openReadOnly(root)).toBeUndefined(); expect(await readdir(root)).toEqual([]);
    const f = await fixture(), { state } = await start(f.service), reader = (await ProgramRunStore.openReadOnly(f.root))!;
    await expect(reader.put({ secret: true })).rejects.toMatchObject({ code: "TRACE_UNSUPPORTED" }); await expect(reader.putBinary(new Uint8Array())).rejects.toMatchObject({ code: "TRACE_UNSUPPORTED" });
    await expect(reader.transact(state.runId, "write", current => current!)).rejects.toMatchObject({ code: "TRACE_UNSUPPORTED" });
    expect((await reader.cut(state.runId))!.format).toBe(4);
  });
  test("pinned older cut survives new versions, paginates descending with bounded snapshot reads, and validates checkpoint", async () => {
    const f = await fixture(), { state } = await start(f.service);
    for (let count = 0; count < 8; count++) await f.service.store.transact(state.runId, "fixture-step", current => ({ ...current!, reason: `step-${count}` }));
    const cut = (await f.service.store.cut(state.runId))!, priorHistory = await f.service.store.history(state.runId), after = { version: priorHistory[1].version, journalRef: programDigest(priorHistory[1]) };
    await f.service.store.transact(state.runId, "later-version", current => ({ ...current!, reason: "outside-cut" }));
    let page = await f.service.store.historySuffix(state.runId, { cut, after, limit: 2 }), entries = [...page.entries]; expect(entries).toHaveLength(2); expect(page.complete).toBe(false);
    while (page.nextCursor) { page = await f.service.store.historySuffix(state.runId, { cut, after, limit: 2, cursor: page.nextCursor }); entries.push(...page.entries); }
    expect(page.complete).toBe(true); expect(entries.map(entry => entry.version)).toEqual(Array.from({ length: cut.version - after.version }, (_, index) => cut.version - index));
    expect(entries[0].state.reason).not.toBe("outside-cut");
    await expect(f.service.store.historySuffix(state.runId, { cut, after: { ...after, journalRef: programDigest("wrong") } })).rejects.toMatchObject({ code: "TRACE_SOURCE_CONFLICT" });
    await expect(f.service.store.historySuffix(state.runId, { cut, cursor: "forged-cursor" })).rejects.toMatchObject({ code: "TRACE_INVALID_REFERENCE" });
    const readsBefore = f.service.store.metrics.artifactReads; const empty = await f.service.store.historySuffix(state.runId, { cut: (await f.service.store.cut(state.runId))!, after: { version: cut.version + 1, journalRef: (await f.service.store.cut(state.runId))!.journalRef } });
    expect(empty.entries).toEqual([]); expect(f.service.store.metrics.artifactReads - readsBefore).toBeLessThan(30);
  });
  test("intact CAS orphan and other run journal never become committed roots", async () => {
    const f = await fixture(), first = await start(f.service), second = await start(f.service, { origins: [originInput] }, "other-request"), cut = (await f.service.store.cut(first.state.runId))!;
    const orphan = await f.service.store.put({ runId: first.state.runId, version: cut.version + 1, type: "orphan", at: "fixture", stateDigest: cut.stateRef, stateRef: cut.stateRef, parentRef: cut.journalRef });
    await expect(f.service.store.confirmedCut(first.state.runId, orphan)).rejects.toMatchObject({ code: "TRACE_INVALID_REFERENCE" });
    await expect(f.service.store.traceArtifacts(first.state.runId, { journalRef: (await f.service.store.cut(second.state.runId))!.journalRef })).rejects.toMatchObject({ code: "TRACE_INVALID_REFERENCE" });
  });
  test("hash-valid historical snapshot cannot smuggle another run's trace manifest", async () => {
    const f = await fixture(), first = await start(f.service), second = await start(f.service, { origins: [originInput] }, "fixture-foreign-origin");
    const history = await f.service.store.history(first.state.runId), historical = await f.service.store.get<ProgramRunV2>(history[0].stateRef);
    historical.traceBindingsRef = second.state.traceBindingsRef;
    const stateRef = await f.service.store.put(historical); let parentRef: string | undefined, forgedAncestor = "";
    for (let index = 0; index < history.length; index++) {
      const { parentRef: _oldParent, ...entry } = history[index];
      parentRef = await f.service.store.put({ ...entry, ...(index === 0 ? { stateRef, stateDigest: stateRef } : {}), ...(parentRef ? { parentRef } : {}) }); if (index === 0) forgedAncestor = parentRef;
    }
    const recordPath = join(f.service.store.directory, `${programDigest(first.state.runId).slice(7)}.json`), envelope = JSON.parse(await readFile(recordPath, "utf8"));
    envelope.record.journalRef = parentRef; envelope.digest = programDigest(envelope.record); await writeFile(recordPath, JSON.stringify(envelope));
    await expect(f.service.store.confirmedCut(first.state.runId, forgedAncestor)).rejects.toMatchObject({ code: "TRACE_IDENTITY_MISMATCH" });
    const cut = (await f.service.store.cut(first.state.runId))!; await expect(f.service.store.historySuffix(first.state.runId, { cut })).rejects.toMatchObject({ code: "TRACE_IDENTITY_MISMATCH" });
  });
  test("typed metadata closure excludes source snapshots, raw bytes and absolute roots; budgets reject explicitly", async () => {
    const f = await fixture(), { state } = await start(f.service, { origins: [{ ...originInput, summary: "fixture token=CANARY_SECRET at /home/private/source https://user:pass@local/secret", summaryProducer: "fixture" }] }), cut = (await f.service.store.cut(state.runId))!;
    const closure = await f.service.store.traceArtifacts(state.runId, { journalRef: cut.journalRef });
    expect(closure.artifacts.map(artifact => artifact.type)).toEqual(["manifest", "origin"]);
    const output = JSON.stringify(closure); expect(output).not.toContain(f.root); expect(output).not.toContain("CANARY_SECRET"); expect(output).not.toContain("user:pass"); expect(output).not.toContain("/home/private");
    await expect(f.service.store.traceArtifacts(state.runId, { journalRef: cut.journalRef, maxDepth: 0 })).rejects.toMatchObject({ code: "TRACE_LIMIT_EXCEEDED" });
    await expect(f.service.store.traceArtifacts(state.runId, { journalRef: cut.journalRef, maxRefs: 1 })).rejects.toMatchObject({ code: "TRACE_LIMIT_EXCEEDED" });
    await expect(f.service.store.traceArtifacts(state.runId, { journalRef: cut.journalRef, maxBytes: 16 })).rejects.toMatchObject({ code: "TRACE_LIMIT_EXCEEDED" });
  });
  test("corrupt journal integrity fails; read-only store rejects symlink escape", async () => {
    const f = await fixture(), { state } = await start(f.service), cut = (await f.service.store.cut(state.runId))!, path = join(f.service.store.directory, "artifacts", `${cut.journalRef.slice(7)}.json`), original = await readFile(path, "utf8");
    await writeFile(path, original.replace('"type":', '"tampered":'));
    await expect(f.service.store.cut(state.runId)).rejects.toThrow("integrity"); await writeFile(path, original);
    const other = await mkdtemp(join(tmpdir(), "forge-trace-symlink-")); roots.push(other); await mkdir(join(other, ".forge/local/agent-fabric"), { recursive: true }); await symlink(f.service.store.directory, join(other, ".forge/local/agent-fabric/program-runs-v3"));
    await expect(ProgramRunStore.openReadOnly(other)).rejects.toThrow();
  });
});

describe("trace allowlist and privacy profile", () => {
  test.each(["../secret", "/home/private", "C:\\private", "a/../b", "a//b", "https://user:pass@host/path", "a/./b"])("rejects unsafe path %s", path => { expect(() => traceRelativePath(path)).toThrow(); });
  test("opaque identities, origin fields, annotation authority and oversized summaries fail closed", () => {
    const runKey = { ...identity, runId: "fixture-run" }, base = { schema: "forge.trace-origin.v1", ...runKey, origin: externalOrigin, agentMemoryRefs: [], provenance: { capture: "fixture", claimKind: "declared", authority: "none" }, privacyProfile: "trace-metadata-v1" };
    expect(() => normalizeTraceOrigin({ ...base, prompt: "CANARY" })).toThrow(); expect(() => normalizeTraceOrigin({ ...base, repositoryId: "/absolute" })).toThrow();
    expect(() => normalizeTraceOrigin({ ...base, provenance: { ...base.provenance, authority: programDigest("fake-approval") } })).toThrow();
    expect(() => normalizeTraceManifest({ schema: "forge.trace-manifest.v1", runKey, originRefs: Array.from({ length: 9 }, (_, index) => programDigest(index)), annotationRefs: [] })).toThrow();
    expect(() => traceSummary("x".repeat(2049))).toThrow();
    expect(traceSummary("sk-testsecret123456789 ghp_123456789012345678901234 file:///private/file")).not.toContain("testsecret");
    expect(() => normalizeTraceAnnotation({ schema: "forge.trace-annotation.v1", runKey, provenance: base.provenance, type: "correction", supersedesRef: programDigest("a"), reason: "fixture", replacement: { summary: "fixture", producer: "fixture", command: "rm -rf" } })).toThrow();
  });
});
