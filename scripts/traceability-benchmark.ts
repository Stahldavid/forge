/**
 * Explicit synthetic Delta trace benchmark and independent projection readback.
 * Invoke with Node + tsx and FORGE_FABRIC_TEST_MODE=1. No owner for a real project,
 * hooks, model/provider, network, publication or Git operation is used here.
 *
 * Default: --output /absolute/report.json (100/1,000/10,000 facts, 30 samples).
 * Quick smoke only: --smoke --output /absolute/smoke.json (10 facts, 3 samples).
 */
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { DeltaStore } from "../src/forge/delta/store.ts";
import { shutdownDeltaBroker } from "../src/forge/delta/broker.ts";
import { traceProjectionDigest, type TraceCut, type TraceEntityInput, type TraceProjectionBatch, type TraceProjectionFact, type TraceRelationInput } from "../src/forge/delta/trace-projection.ts";
import type { TraceRunKey } from "../src/forge/agent-fabric/trace-contract.ts";

export interface TraceBenchmarkOptions { output: string; volumes?: number[]; repetitions?: number; smoke?: boolean }
type Source = { sourceKey: string; digest: string; version: number; journalRef: string; stateRef: string; factKind: string; factIdentity: string };
type Evidence = { sourceKey: string; provenance: TraceRelationInput["provenance"] };
type Edge = { relation: TraceRelationInput; evidence: Evidence[] };
type Mirror = { sources: Source[]; entities: TraceEntityInput[]; edges: Edge[] };
interface Page { sources: Source[]; entities: TraceEntityInput[]; relations: Edge[]; truncated: boolean; nextOffset?: number }
const RUN_ID = "benchmark-run", ORIGIN_ID = "benchmark-origin", EXTRACTOR = "benchmark-recipe-v1";
const provenance = { capture: "fixture-observed", claimKind: "declared" as const, authority: "none" };
const canaries = ["CANARY_TRACE_FORBIDDEN_PAYLOAD_20261015", "/CANARY_TRACE_ABSOLUTE_PATH_20261015", "ghp_CANARY_TRACE_CREDENTIAL_20261015"];
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const digestRef = (domain: string, version: number) => `sha256:${traceProjectionDigest({ domain, version })}`;
const sourceDigest = (version: number) => traceProjectionDigest({ fixture: EXTRACTOR, version, result: "passed" });
const cut = (version: number): TraceCut => ({ version, journalRef: digestRef("journal",version), stateRef: digestRef("state",version) });
const attemptId = (version: number) => `attempt-${String(version).padStart(8,"0")}`;
const runKey = (volume: number): TraceRunKey => ({ repositoryId:"benchmark-repository",checkoutId:`checkout-${volume}`,fabricStoreId:`store-${volume}`,runId:RUN_ID });
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`TRACE_BENCHMARK_ASSERTION:${message}`); }
function assertSame(actual: unknown, expected: unknown, message: string): void { assert(traceProjectionDigest(actual) === traceProjectionDigest(expected),message); }
function expectedSource(key: TraceRunKey, version: number): Source {
  // This oracle uses the documented ledger occurrence identity, independently of
  // the extractor (which is neither imported nor called by this benchmark).
  const identity = `occurrence-${version}`, factsKind="fixture-observation";
  const keyString=JSON.stringify({checkoutId:key.checkoutId,fabricStoreId:key.fabricStoreId,repositoryId:key.repositoryId,runId:key.runId});
  return {sourceKey:traceProjectionDigest([keyString,version,factsKind,identity]),digest:sourceDigest(version),version,journalRef:digestRef("journal",version),stateRef:digestRef("state",version),factKind:factsKind,factIdentity:identity};
}
function fixtureFact(version: number, volume: number): TraceProjectionFact {
  const entities: TraceEntityInput[] = [
    {id:RUN_ID,kind:"run",data:{observedStatus:version===volume?"applied":"executing"}},
    {id:attemptId(version),kind:"attempt",data:{attemptId:attemptId(version),result:"passed"}},
  ];
  if (version===1) entities.push({id:ORIGIN_ID,kind:"origin",data:{sourceNamespace:"benchmark-fixture",transcriptStored:false}});
  return {journalVersion:version,journalRef:digestRef("journal",version),stateRef:digestRef("state",version),factKind:"fixture-observation",factIdentity:`occurrence-${version}`,sourceDigest:sourceDigest(version),entities,relations:[
    {from:attemptId(version),to:RUN_ID,predicate:"attempt-of",provenance},
    {from:RUN_ID,to:ORIGIN_ID,predicate:"requested-by",provenance},
  ]};
}
function fixtureBatch(volume: number, generationId: string, start: number, end: number): TraceProjectionBatch {
  return {generationId,runKey:runKey(volume),...(start>1?{previous:cut(start-1)}:{}),cut:cut(end),facts:Array.from({length:end-start+1},(_,i)=>fixtureFact(start+i,volume))};
}
function expectedCounts(volume: number) { return {sources:volume,entities:volume+2,relations:volume*2,issues:0,logicalRelations:volume+1}; }
function normalized(mirror: Mirror): Mirror {
  const sources=[...mirror.sources].sort((a,b)=>a.version-b.version);
  const entities=[...mirror.entities].sort((a,b)=>compare(a.id,b.id));
  const edges=mirror.edges.map(edge=>({relation:edge.relation,evidence:[...edge.evidence].sort((a,b)=>compare(a.sourceKey,b.sourceKey))})).sort((a,b)=>compare([a.relation.from,a.relation.to,a.relation.predicate,a.relation.qualifier??""].join("\0"),[b.relation.from,b.relation.to,b.relation.predicate,b.relation.qualifier??""].join("\0")));
  return {sources,entities,edges};
}
function oracle(volume: number): Mirror {
  const key=runKey(volume), sources=Array.from({length:volume},(_,i)=>expectedSource(key,i+1));
  const entities: TraceEntityInput[]=[{id:RUN_ID,kind:"run",data:{observedStatus:"applied"}},{id:ORIGIN_ID,kind:"origin",data:{sourceNamespace:"benchmark-fixture",transcriptStored:false}},...Array.from({length:volume},(_,i)=>({id:attemptId(i+1),kind:"attempt",data:{attemptId:attemptId(i+1),result:"passed"}}))];
  const edges: Edge[]=sources.map(source=>({relation:{from:attemptId(source.version),to:RUN_ID,predicate:"attempt-of",provenance},evidence:[{sourceKey:source.sourceKey,provenance}]}));
  edges.push({relation:{from:RUN_ID,to:ORIGIN_ID,predicate:"requested-by",provenance},evidence:sources.map(source=>({sourceKey:source.sourceKey,provenance}))});
  return normalized({sources,entities,edges});
}
function hashes(mirror: Mirror) { return {sources:traceProjectionDigest(mirror.sources),entities:traceProjectionDigest(mirror.entities),edges:traceProjectionDigest(mirror.edges),complete:traceProjectionDigest(mirror)}; }
async function readback(store: DeltaStore, volume: number, generationId: string): Promise<Mirror> {
  const sources: Source[]=[],entities=new Map<string,TraceEntityInput>(),edges=new Map<string,Edge>(); let offset=0;
  for (;;) {
    const page=await store.traceExplain({runKey:runKey(volume),generationId,limit:128,offset}) as Page;
    assert(Array.isArray(page.sources) && Array.isArray(page.entities) && Array.isArray(page.relations),"readback-page-shape");
    sources.push(...page.sources);for(const entity of page.entities)entities.set(entity.id,entity);
    for(const edge of page.relations){
      const identity=JSON.stringify([edge.relation.from,edge.relation.to,edge.relation.predicate,edge.relation.qualifier??""]);
      const prior=edges.get(identity);
      if(prior){assertSame(prior.relation,edge.relation,"relation-occurrence-disagrees");prior.evidence.push(...edge.evidence);}
      else edges.set(identity,{relation:edge.relation,evidence:[...edge.evidence]});
    }
    if(!page.truncated)break;
    assert(Number.isSafeInteger(page.nextOffset) && page.nextOffset!>offset,"readback-cursor-progress");offset=page.nextOffset!;
    assert(offset<=volume,"readback-cursor-bound");
  }
  assert(sources.length===volume && new Set(sources.map(item=>item.sourceKey)).size===volume,"readback-source-cardinality");
  return normalized({sources,entities:[...entities.values()],edges:[...edges.values()]});
}
async function timed<T>(body:()=>Promise<T>):Promise<{ms:number;value:T}>{const start=performance.now();const value=await body();return {ms:performance.now()-start,value};}
function distribution(values:number[]){const sorted=[...values].sort((a,b)=>a-b);const percentile=(fraction:number)=>sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)]!;return {samples:values.length,unit:"ms",method:"nearest-rank",p50:percentile(0.5),p95:percentile(0.95),min:sorted[0],max:sorted.at(-1),samplesMs:values};}
async function inventory(root:string):Promise<{bytes:number;allocatedBytes:number;files:number;canaryMatches:number;scanBytes:number}>{
  let bytes=0,allocatedBytes=0,files=0,canaryMatches=0,scanBytes=0;
  const visit=async(path:string):Promise<void>=>{for(const entry of await readdir(path,{withFileTypes:true})){const child=join(path,entry.name);if(entry.isDirectory())await visit(child);else if(entry.isFile()){const info=await stat(child);bytes+=info.size;allocatedBytes+=info.blocks*512;files++;const data=await readFile(child);scanBytes+=data.length;for(const marker of canaries)if(data.includes(Buffer.from(marker)))canaryMatches++;}}};
  await visit(root);return {bytes,allocatedBytes,files,canaryMatches,scanBytes};
}
function scanMetadata(value:unknown){const data=Buffer.from(JSON.stringify(value));return {bytes:data.length,knownCanaryMatches:canaries.reduce((n,marker)=>n+Number(data.includes(Buffer.from(marker))),0)};}
async function rejectionProbe(store:DeltaStore,volume:number,generationId:string){
  const codes:string[]=[];
  for(let i=0;i<canaries.length;i++){
    const input=fixtureBatch(volume,generationId,volume+1,volume+1);
    input.facts[0]!.entities![0]!.data=i===0?{payload:canaries[i]!}:i===1?{path:canaries[i]!}:{status:canaries[i]!};
    try{await store.traceProjectBatch(input);throw new Error("TRACE_BENCHMARK_ASSERTION:canary-was-accepted");}
    catch(error){const code=(error as {code?:string}).code;assert(code==="TRACE_INVALID_REFERENCE","canary-rejection-code");codes.push(code);}
  }
  return {rejectedInputs:codes.length,codes};
}
async function benchmarkCase(volume:number,repetitions:number,mirrorDirectory:string){
  const root=await mkdtemp(join(tmpdir(),"forge-trace-benchmark-"));let store:DeltaStore|undefined;
  const generationId="benchmark-generation-A",rebuildId="benchmark-generation-B";
  let result:Record<string,unknown>|undefined;
  try{
    const opened=await timed(()=>DeltaStore.open(root));store=opened.value;
    const empty=await store.traceStatus();assert(empty.status==="unavailable","fresh-store-is-empty");
    await store.traceCreateGeneration({generationId,extractorVersion:EXTRACTOR});
    const project=await timed(async()=>{let inserted=0;for(let start=1;start<=volume;start+=128){const reply=await store!.traceProjectBatch(fixtureBatch(volume,generationId,start,Math.min(volume,start+127)));inserted+=reply.inserted;}return inserted;});
    assert(project.value===volume,"initial-inserted-cardinality");
    await store.traceActivateGeneration({generationId,cuts:[{runKey:runKey(volume),cut:cut(volume)}]});
    const firstQuery=await timed(()=>store!.traceExplain({runKey:runKey(volume),limit:128}));
    const firstStatus=await timed(()=>store!.traceStatus());assertSame(firstStatus.value.counts,expectedCounts(volume),"initial-ledger-counts");
    const expected=oracle(volume),initial=await readback(store,volume,generationId),expectedHashes=hashes(expected);
    assertSame(hashes(initial),expectedHashes,"independent-initial-readback-hashes");
    const before=await store.traceStatus();const querySamples:number[]=[],statusSamples:number[]=[],replaySamples:number[]=[];
    const replayBatch=fixtureBatch(volume,generationId,Math.max(1,volume-127),volume);
    // One explicit warmup for each path, excluded from measured samples.
    await store.traceExplain({runKey:runKey(volume),limit:128});await store.traceStatus();await store.traceProjectBatch(replayBatch);
    for(let sample=0;sample<repetitions;sample++){
      querySamples.push((await timed(()=>store!.traceExplain({runKey:runKey(volume),limit:128}))).ms);
      statusSamples.push((await timed(()=>store!.traceStatus())).ms);
      const replay=await timed(()=>store!.traceProjectBatch(replayBatch));replaySamples.push(replay.ms);
      assert(replay.value.inserted===0 && replay.value.replayed===replayBatch.facts.length,"replay-logical-no-write");
    }
    const after=await store.traceStatus();assertSame(after.counts,before.counts,"replay-no-counter-changes");assertSame(after.cuts,before.cuts,"replay-no-checkpoint-changes");
    const rejections=await rejectionProbe(store,volume,generationId);assertSame((await store.traceStatus()).counts,before.counts,"rejections-leave-ledger-unchanged");
    await store.traceCreateGeneration({generationId:rebuildId,extractorVersion:EXTRACTOR});
    const rebuilt=await timed(async()=>{for(let start=1;start<=volume;start+=128)await store!.traceProjectBatch(fixtureBatch(volume,rebuildId,start,Math.min(volume,start+127)));return readback(store!,volume,rebuildId);});
    assertSame(hashes(rebuilt.value),expectedHashes,"independent-rebuild-readback-hashes");
    const rebuildStatus=await store.traceStatus(rebuildId);assertSame(rebuildStatus.counts,expectedCounts(volume),"rebuild-ledger-counts");
    assert((await store.traceStatus()).generationId===generationId,"rebuild-keeps-old-generation-active-until-switch");
    await store.traceActivateGeneration({generationId:rebuildId,cuts:[{runKey:runKey(volume),cut:cut(volume)}]});
    assert((await store.traceStatus()).generationId===rebuildId,"rebuild-atomic-activation");
    const final=await store.traceStatus(),metadata={schema:"forge.trace-benchmark-readback.v1",volume,runKey:runKey(volume),cut:cut(volume),expectedHashes,observedHashes:hashes(initial),rebuiltHashes:hashes(rebuilt.value),counts:final.counts,mirror:initial};
    const scanned=scanMetadata(metadata);assert(scanned.knownCanaryMatches===0,"exported-readback-has-no-known-canary");
    const mirrorFile=`traceability-readback-${volume}.json`;await writeFile(join(mirrorDirectory,mirrorFile),`${JSON.stringify(metadata)}\n`,{flag:"wx"});
    result={volume,repetitions,batchFacts:128,queryPageLimit:128,cold:{meaning:"first call in newly initialized fixture; operating-system caches not flushed",openBrokerAndSchemaMs:opened.ms,firstQueryMs:firstQuery.ms,firstStatusMs:firstStatus.ms},projection:{ms:project.ms,factsPerSecond:volume/(project.ms/1000),inserted:project.value},warm:{query:distribution(querySamples),status:distribution(statusSamples),replay:distribution(replaySamples)},replay:{scopeFacts:replayBatch.facts.length,inserted:0,replayedPerSample:replayBatch.facts.length,countsBefore:before.counts,countsAfter:after.counts,checkpointsUnchanged:true,meaning:"no logical ledger/entity/relation/checkpoint writes; database housekeeping is not asserted byte-identical"},independentReadback:{oracle:"algebraic fixture recipe; no Fabric extractor imported",expectedCounts:expectedCounts(volume),observedCounts:final.counts,expectedHashes,observedHashes:hashes(initial),rebuiltHashes:hashes(rebuilt.value),rebuildMs:rebuilt.ms,allCompared:true,mirrorFile},privacy:{rejections,exportedMetadata:scanned,limitations:"Only the listed known fixture canaries are searched. This is not proof of universal secret absence."}};
    await store.close();store=undefined;await shutdownDeltaBroker(root);
    const physical=await inventory(root);assert(physical.canaryMatches===0,"physical-fixture-has-known-canary");
    result.storage={...physical,meaning:"closed synthetic fixture logical file bytes and allocated blocks, including both generations and database internals; not production sizing"};
    return result;
  }finally{await store?.close();await shutdownDeltaBroker(root);await rm(root,{recursive:true,force:true});}
}
export async function runTraceabilityBenchmark(options:TraceBenchmarkOptions){
  assert(process.env.FORGE_FABRIC_TEST_MODE==="1","explicit-fixture-mode-required");
  assert(isAbsolute(options.output),"absolute-output-required");
  const volumes=options.volumes??(options.smoke?[10]:[100,1000,10000]),repetitions=options.repetitions??(options.smoke?3:30);
  assert(volumes.length>0&&volumes.length<=10&&volumes.every(v=>Number.isSafeInteger(v)&&v>=1&&v<=10000)&&new Set(volumes).size===volumes.length,"volume-bounds");
  assert(Number.isSafeInteger(repetitions)&&repetitions>=1&&repetitions<=100,"repetition-bounds");
  const output=resolve(options.output),mirrorDirectory=join(dirname(output),`${basename(output,".json")}-readback`);
  await mkdir(dirname(output),{recursive:true});await mkdir(mirrorDirectory,{recursive:true});
  const oldDrain=process.env.FORGE_DELTA_BACKGROUND_DRAIN;process.env.FORGE_DELTA_BACKGROUND_DRAIN="0";
  const started=performance.now();
  try{
    const cases:Record<string,unknown>[]=[];
    for(const volume of volumes){process.stderr.write(`traceability benchmark: ${volume} facts, ${repetitions} warm samples\n`);cases.push(await benchmarkCase(volume,repetitions,mirrorDirectory));}
    const report={schema:"forge.trace-benchmark.v1",mode:options.smoke?"smoke":"benchmark",runtime:{node:process.version,platform:process.platform,arch:process.arch},volumes,repetitions,totalMs:performance.now()-started,fixturesRemoved:true,boundaries:{syntheticBrokerOnly:true,backgroundQueueDrain:false,realHooksActivated:false,providersInvoked:false,networkRequests:false,push:false,deploy:false,gitOperations:false},measurementLimits:["Local synthetic PGlite/broker workload, not end-to-end Fabric scheduling or production acceptance.","Warm query latency covers a bounded 128-fact page; full graph readback is separately verified.","No OS cache eviction. Cold labels describe first calls in a fresh fixture.","Replay guarantees logical projection cardinality and checkpoint stability, not identical database housekeeping bytes.","Physical scan searches exact known fixture canaries in closed fixture bytes; compressed representations or unknown secrets are outside its assurance."],cases};
    assert(scanMetadata(report).knownCanaryMatches===0,"report-has-known-canary");await writeFile(output,`${JSON.stringify(report,null,2)}\n`,{flag:"wx"});return report;
  }finally{if(oldDrain===undefined)delete process.env.FORGE_DELTA_BACKGROUND_DRAIN;else process.env.FORGE_DELTA_BACKGROUND_DRAIN=oldDrain;}
}
function cliOptions(argv:string[]):TraceBenchmarkOptions{
  let output:string|undefined,smoke=false,volumes:number[]|undefined,repetitions:number|undefined;
  for(let i=0;i<argv.length;i++){
    const arg=argv[i]!;
    if(arg==="--output")output=argv[++i];else if(arg==="--smoke")smoke=true;else if(arg==="--volumes")volumes=argv[++i]?.split(",").map(Number);else if(arg==="--repetitions")repetitions=Number(argv[++i]);else throw new Error("TRACE_BENCHMARK_UNKNOWN_ARGUMENT");
  }
  assert(output,"output-argument-required");return {output,...(smoke?{smoke}:{}),...(volumes?{volumes}:{}),...(repetitions===undefined?{}:{repetitions})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  runTraceabilityBenchmark(cliOptions(process.argv.slice(2))).then(report=>{process.stdout.write(`${JSON.stringify({schema:report.schema,mode:report.mode,volumes:report.volumes,repetitions:report.repetitions,totalMs:report.totalMs,allCompared:true})}\n`);}).catch(error=>{process.stderr.write(`${error instanceof Error?error.message:"TRACE_BENCHMARK_FAILED"}\n`);process.exitCode=1;});
}
