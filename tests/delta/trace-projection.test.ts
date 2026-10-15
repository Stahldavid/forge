import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DeltaStore } from "../../src/forge/delta/store.ts";
import { shutdownDeltaBroker } from "../../src/forge/delta/broker.ts";
import { explainDeltaTrace, traceProjectionDigest, type TraceProjectionBatch, type TraceProjectionFact } from "../../src/forge/delta/trace-projection.ts";

const runKey = { repositoryId:"repo-A",checkoutId:"checkout-A",fabricStoreId:"store-A",runId:"run-A" };
const ref = (value:string) => `sha256:${traceProjectionDigest(value)}`;
function fact(version=1): TraceProjectionFact {
  return {journalVersion:version,journalRef:ref(`journal-${version}`),stateRef:ref(`state-${version}`),factKind:"run-state",factIdentity:"run-A",sourceDigest:traceProjectionDigest({version}),entities:[{id:"run-A",kind:"run",data:{observedStatus:version===1?"running":"applied"}},{id:"origin-A",kind:"origin",data:{transcriptStored:false}},{id:"candidate-A",kind:"candidate",data:{candidateId:"candidate-A",path:"src/sample.ts"}}],relations:[{from:"run-A",to:"origin-A",predicate:"requested-by",provenance:{capture:"fixture-observed",claimKind:"declared",authority:"none"}}]};
}
function batch(version=1,generationId="gen-A"): TraceProjectionBatch {return {generationId,runKey,cut:{version,journalRef:ref(`journal-${version}`),stateRef:ref(`state-${version}`)},facts:[fact(version)],...(version>1?{previous:{version:version-1,journalRef:ref(`journal-${version-1}`),stateRef:ref(`state-${version-1}`)}}:{})};}
async function fixture(body:(store:DeltaStore,root:string)=>Promise<void>) {
  const root=mkdtempSync(join(tmpdir(),"forge-trace-delta-")); let store:DeltaStore|undefined;
  const prior=process.env.FORGE_DELTA_BACKGROUND_DRAIN; process.env.FORGE_DELTA_BACKGROUND_DRAIN="0";
  try {store=await DeltaStore.open(root); await store.traceCreateGeneration({generationId:"gen-A",extractorVersion:"trace-v1"}); await body(store,root);}
  finally {await store?.close(); await shutdownDeltaBroker(root); rmSync(root,{recursive:true,force:true}); if(prior===undefined)delete process.env.FORGE_DELTA_BACKGROUND_DRAIN;else process.env.FORGE_DELTA_BACKGROUND_DRAIN=prior;}
}

describe("trace projection through the single Delta broker",()=>{
  test("atomic ledger replay, distinct occurrences and same relation support",async()=>fixture(async(store)=>{
    expect((await store.traceProjectBatch(batch())).inserted).toBe(1);
    const initial=await store.traceStatus("gen-A");
    expect((await store.traceProjectBatch(batch())).replayed).toBe(1);
    expect((await store.traceStatus("gen-A")).counts).toEqual(initial.counts);
    const second=batch(2); second.facts.push({...fact(2),factIdentity:"distinct-occurrence"});
    await store.traceProjectBatch(second);
    const status=await store.traceStatus("gen-A");
    expect(status.counts.sources).toBe(3); expect(status.counts.logicalRelations).toBe(1); expect(status.counts.relations).toBe(3);
    await store.traceActivateGeneration({generationId:"gen-A",cuts:[{runKey,cut:second.cut}]});
    expect((await store.traceExplain({runKey}) as {execution:{observedStatus:string}}).execution.observedStatus).toBe("applied");
    expect((await store.traceExplain({runKey,atVersion:1}) as {execution:{observedStatus:string}}).execution.observedStatus).toBe("running");
  }),30000);
  test("same occurrence digest conflict and incompatible cursor never advance checkpoint",async()=>fixture(async(store)=>{
    await store.traceProjectBatch(batch());
    const conflict=batch();conflict.facts[0]!.sourceDigest="f".repeat(64);
    await expect(store.traceProjectBatch(conflict)).rejects.toMatchObject({code:"TRACE_SOURCE_CONFLICT"});
    const wrong=batch(2);wrong.previous!.journalRef=ref("other-journal");
    await expect(store.traceProjectBatch(wrong)).rejects.toMatchObject({code:"TRACE_VERSION_CONFLICT"});
    const status=await store.traceStatus("gen-A");expect(status.counts.sources).toBe(1);expect(status.cuts[0]!.cut.version).toBe(1);expect(status.counts.issues).toBe(2);
  }),30000);
  test("interrupted batch rolls back entities, ledger, relations and checkpoint together",async()=>fixture(async(store)=>{
    await store.traceProjectBatch(batch()); const before=await store.traceStatus("gen-A");
    const interrupted=batch(2);interrupted.faultBeforeCommit=true;
    await expect(store.traceProjectBatch(interrupted)).rejects.toMatchObject({code:"TRACE_FIXTURE_INTERRUPTED"});
    expect((await store.traceStatus("gen-A")).counts).toEqual(before.counts);expect((await store.traceStatus("gen-A")).cuts).toEqual(before.cuts);
    await store.traceProjectBatch(batch(2));expect((await store.traceStatus("gen-A")).cuts[0]!.cut.version).toBe(2);
  }),30000);
  test("runKey isolates colliding run IDs and rebuild generation switch is atomic",async()=>fixture(async(store)=>{
    const operation=await store.appendOperation({kind:"fixture.event",data:{fixture:true}});
    const memory=await store.recordAgentMemoryEvent({envelope:{schema:"forge.agent-event.v1",source:{agent:"codex",integration:"manual-import",version:"1"},workspace:{root:"fixture"},session:{externalSessionId:"external-session",turnId:"turn-A"},event:{kind:"session.started",timestamp:"2026-10-15T00:00:00.000Z"},actor:{kind:"agent",name:"fixture"},payload:{status:"started"},privacy:{rawPromptStored:false,rawCompletionStored:false,rawToolArgsStored:false,transcriptImported:false,redacted:true,sensitiveFieldsRemoved:[]},capture:{trustLevel:"manual-import",confidence:1}}});
    expect(await store.traceReadAgentMemoryEvent(memory.id)).toMatchObject({id:memory.id,externalSessionId:"external-session",externalTurnId:"turn-A",integrationKind:"manual-import"});
    const memoryBefore=await store.listAgentMemoryEvents();
    await store.traceProjectBatch(batch());
    const other=batch();other.runKey={...runKey,fabricStoreId:"store-B"};await store.traceProjectBatch(other);
    expect((await store.traceStatus("gen-A")).cuts).toHaveLength(2);
    await store.traceActivateGeneration({generationId:"gen-A",cuts:[{runKey,cut:batch().cut},{runKey:other.runKey,cut:other.cut}]});
    await store.traceCreateGeneration({generationId:"gen-B",extractorVersion:"trace-v2"});
    await expect(store.traceActivateGeneration({generationId:"gen-B",cuts:[{runKey,cut:batch().cut}]})).rejects.toMatchObject({code:"TRACE_VERSION_CONFLICT"});
    expect((await store.traceStatus()).generationId).toBe("gen-A");
    const rebuilt=batch(1,"gen-B"); await store.traceProjectBatch(rebuilt);
    await store.traceActivateGeneration({generationId:"gen-B",cuts:[{runKey,cut:rebuilt.cut}]});
    expect((await store.traceStatus()).generationId).toBe("gen-B");expect((await store.traceStatus("gen-A")).status).toBe("retired");
    expect((await store.timeline({})).some((event)=>event.id===operation)).toBe(true);
    expect(await store.listAgentMemoryEvents()).toEqual(memoryBefore);
    expect(await store.traceReadAgentMemoryEvent("missing-event")).toBeNull();
    await expect(store.traceCreateGeneration({generationId:"gen-B",extractorVersion:"trace-v3"})).rejects.toMatchObject({code:"TRACE_SOURCE_CONFLICT"});
  }),30000);
  test("query absent store creates no database or endpoint",async()=>{
    const root=mkdtempSync(join(tmpdir(),"forge-trace-readonly-"));
    try {const output=await explainDeltaTrace(root,{runKey});expect(output).toMatchObject({projection:{status:"unavailable"}});expect(existsSync(join(root,".forge"))).toBe(false);}
    finally {rmSync(root,{recursive:true,force:true});}
  });
  test("unknown fields, absolute paths, traversal and secret payloads are refused before persistence",async()=>fixture(async(store)=>{
    for (const payload of [{token:"canary-secret"},{path:"../../escape"},{path:"/absolute/path"},{path:"https://host/private"},{status:"ghp_CANARYtraceSecret999999"},{path:"private/sk-CANARYtraceSecret.txt"}]) {
      const invalid=batch();invalid.facts[0]!.entities![0]!.data=payload as never;
      await expect(store.traceProjectBatch(invalid)).rejects.toMatchObject({code:"TRACE_INVALID_REFERENCE"});
    }
    const unknown=batch();(unknown.facts[0] as unknown as Record<string,unknown>).payload={secret:"canary"};
    await expect(store.traceProjectBatch(unknown)).rejects.toMatchObject({code:"TRACE_INVALID_REFERENCE"});
    expect((await store.traceStatus("gen-A")).counts.sources).toBe(0);
  }),30000);
  test("read-only query preserves a stale broker receipt without cleanup",async()=>fixture(async(store,root)=>{
    await store.traceProjectBatch(batch());
    const endpointPath=join(root,".forge","delta","broker-endpoint.json");
    const prior=readFileSync(endpointPath); const dead=JSON.parse(prior.toString("utf8")) as {pid:number};
    dead.pid=2147483647; const bytes=Buffer.from(JSON.stringify(dead));writeFileSync(endpointPath,bytes);
    try {expect(await explainDeltaTrace(root,{runKey})).toMatchObject({projection:{status:"unavailable"}});expect(readFileSync(endpointPath)).toEqual(bytes);}
    finally {writeFileSync(endpointPath,prior);}
  }),30000);
  test("a baseline Git stamp does not turn an absent commit into an observation",async()=>fixture(async(store)=>{
    const b=batch();b.facts[0]!.entities!.push({id:"stamp-A",kind:"git-observation",data:{observation:"not-observed",contentMatch:"not-evaluated"}});
    await store.traceProjectBatch(b);
    expect(await store.traceExplain({runKey,generationId:"gen-A"})).toMatchObject({git:{observation:"not-observed",contentMatch:"not-evaluated"}});
  }),30000);
  test("indivisible oversized facts return an explicit limit instead of a stalled cursor",async()=>fixture(async(store)=>{
    const b=batch(); const paths=Array.from({length:100},(_,i)=>`src/${i}-${"x".repeat(990)}`);
    b.facts[0]!.entities=Array.from({length:5},(_,i)=>({id:`large-${i}`,kind:"candidate",data:{paths}}));
    await store.traceProjectBatch(b);
    await expect(store.traceExplain({runKey,generationId:"gen-A"})).rejects.toMatchObject({code:"TRACE_LIMIT_EXCEEDED"});
  }),30000);
  test("bounded query reports truncation and pagination, never global freshness",async()=>fixture(async(store)=>{
    const b=batch(); b.facts.push({...fact(),factIdentity:"second"});await store.traceProjectBatch(b);
    const output=await store.traceExplain({runKey,generationId:"gen-A",limit:1});
    expect(output).toMatchObject({projection:{status:"partial"},truncated:true,nextOffset:1});
    const next=await store.traceExplain({runKey,generationId:"gen-A",limit:1,offset:1});
    expect(next).toMatchObject({projection:{status:"partial",graphScope:"page"},truncated:false});
  }),30000);
});

function scopedFacts(): TraceProjectionFact[] {
  return ["A", "B"].map((suffix, index) => ({ ...fact(), factIdentity: `scope-${suffix}`, entities: [
    { id: `candidate-${suffix}`, kind: "candidate", data: { candidateId: `candidate-${suffix}`, candidateDigest: ref(`candidate-${suffix}`), paths: [`src/${suffix}.ts`] } },
    { id: `delta-${suffix}`, kind: "delta", data: { paths: [`src/${suffix}.ts`] } },
    { id: `annotation-${suffix}`, kind: "annotation", data: { annotationRef: ref(`annotation-${suffix}`), result: "git-observation" } },
    { id: `git-${suffix}`, kind: "git-observation", data: { annotationRef: ref(`annotation-${suffix}`), candidateDigest: ref(`candidate-${suffix}`), paths: [`src/${suffix}.ts`], observation: "observed", commitOid: suffix.toLowerCase().repeat(40), contentMatch: index ? "differs" : "matches" } },
    { id: "run-A", kind: "run", data: { observedStatus: "applied" } },
    { id: "attempt-shared", kind: "attempt" },
  ], relations: [
    { from: `candidate-${suffix}`, to: "run-A", predicate: "candidate-of", provenance: { capture: "fabric-journal", claimKind: "observed", authority: "none" } },
    { from: `candidate-${suffix}`, to: `delta-${suffix}`, predicate: "includes-delta", provenance: { capture: "fabric-journal", claimKind: "observed", authority: "none" } },
    { from: `candidate-${suffix}`, to: "attempt-shared", predicate: "produced-by", provenance: { capture: "fabric-journal", claimKind: "observed", authority: "none" } },
    { from: `annotation-${suffix}`, to: `git-${suffix}`, predicate: "records", provenance: { capture: "host-reported", claimKind: "declared", authority: "none" } },
    { from: `git-${suffix}`, to: `candidate-${suffix}`, predicate: "contains-candidate-content", provenance: { capture: "git-objects", claimKind: "observed", authority: "none" } },
  ] }));
}
function projected(value: Awaited<ReturnType<DeltaStore["traceExplain"]>>) {
  if (!("entities" in value)) throw new Error("Expected fixture graph");
  return value;
}

test("candidate and file filters return closed target graphs with their own Git evidence", async () => fixture(async store => {
  const b = batch(); b.facts = scopedFacts(); await store.traceProjectBatch(b);
  for (const filter of [{ candidateId: "candidate-A" }, { path: "src/A.ts" }, { candidateId: "candidate-A", path: "src/A.ts" }]) {
    const result = projected(await store.traceExplain({ runKey, generationId: "gen-A", ...filter }));
    expect(result).toMatchObject({ target: { match: "found-at-cut" }, projection: { graphScope: "target-at-cut" }, git: { observation: "observed", contentMatch: "matches", evidence: [{ commitOid: "a".repeat(40) }] } });
    const ids = new Set(result.entities.map(entity => entity.id));
    expect(ids.has("candidate-A")).toBe(true); expect(ids.has("candidate-B")).toBe(false); expect(ids.has("git-B")).toBe(false);
    expect(result.relations.every(({ relation }) => ids.has(relation.from) && ids.has(relation.to))).toBe(true);
    expect(result.sources.map(source => source.factIdentity)).toContain("scope-A");
    expect(result.sources.every(source => ["scope-A", "scope-B"].includes(source.factIdentity))).toBe(true);
  }
  expect(projected(await store.traceExplain({ runKey, generationId: "gen-A", candidateId: "candidate-B" })).git).toMatchObject({ contentMatch: "differs", evidence: [{ commitOid: "b".repeat(40) }] });
  for (const filter of [{ candidateId: "missing" }, { path: "src/missing.ts" }, { candidateId: "candidate-A", path: "src/B.ts" }]) {
    const result = projected(await store.traceExplain({ runKey, generationId: "gen-A", ...filter }));
    expect(result.entities).toEqual([]); expect(result.relations).toEqual([]); expect(result.sources).toEqual([]);
    expect(result).toMatchObject({ target: { match: "not-found" }, git: { observation: "not-observed", contentMatch: "not-evaluated", evidence: [] } });
    expect(result.gaps).toContain("target-not-found");
  }
}), 30000);

test("candidate IDs remain distinct even when candidate content digests are equal", async () => fixture(async store => {
  const b = batch(); b.facts = scopedFacts();
  b.facts[1]!.entities![0]!.data!.candidateDigest = ref("candidate-A");
  await store.traceProjectBatch(b);
  const result = projected(await store.traceExplain({ runKey, generationId: "gen-A", candidateId: "candidate-A" }));
  expect(result.entities.some(entity => entity.id === "candidate-B")).toBe(false);
  expect(result.relations.some(({ relation }) => relation.from === "candidate-B" || relation.to === "candidate-B")).toBe(false);
}), 30000);

test("partial pages never promote their subset to a current Git summary or declare an absent target", async () => fixture(async store => {
  const b = batch(); b.facts = scopedFacts(); await store.traceProjectBatch(b);
  const first = projected(await store.traceExplain({ runKey, generationId: "gen-A", candidateId: "candidate-A", limit: 1 }));
  expect(first).toMatchObject({ projection: { status: "partial", graphScope: "page" }, target: { match: "found-in-page" }, git: { observation: "unknown", contentMatch: "not-evaluated", summaryScope: "page" }, nextOffset: 1 });
  expect(first.git.evidence).toHaveLength(1);
  expect(first.gaps).toContain("git-summary-incomplete-page");
  const missing = projected(await store.traceExplain({ runKey, generationId: "gen-A", candidateId: "candidate-B", limit: 1 }));
  expect(missing).toMatchObject({ target: { match: "unknown-in-partial-result" }, git: { observation: "unknown", evidence: [] } });
  expect(missing.gaps).toContain("target-not-in-page"); expect(missing.gaps).not.toContain("target-not-found");
  const last = projected(await store.traceExplain({ runKey, generationId: "gen-A", candidateId: "candidate-B", limit: 1, offset: 1 }));
  expect(last).toMatchObject({ truncated: false, projection: { status: "partial" }, git: { observation: "unknown", contentMatch: "not-evaluated" } });
}), 30000);

test("corrections preserve historical evidence, explain replacements and cannot grant new Git or gate authority", async () => fixture(async store => {
  const b = batch(); b.facts = scopedFacts(); await store.traceProjectBatch(b);
  const update = batch(2); update.facts = [{ ...fact(2), factIdentity: "correction", entities: [
    { id: "correction-A", kind: "correction", data: { annotationRef: ref("correction-A"), supersedesRef: ref("annotation-A"), reason: "clarify evidence", replacementSummary: "a declaration only", replacementProducer: "fixture-controller" } },
  ], relations: [{ from: "correction-A", to: "annotation-A", predicate: "supersedes", provenance: { capture: "host-reported", claimKind: "declared", authority: "none" } }] }];
  await store.traceProjectBatch(update);
  const historical = projected(await store.traceExplain({ runKey, generationId: "gen-A", candidateId: "candidate-A", atVersion: 1 }));
  expect(historical.git.observation).toBe("observed"); expect(historical.corrections).toEqual([]);
  const current = projected(await store.traceExplain({ runKey, generationId: "gen-A", candidateId: "candidate-A" }));
  expect(current.corrections).toEqual([{ annotationRef: ref("correction-A"), supersedesRef: ref("annotation-A"), reason: "clarify evidence", replacement: { summary: "a declaration only", producer: "fixture-controller" }, claimKind: "declared", authority: "none", details: "available" }]);
  expect(current.entities.find(entity => entity.id === "annotation-A")?.data).toMatchObject({ superseded: true, supersededBy: [ref("correction-A")] });
  expect(current.git).toMatchObject({ observation: "unknown", contentMatch: "not-evaluated", evidence: [{ superseded: true, commitOid: "a".repeat(40) }] });
  expect(current.gaps).toContain("git-observation-superseded"); expect(current.execution.observedStatus).toBe("applied");
  expect(current.relations.filter(({ relation }) => relation.predicate === "supersedes").every(({ relation }) => relation.provenance.authority === "none")).toBe(true);
  const unchanged = projected(await store.traceExplain({ runKey, generationId: "gen-A", candidateId: "candidate-B" }));
  expect(unchanged.corrections).toEqual([]); expect(unchanged.git.observation).toBe("observed");
}), 30000);

test("older projected corrections stay explicitly incomplete and unsafe free text is refused", async () => fixture(async store => {
  const b = batch(); b.facts[0]!.entities!.push({ id: "old-correction", kind: "correction", data: { annotationRef: ref("old-correction"), supersedesRef: ref("old-annotation") } });
  await store.traceProjectBatch(b);
  const result = projected(await store.traceExplain({ runKey, generationId: "gen-A" }));
  expect(result.corrections[0]?.details).toBe("unavailable-in-generation"); expect(result.gaps).toContain("correction-details-unavailable");
  for (const summary of ["token=canary", "https://private.invalid/foo", "/private/source/file", "ghp_CANARYtraceSecret999999"]) {
    const invalid = batch(2); invalid.facts[0]!.entities = [{ id: "unsafe", kind: "correction", data: { replacementSummary: summary } }];
    await expect(store.traceProjectBatch(invalid)).rejects.toMatchObject({ code: "TRACE_INVALID_REFERENCE" });
  }
}), 30000);

test("legacy records links propagate supersession without invented correction details", async () => fixture(async store => {
  const b = batch(); b.facts = scopedFacts().slice(0, 1); delete b.facts[0]!.entities!.find(entity => entity.kind === "git-observation")!.data!.annotationRef;
  b.facts.push({ ...fact(), factIdentity: "legacy-correction", entities: [{ id: "legacy-correction", kind: "correction", data: { annotationRef: ref("legacy-correction"), supersedesRef: ref("annotation-A") } }], relations: [{ from: "legacy-correction", to: "annotation-A", predicate: "supersedes", provenance: { capture: "host-reported", claimKind: "declared", authority: "none" } }] });
  await store.traceProjectBatch(b);
  const result = projected(await store.traceExplain({ runKey, generationId: "gen-A", candidateId: "candidate-A" }));
  expect(result.git).toMatchObject({ observation: "unknown", contentMatch: "not-evaluated", evidence: [{ superseded: true }] });
  expect(result.corrections[0]?.details).toBe("unavailable-in-generation"); expect(result.gaps).toContain("correction-details-unavailable");
}), 30000);

test("correction chains expose superseded replacements while keeping every source", async () => fixture(async store => {
  const b = batch(); b.facts = scopedFacts().slice(0, 1);
  for (const suffix of ["first", "second"]) b.facts.push({ ...fact(), factIdentity: `correction-${suffix}`, entities: [{ id: `correction-${suffix}`, kind: "correction", data: { annotationRef: ref(`correction-${suffix}`), supersedesRef: ref(suffix === "first" ? "annotation-A" : "correction-first"), reason: "clarify", replacementSummary: `${suffix} declared replacement`, replacementProducer: "fixture-controller" } }], relations: [{ from: `correction-${suffix}`, to: suffix === "first" ? "annotation-A" : "correction-first", predicate: "supersedes", provenance: { capture: "host-reported", claimKind: "declared", authority: "none" } }] });
  await store.traceProjectBatch(b);
  const result = projected(await store.traceExplain({ runKey, generationId: "gen-A", candidateId: "candidate-A" }));
  expect(result.corrections).toHaveLength(2);
  expect(result.corrections.find(item => item.annotationRef === ref("correction-first"))).toMatchObject({ superseded: true, supersededBy: [ref("correction-second")] });
  expect(result.corrections.find(item => item.annotationRef === ref("correction-second"))?.replacement.summary).toBe("second declared replacement");
  expect(result.git.observation).toBe("unknown"); expect(result.sources).toHaveLength(3);
}), 30000);


test("file filters include verified Git directory scopes for the selected candidate", async () => fixture(async store => {
  const b = batch(); b.facts = scopedFacts();
  for (const item of b.facts) item.entities!.find(entity => entity.kind === "git-observation")!.data!.paths = ["src"];
  await store.traceProjectBatch(b);
  for (const filter of [{ path: "src/A.ts" }, { candidateId: "candidate-A", path: "src/A.ts" }]) {
    const result = projected(await store.traceExplain({ runKey, generationId: "gen-A", ...filter }));
    expect(result.git).toMatchObject({ observation: "observed", contentMatch: "matches", evidence: [{ commitOid: "a".repeat(40), paths: ["src"] }] });
    expect(result.entities.some(entity => entity.id === "git-B")).toBe(false);
  }
}), 30000);


test("a Git authorized file scope cannot lend another candidate observation to a file query", async () => fixture(async store => {
  const b = batch(); b.facts = scopedFacts();
  b.facts[1]!.entities!.find(entity => entity.kind === "git-observation")!.data!.paths = ["src/A.ts", "src/B.ts", "src/untouched.ts"];
  await store.traceProjectBatch(b);
  const result = projected(await store.traceExplain({ runKey, generationId: "gen-A", path: "src/A.ts" }));
  expect(result.git).toMatchObject({ contentMatch: "matches", evidence: [{ commitOid: "a".repeat(40) }] });
  expect(result.entities.some(entity => entity.id === "git-B")).toBe(false);
  const unknown = projected(await store.traceExplain({ runKey, generationId: "gen-A", path: "src/untouched.ts" }));
  expect(unknown).toMatchObject({ target: { match: "not-found" }, entities: [], git: { evidence: [] } });
}), 30000);

test("correcting one binding annotation never supersedes a shared primary memory event", async () => fixture(async store => {
  const b = batch(); b.facts[0]!.entities!.push(
    { id: "binding-A", kind: "annotation", data: { annotationRef: ref("binding-A") } },
    { id: "binding-B", kind: "annotation", data: { annotationRef: ref("binding-B") } },
    { id: "memory-event", kind: "agent-memory-event", data: { eventId: "event-A", memoryStoreId: "memory-A" } },
    { id: "correction", kind: "correction", data: { annotationRef: ref("correction"), supersedesRef: ref("binding-A"), reason: "clarify", replacementSummary: "a declared change", replacementProducer: "fixture-controller" } },
  );
  for (const from of ["binding-A", "binding-B"]) b.facts[0]!.relations!.push({ from, to: "memory-event", predicate: "records", provenance: { capture: "host-reported", claimKind: "declared", authority: "none" } });
  b.facts[0]!.relations!.push({ from: "correction", to: "binding-A", predicate: "supersedes", provenance: { capture: "host-reported", claimKind: "declared", authority: "none" } });
  await store.traceProjectBatch(b);
  const result = projected(await store.traceExplain({ runKey, generationId: "gen-A" }));
  expect(result.entities.find(entity => entity.id === "binding-A")?.data?.superseded).toBe(true);
  expect(result.entities.find(entity => entity.id === "binding-B")?.data?.superseded).toBeUndefined();
  expect(result.entities.find(entity => entity.id === "memory-event")?.data?.superseded).toBeUndefined();
  expect(result.agentMemory.bindings).toHaveLength(1);
}), 30000);


test("invalid present filters never silently widen a query to the complete run", async () => fixture(async store => {
  await store.traceProjectBatch(batch());
  for (const filter of [{ candidateId: "" }, { candidateId: false }, { path: "" }, { path: false }]) {
    await expect(store.traceExplain({ runKey, generationId: "gen-A", ...filter } as never)).rejects.toMatchObject({ code: "TRACE_INVALID_REFERENCE" });
  }
}), 30000);

test("unfiltered page unions preserve relation occurrences whose endpoints live on previous pages", async () => fixture(async store => {
  const b = batch();
  b.facts.push({ ...fact(), factIdentity: "second-occurrence", entities: [{ id: "run-A", kind: "run", data: { observedStatus: "running" } }] });
  await store.traceProjectBatch(b);
  const first = projected(await store.traceExplain({ runKey, generationId: "gen-A", limit: 1 }));
  const second = projected(await store.traceExplain({ runKey, generationId: "gen-A", limit: 1, offset: 1 }));
  expect(first.truncated).toBe(true); expect(second.truncated).toBe(false);
  expect(second.entities.some(entity => entity.id === "origin-A")).toBe(false);
  expect(second.relations).toHaveLength(1);
  const all = projected(await store.traceExplain({ runKey, generationId: "gen-A" }));
  const unionEntities = new Map([...first.entities, ...second.entities].map(entity => [entity.id, entity]));
  expect([...unionEntities.values()]).toEqual(all.entities);
  const supportKeys = [first, second].flatMap(page => page.relations.flatMap(edge => edge.evidence.map(evidence => evidence.sourceKey))).sort();
  expect(supportKeys).toEqual(all.relations.flatMap(edge => edge.evidence.map(evidence => evidence.sourceKey)).sort());
  expect(new Set(supportKeys).size).toBe(2);
}), 30000);

test("absent stores reject invalid present targets before unavailable fallbacks", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-invalid-trace-target-"));
  try {
    for (const filter of [{ candidateId: "" }, { candidateId: false }, { candidateId: 0 }, { candidateId: null }, { path: "" }, { path: false }, { path: 0 }, { path: null }]) {
      await expect(explainDeltaTrace(root, { runKey, ...filter } as never)).rejects.toMatchObject({ code: "TRACE_INVALID_REFERENCE" });
    }
    expect(existsSync(join(root, ".forge"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
