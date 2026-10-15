import { expect, test } from "bun:test";
import { buildAgentMemoryTraceContext, type TraceContextReaders } from "../../src/forge/agent-memory/trace-context.ts";
import type { TraceOwnerConfiguration } from "../../src/forge/agent-fabric/trace-owner-runtime.ts";

const ref = (label: string) => `sha256:${Buffer.from(label).toString("hex").padEnd(64, "0").slice(0, 64)}`;
const identity = { repositoryId: "context-repository", checkoutId: "context-checkout", fabricStoreId: "context-store" };
const key = { ...identity, runId: "run-A" };
const cut = { version: 2, journalRef: ref("journal"), stateRef: ref("state") };
const configuration: TraceOwnerConfiguration = { schema: "forge.fabric-trace-config.v1", identity, checkoutBinding: ref("checkout") };
const event = { files: ["src/a.ts"], entries: ["notes.revise"], proofs: ["proof:build"] };
const source = (index: number) => ({ sourceKey: ref(`source-${index}`).slice(7), digest: ref(`digest-${index}`), version: 2, journalRef: cut.journalRef, stateRef: cut.stateRef, factKind: "snapshot", factIdentity: `fact-${index}` });
function explanation() {
  return { runKey: key, projection: { generationId: "gen-A", extractorVersion: "fabric-trace-v2", status: "fabric-current-at-cut", graphScope: "run-at-cut", sourceCut: cut }, execution: { observedStatus: "applied" }, entities: [
    { id: "candidate-A", kind: "candidate", data: { candidateId: "candidate-A", candidateDigest: ref("candidate-A"), paths: ["src/a.ts"] } },
    { id: "candidate-B", kind: "candidate", data: { candidateId: "candidate-B", candidateDigest: ref("candidate-B"), paths: ["src/b.ts"] } },
    { id: "gate-A", kind: "gate", data: { candidateDigest: ref("candidate-A"), validity: "owner-gated-at-cut", current: true, gateRef: ref("gate") } },
    { id: "assessment-A", kind: "assessment", data: { candidateDigest: ref("candidate-A"), validity: "owner-gated-at-cut", current: true, result: "approved", inputDigest: ref("input") } },
    { id: "assessment-B", kind: "assessment", data: { candidateDigest: ref("candidate-B"), validity: "historical-or-unverified", current: false, result: "rejected" } },
    { id: "origin", kind: "origin", data: { originRef: ref("origin") } },
  ], git: { observation: "observed", contentMatch: "differs", evidence: [
    { annotationRef: ref("annotation-A"), candidateDigest: ref("candidate-A"), paths: ["src"], observation: "observed", contentMatch: "matches", commitOid: "a".repeat(40) },
    { annotationRef: ref("annotation-B"), candidateDigest: ref("candidate-B"), paths: ["src/a.ts", "src/b.ts"], observation: "observed", contentMatch: "differs", commitOid: "b".repeat(40) },
  ] }, corrections: [], sources: [source(1), source(2)], gaps: [], truncated: false };
}
function readers(raw: unknown = explanation(), cuts: unknown[] = [{ runKey: key, cut }]) {
  const calls: Array<{ method: string; args: unknown[]; timeoutMs: number }> = [];
  const dependencies: Partial<TraceContextReaders> = { readConfiguration: async () => configuration, request: async (_root, method, args, timeoutMs) => {
    calls.push({ method, args, timeoutMs });
    return method === "traceStatus" ? { generationId: "gen-A", extractorVersion: "fabric-trace-v2", status: "active", cuts } : raw;
  } };
  return { calls, dependencies };
}

test("unconfigured trace is disabled and never asks for a broker or storage", async () => {
  let calls = 0;
  const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "current" }, { readConfiguration: async () => undefined, request: async () => { calls++; throw new Error("forbidden"); } });
  expect(result.status).toBe("disabled"); expect(result.items).toEqual([]); expect(calls).toBe(0);
  expect(result.authority).toBe("none"); expect(result.approvalForNewTask).toBe("not-evaluated");
});

test("path-selected history transports source validity while granting no new authorization", async () => {
  const fixture = readers();
  const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "handoff", events: [event] }, fixture.dependencies);
  expect(result.status).toBe("available"); expect(result.selection).toMatchObject({ basis: "workspace-observed-files", relevance: "path-overlap", paths: ["src/a.ts"], causality: "not-inferred" });
  expect(result.items).toHaveLength(1); const item = result.items[0]!;
  expect(item).toMatchObject({ runKey: key, cut, generationId: "gen-A", authority: "none", approvalForNewTask: "not-evaluated", sourceAvailability: "primary-source-unverified", sourceScope: "run-source-set" });
  expect(item.evidence).toMatchObject([{ kind: "gate", validity: "owner-gated-at-cut" }, { kind: "assessment", validity: "owner-gated-at-cut", result: "approved" }]);
  expect(item.candidates.map(candidate => candidate.candidateId)).toEqual(["candidate-A"]);
  expect(item.git).toMatchObject({ observation: "observed", contentMatch: "matches", evidence: [{ commitOid: "a".repeat(40), paths: ["src"] }] });
  expect([...item.sources].sort((a,b) => a.factIdentity.localeCompare(b.factIdentity))).toEqual([source(1), source(2)]);
  expect(fixture.calls[1]!.args).toEqual([{ runKey: key, generationId: "gen-A", atVersion: 2, limit: 128 }]);
});

test("entry and proof need exact event bindings while explicit paths remain explicit", async () => {
  for (const scope of ["entry", "proof", "change"] as const) {
    const fixture = readers();
    const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope, entry: "missing", proof: "missing", change: "session-A", events: [event] }, fixture.dependencies);
    expect(result.status).toBe("unavailable"); expect(result.selection.basis).toBe("unmapped-target"); expect(fixture.calls).toEqual([]);
  }
  for (const input of [{ scope: "entry" as const, entry: "notes.revise" }, { scope: "proof" as const, proof: "build" }]) {
    expect((await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", ...input, events: [event] }, readers().dependencies)).status).toBe("available");
  }
  const explicit = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "change", change: "session-A", paths: ["src/a.ts"] }, readers().dependencies);
  expect(explicit.selection.basis).toBe("explicit-paths"); expect(explicit.items).toHaveLength(1);
});

test("workspace overviews explicitly leave task relevance unknown and foreign identities are excluded", async () => {
  const fixture = readers();
  const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "current" }, fixture.dependencies);
  expect(result.selection).toMatchObject({ basis: "workspace-overview", relevance: "unknown", causality: "not-inferred" });
  expect(result.gaps).toContain("task-relevance-unmapped"); expect(result.items[0]!.selection.relevance).toBe("unknown");
  const foreign = readers(explanation(), [{ runKey: { ...key, checkoutId: "another-checkout" }, cut }]);
  const excluded = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "handoff", events: [event] }, foreign.dependencies);
  expect(excluded.status).toBe("unavailable"); expect(excluded.items).toEqual([]); expect(foreign.calls).toHaveLength(1);
});

test("partial pages never promote source approvals or global Git summaries", async () => {
  const raw = explanation(); raw.truncated = true; raw.projection.status = "partial"; raw.projection.graphScope = "page";
  const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "handoff", events: [event] }, readers(raw).dependencies);
  expect(result.status).toBe("partial"); expect(result.items[0]!.completeness).toBe("partial");
  expect(result.items[0]!.evidence.every(evidence => evidence.validity === "unknown")).toBe(true);
  expect(result.items[0]!.git).toMatchObject({ observation: "unknown", contentMatch: "not-evaluated" });
  expect(result.approvalForNewTask).toBe("not-evaluated");
});

test("cut mismatch, invalid sources and offline brokers fail closed without throwing", async () => {
  const mismatch = explanation(); mismatch.projection.sourceCut = { ...cut, stateRef: ref("wrong") };
  const invalidSource = explanation(); invalidSource.sources[0]!.version = 3;
  for (const raw of [mismatch, invalidSource]) {
    const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "handoff", events: [event] }, readers(raw).dependencies);
    expect(result.status).toBe("unavailable"); expect(result.items).toEqual([]);
  }
  const offline = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "handoff" }, { readConfiguration: async () => configuration, request: async () => { throw new Error("offline /private/canary"); } });
  expect(offline.status).toBe("unavailable"); expect(JSON.stringify(offline)).not.toContain("canary");
});

test("source facts are budgeted across runs and query limits shrink with remaining capacity", async () => {
  const calls: number[] = []; let count = 0;
  const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "handoff", events: [event] }, { readConfiguration: async () => configuration, request: async (_root, method, args) => {
    if (method === "traceStatus") return { generationId: "gen-A", extractorVersion: "fabric-trace-v2", status: "active", cuts: ["A", "B", "C"].map(suffix => ({ runKey: { ...key, runId: `run-${suffix}` }, cut })) };
    const filter = args[0] as { runKey: typeof key; limit: number }; calls.push(filter.limit);
    const raw = explanation(); raw.runKey = filter.runKey; raw.sources = Array.from({ length: count++ ? 28 : 100 }, (_,index) => source(index));
    raw.truncated = count > 1; return raw;
  } });
  expect(calls).toEqual([128, 28]); expect(result.reads.factsRead).toBe(128); expect(result.status).toBe("partial"); expect(result.gaps).toContain("trace-fact-limit-exceeded");
});

test("configuration and RPC share the total time budget", async () => {
  let now = 0; const budgets: number[] = [];
  const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "current" }, { now: () => now, readConfiguration: async (_root, options) => { expect(options.timeoutMs).toBe(2000); now += 1500; return configuration; }, request: async (_root, _method, _args, timeoutMs) => { budgets.push(timeoutMs); now += 600; return { generationId: "gen-A", extractorVersion: "fabric-trace-v2", status: "active", cuts: [{ runKey: key, cut }] }; } });
  expect(budgets).toEqual([500]); expect(result.reads.budgetExhausted).toBe(true); expect(result.status).toBe("partial");
});

test("unsafe paths never broaden to an overview and output ignores raw/code payloads", async () => {
  for (const paths of [["/private/file"], ["../../escape"], []]) {
    const fixture = readers(); const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "current", paths }, fixture.dependencies);
    expect(result.items).toEqual([]); expect(result.status).toBe("unavailable"); expect(fixture.calls).toEqual([]);
  }
  const raw = explanation() as ReturnType<typeof explanation> & Record<string, unknown>;
  raw.rawPrompt = "CANARY_RAW_PROMPT"; raw.argv = ["CANARY_ARGV"]; raw.code = "CANARY_CODE";
  const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/private/CANARY_ROOT", scope: "current", events: [event] }, readers(raw).dependencies);
  expect(JSON.stringify(result)).not.toContain("CANARY_"); expect(result.reads.bytesUsed).toBeLessThanOrEqual(result.limits.maxBytes);
});

test("an observed label without a valid commit OID never becomes a confirmed Git summary", async () => {
  for (const oid of [undefined, "not-an-object-id"]) {
    const raw = explanation(); raw.git.evidence = [raw.git.evidence[0]!];
    (raw.git.evidence[0] as unknown as Record<string, unknown>).commitOid = oid;
    const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "current", events: [event] }, readers(raw).dependencies);
    expect(result.items[0]!.git).toMatchObject({ observation: "unknown", contentMatch: "not-evaluated" });
  }
});

test("corrections retain declared sanitized context and never replace superseded Git with an observed claim", async () => {
  const raw = explanation() as ReturnType<typeof explanation> & Record<string, unknown>;
  raw.git.evidence = [{ ...raw.git.evidence[0]!, superseded: true } as never];
  raw.corrections = [{ annotationRef: ref("correction"), supersedesRef: ref("annotation-A"), reason: "clarify token=CANARY_SECRET https://private.invalid/file", replacement: { summary: "const SECRET_CODE = process.env.KEY", producer: "fixture-controller" }, superseded: false }] as never;
  const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "current", events: [event] }, readers(raw).dependencies);
  expect(result.items[0]!.git).toMatchObject({ observation: "unknown", contentMatch: "not-evaluated" });
  expect(result.items[0]!.corrections).toMatchObject([{ authority: "none", replacement: { summary: "[CODE OMITTED]", producer: "fixture-controller" } }]);
  expect(JSON.stringify(result)).not.toContain("CANARY_SECRET"); expect(JSON.stringify(result)).not.toContain("private.invalid"); expect(JSON.stringify(result)).not.toContain("SECRET_CODE");
});


test("source presentation stays under 32 KiB without losing the complete graph validity", async () => {
  const raw = explanation(); raw.sources = Array.from({ length: 98 }, (_,index) => source(index));
  const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "current", events: [event] }, readers(raw).dependencies);
  expect(result.status).toBe("partial"); expect(result.gaps).toContain("source-list-truncated");
  const item = result.items[0]!;
  expect(item).toMatchObject({ completeness: "complete-at-cut", sourceCompleteness: "partial", sourceScope: "run-source-subset", sourcesTotal: 98 });
  expect(item.sources.length).toBeGreaterThan(0); expect(item.sourcesOmitted).toBe(98 - item.sources.length);
  expect(item.evidence.some(evidence => evidence.validity === "owner-gated-at-cut")).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32768);
});

test.each(["git-observation", "commit"])("legacy %s correction fallback observes the same candidate and file scope as Git evidence", async kind => {
  const raw = explanation() as ReturnType<typeof explanation> & Record<string, unknown>;
  raw.entities[0]!.data.paths = ["src/a.ts", "src/b.ts"];
  const gitA = { candidateDigest: ref("candidate-A"), paths: ["src/a.ts"], observation: "observed", contentMatch: "matches", commitOid: "a".repeat(40) };
  const gitB = { candidateDigest: ref("candidate-A"), paths: ["src/b.ts"], observation: "observed", contentMatch: "matches", commitOid: "b".repeat(40) };
  raw.git.evidence = [gitA, gitB] as never;
  raw.entities.push({ id: "git-A", kind: "git-observation", data: gitA } as never, { id: "git-B", kind, data: gitB } as never, { id: "annotation-B", kind: "annotation", data: { annotationRef: ref("annotation-B") } } as never);
  raw.relations = [{ relation: { from: "annotation-B", to: "git-B", predicate: "records" } }];
  raw.corrections = [{ annotationRef: ref("correction-B"), supersedesRef: ref("annotation-B"), reason: "file B only", replacement: { summary: "historical declaration", producer: "fixture-controller" } }] as never;
  const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "current", events: [event] }, readers(raw).dependencies);
  expect(result.items[0]!.git.evidence).toHaveLength(1); expect(result.items[0]!.git.contentMatch).toBe("matches"); expect(result.items[0]!.corrections).toEqual([]);
});


test("a limited page without the pinned cut source reports uncertainty instead of invalid metadata", async () => {
  const raw = explanation();
  raw.truncated = true; raw.projection.graphScope = "page"; raw.projection.status = "partial";
  raw.sources = [{ ...source(1), version: 1, journalRef: ref("older-journal"), stateRef: ref("older-state") }];
  const result = await buildAgentMemoryTraceContext({ workspaceRoot: "/unused", scope: "current", events: [event] }, readers(raw).dependencies);
  expect(result.status).toBe("partial"); expect(result.truncated).toBe(true); expect(result.items).toEqual([]);
  expect(result.gaps).toContain("pinned-cut-source-not-in-page"); expect(result.gaps).not.toContain("source-metadata-invalid");
});
