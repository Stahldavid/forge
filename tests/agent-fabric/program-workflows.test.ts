import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProgramRunService } from "../../src/forge/agent-fabric/program-service.ts";
import { ProgramFileLease } from "../../src/forge/agent-fabric/program-lock.ts";
import { validateVisualPopulation } from "../../src/forge/agent-fabric/program-evidence.ts";
import { lowerWorkflowSource } from "../../src/forge/agent-fabric/program-dsl.ts";
import { ProgramActivityScheduler } from "../../src/forge/agent-fabric/program-scheduler.ts";
import { canonicalItemKey, programSegment } from "../../src/forge/agent-fabric/program-structure.ts";
import { programImage } from "../../src/forge/agent-fabric/program-image.ts";
import { programDigest, validateWorkflowProgram, type ProgramRegistry, type ProgramRunV2, type ProgramAssessmentContext } from "../../src/forge/agent-fabric/program-contract.ts";
import { defineWorkflow, schemaRef, executorRef, policyRef, acceptanceRef, populationRef, recipeRef, agent, value, map, sequence, parallel, subworkflow, programRef, workflowInput, loop, loopState, waitEvent, repair, compose, gate, field, item, output, object, coverageFor, population, candidateFromBaseline, acceptedCandidates, acceptedCandidate, outputCandidate, coverageReceipt, acceptance, type WorkflowOptions } from "../../src/forge/agent-fabric/program-dsl.ts";
import type { ProgramWorkerAdapter, ProgramWorkerInput, ProgramWorkerResult } from "../../src/forge/agent-fabric/program-worker.ts";
import { runTypedCodexWorker } from "../../src/forge/agent-fabric/codex-sdk-worker.ts";

const resources: { root: string; service: ProgramRunService }[] = [];
afterEach(async () => { for (const resource of resources.splice(0)) { await resource.service.close(); await rm(resource.root, { recursive: true, force: true }); } }, 30000);
const sleep = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGfoAAAAASUVORK5CYII=", "base64");
async function fixture(handler?: (input: ProgramWorkerInput) => Promise<ProgramWorkerResult> | ProgramWorkerResult, members: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), "forge-workflows-"));
  const registry: ProgramRegistry = { schemas: { "any@v2": {} }, executors: {}, policies: {}, acceptance: {}, populations: {} };
  for (const id of ["read", "implement", "review", "local-check", "global-check", "capture"]) registry.executors[`${id}@v2`] = { id, version: "v2", kind: "command", effect: id === "implement" ? "isolated-write" : "read", role: id === "implement" ? "implementer" : id === "review" ? "reviewer" : "investigator", argv: [process.execPath, "-e", "console.log('{}')"], timeoutMs: 5000, writeScope: id === "implement" ? ["src"] : [], network: "host", isolation: "cooperative", schema: schemaRef("any", "v2") };
  registry.policies["local@v2"] = { id: "local", version: "v2", maxItems: 100, concurrency: 4, maxAttempts: 1000, maxOperations: 2000, maxDepth: 12, deadlineMs: 30000, maxOutputBytes: 4 * 1024 * 1024, writeScope: ["src"], executors: Object.keys(registry.executors), allowCooperativeCommands: true, allowNetwork: true };
  registry.acceptance["goal@v2"] = { id: "goal", version: "v2", criteria: ["fixture"], writeScope: ["src"], requiredChecks: [], requireReview: false, allowNoWork: false, allowPartial: true };
  registry.populations["uis@v2"] = { id: "uis", version: "v2", members, exclusions: [], baselineDigest: programDigest({ root }), evidence: "owner fixture inventory", allowNoWork: false };
  const calls: ProgramWorkerInput[] = [], prepares: ProgramWorkerInput[] = [];
  const adapter: ProgramWorkerAdapter = async input => { prepares.push(input); return { directory: root, inputDigest: programDigest(input.data), async execute() {
    calls.push(input); if (handler) return handler(input); return { outcome: "completed", data: input.executor.id === "review" ? { verdict: "approved", findings: [], coveredObligationIds: (input.data as { assessmentContext?: ProgramAssessmentContext }).assessmentContext?.obligationIds ?? [] } : input.executor.id.endsWith("check") ? { passed: true } : input.data };
  } }; };
  const service = await ProgramRunService.open(root, registry, adapter); resources.push({ root, service }); return { root, registry, adapter, service, calls, prepares };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function workflow(steps: Parameters<typeof defineWorkflow>[0]["steps"], result: unknown, mode: "data" | "candidate" = "data") {
  return defineWorkflow({ id: "workflow", version: 1, operatorVersion: 2, mode, inputSchema: schemaRef("any", "v2"), outputSchema: schemaRef("any", "v2"), policy: policyRef("local", "v2"), acceptance: acceptanceRef("goal", "v2"), steps, result });
}
async function finish(f: Fixture, runId: string): Promise<ProgramRunV2> { for (let count=0;count<4000;count++) { const state = await f.service.store.read(runId); if (state!.status !== "executing") { await sleep(10); if ((await f.service.store.read(runId))!.status !== "executing") return (await f.service.store.read(runId))!; } await sleep(); } throw new Error("Workflow fixture did not settle"); }
async function start(f: Fixture, program: ReturnType<typeof workflow>, requestId="start") { const state = await f.service.execute("program-start", { requestId, program, input: {} }) as ProgramRunV2; return finish(f,state.runId); }
async function control(f: Fixture, action: Parameters<ProgramRunService["execute"]>[0], request: Record<string,unknown>): Promise<ProgramRunV2> { for(let count=0;count<100;count++) { const state = (await f.service.store.read(String(request.runId)))!; try { return await f.service.execute(action,{...request,expectedVersion:state.version}) as ProgramRunV2; } catch(error) { if ((error as {code?:string}).code !== "AF_PROGRAM_CONFLICT") throw error; await sleep(); } } throw new Error("Control CAS did not settle"); }
const read = (id: string, options: Partial<WorkflowOptions["agent"]> = {}) => agent(id,{executor:executorRef("read","v2"),input:{id},...options});
const repairOptions = (): WorkflowOptions["repair"] => ({ recipe: recipeRef("repair","v2"), implement: executorRef("implement","v2"), review: executorRef("review","v2"), checks: ["local-check@v2"], entryMode: "assess-first", initialCandidate: candidateFromBaseline(), writeScope:["src"], maxRepairRounds:3,maxAssessmentAttempts:5,maxInfrastructureAttempts:2,progressPolicy:{unchangedCandidateRounds:2,repeatedFindingsRounds:2} });

describe("workflow graph, scopes and durable continuation", () => {
  test("T01 independent roots overlap; data and after both wait",async()=>{
    let active=0, peak=0; const done:string[]=[];let release=()=>{};const started=new Promise<void>(resolve=>{release=resolve;});
    const f=await fixture(async input=>{active++;peak=Math.max(peak,active);const id=String((input.data as {id:string}).id);if(id!=="c"){if(active===2)release();await started;}done.push(id);active--;return{outcome:"completed",data:input.data};});
    const run=await start(f,workflow([read("a"),read("b"),read("c",{after:["a","b"]})],output("c")));
    expect(run.status).toBe("completed");expect(peak).toBe(2);expect(done.at(-1)).toBe("c");
  });
  test("T02/T03 sequence enforces control; forward reference cycle rejected",async()=>{
    const f=await fixture(); const run=await start(f,workflow([sequence("ordered",{steps:[read("a"),read("b")],result:output("b")})],output("ordered")));
    expect(run.status).toBe("completed");expect(f.calls.map(call=>(call.data as {id:string}).id)).toEqual(["a","b"]);
    expect(()=>validateWorkflowProgram(workflow([sequence("cycle",{steps:[value("a",{value:output("b")}),value("b",{value:1})],result:output("b")})],output("cycle")),f.registry)).toThrow("cycle");
  });
  test("Block result external dependency cycles reject before dispatch",async()=>{
    const f=await fixture();const program=workflow([parallel("scope",{steps:[value("inside",{value:1})],result:output("outside"),onFailure:"collect-all"}),value("outside",{value:output("scope")})],output("scope"));
    expect(()=>validateWorkflowProgram(program,f.registry)).toThrow("cycle");expect(f.calls).toHaveLength(0);
  });
  test("data quorum does not confuse user status with runtime outcome",async()=>{
    const f=await fixture();const run=await start(f,workflow([map("data",{items:[{id:"a"}],key:field(item(),"id"),completion:"quorum",quorum:{minAccepted:1},body:value("result",{value:{status:"failed",description:"user data"}})})],output("data")));
    expect(run.status).toBe("completed");expect(await f.service.store.get(run.resultRef!)).toHaveProperty("items.0.outcome","completed");
  });
  test("Block result fields are type-checked inside map before dispatch",async()=>{
    const f=await fixture();const program=workflow([map("items",{items:[{id:"a"}],key:field(item(),"id"),completion:"all-required",body:{steps:[value("data",{value:{valid:1}})],result:field(output("data"),"missing")}})],output("items"));
    expect(()=>validateWorkflowProgram(program,f.registry)).toThrow("Field absent");expect(f.calls).toHaveLength(0);
  });
  test("T04/T39 collect-all preserves sibling but never evaluates failed output",async()=>{
    const f=await fixture(input=>input.executor.id==="read"&&(input.data as {id:string}).id==="bad"?{outcome:"infrastructure_failed",reason:"fixture failure"}:{outcome:"completed",data:input.data});
    const run=await start(f,workflow([parallel("scope",{steps:[read("good"),read("bad")],onFailure:"collect-all",result:object({good:output("good"),bad:output("bad")})})],output("scope")));
    expect(run.status).toBe("needs-attention");expect(run.operations["scope/good"].status).toBe("completed");expect(run.scopeResults!.scope.status).toBe("failed");expect(run.resultRef).toBeUndefined();
    expect(await f.service.execute("program-explain",{runId:run.runId})).toHaveProperty("scopes");expect(await f.service.execute("program-explain",{runId:run.runId})).toHaveProperty("graph.mermaid");
  });
  test("T05 cancel-siblings requests stop and observes uncertainty",async()=>{
    const f=await fixture(async input=>{if((input.data as {id:string}).id==="bad"){await sleep(20);return{outcome:"infrastructure_failed",reason:"stop"};}await new Promise<void>(resolve=>input.signal.addEventListener("abort",()=>resolve(),{once:true}));return{outcome:"uncertain",reason:"process effect unknown"};});
    const run=await start(f,workflow([parallel("scope",{steps:[read("bad"),read("slow")],onFailure:"cancel-siblings",result:output("slow")})],output("scope")));
    expect(run.status).toBe("needs-attention");expect(Object.values(run.attempts).some(attempt=>attempt.outcome==="uncertain")).toBe(true);expect(run.gateRef).toBeUndefined();
  });
  test("T06 scope concurrency counts nested activities, not parent slots",async()=>{
    let active=0,peak=0; const f=await fixture(async input=>{active++;peak=Math.max(peak,active);await sleep(10);active--;return{outcome:"completed",data:input.data};});
    const run=await start(f,workflow([map("items",{items:[{id:"a"},{id:"b"}],key:field(item(),"id"),completion:"all-required",concurrency:1,body:parallel("nested",{steps:[read("a"),read("b")],onFailure:"collect-all",result:output("b")})})],output("items")));
    expect(run.status).toBe("completed");expect(peak).toBe(1);expect(f.calls).toHaveLength(4);
  });
  test("subworkflows inherit ancestor activity quota and lexical item identity",async()=>{
    let active=0,peak=0;
    const f=await fixture(async input=>{peak=Math.max(peak,++active);await sleep(30);active--;return{outcome:"completed",data:input.data};});
    f.registry.programs={"child@v2":workflow([read("one",{input:item()}),read("two",{input:workflowInput()})],object({item:output("one"),input:output("two")}))};
    const run=await start(f,workflow([map("items",{items:[{id:"a"},{id:"b"}],key:field(item(),"id"),completion:"all-required",concurrency:1,body:subworkflow("child",{program:programRef("child","v2"),input:{explicit:true}})})],output("items")));
    expect(run.reason).toBeUndefined();expect(run.status).toBe("completed");expect(peak).toBe(1);
    expect(f.calls.filter(call=>"id" in (call.data as object)).map(call=>call.data).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual([{id:"a"},{id:"b"}]);expect(f.calls.filter(call=>"explicit" in (call.data as object)).map(call=>call.data)).toEqual([{explicit:true},{explicit:true}]);
    expect(Object.values(run.attempts).every(attempt=>attempt.reservation?.scopes.some(scope=>scope.limit===1))).toBe(true);
  });
  test("subworkflow preflight and runtime preserve lexical item and loop state",async()=>{
    const f=await fixture();f.registry.programs={"child@v2":workflow([value("copy",{value:object({item:field(item(),"id"),state:loopState(),input:workflowInput()})})],output("copy"))};
    const program=workflow([map("items",{items:[{id:"a"}],key:field(item(),"id"),completion:"all-required",body:loop("round",{initialState:{round:0},maxRounds:1,body:subworkflow("child",{program:programRef("child","v2"),input:{explicit:true}}),next:output("child"),until:true})})],output("items"));
    const run=await start(f,program);expect(run.reason).toBeUndefined();expect(run.status).toBe("completed");expect((await f.service.store.get<{results:unknown[]}>(run.resultRef!)).results).toEqual([{item:"a",state:{round:0},input:{explicit:true}}]);
    const standalone=workflow([subworkflow("child",{program:programRef("child","v2"),input:{}})],output("child"));expect(()=>validateWorkflowProgram(standalone,f.registry)).toThrow("item requires map");
    f.registry.programs["child@v2"].steps[0].options.value=field(item(),"missing");expect(()=>validateWorkflowProgram(program,f.registry)).toThrow("Field absent");expect(f.calls).toHaveLength(0);
  });
  test("cancel-siblings reaches a running activity inside a subworkflow",async()=>{
    let started=false,aborted=false;
    const f=await fixture(async input=>{
      if((input.data as {id:string}).id==="bad"){while(!started)await sleep();return{outcome:"infrastructure_failed",reason:"fixed failure"};}
      started=true;await new Promise<void>(resolve=>{if(input.signal.aborted)resolve();else input.signal.addEventListener("abort",()=>resolve(),{once:true});});aborted=true;
      return{outcome:"infrastructure_failed",reason:"observed fixture stop"};
    });
    f.registry.programs={"child@v2":workflow([read("slow")],output("slow"))};
    const run=await start(f,workflow([parallel("scope",{steps:[read("bad"),subworkflow("child",{program:programRef("child","v2"),input:{}})],result:output("child"),onFailure:"cancel-siblings"})],output("scope")));
    expect(run.status).toBe("needs-attention");expect(aborted).toBe(true);expect(Object.values(run.attempts).find(attempt=>attempt.operationId.includes("slow"))?.outcome).toBe("infrastructure_failed");
  });
  test("shared lease recovers dead reclaim and refuses live reclaim or changed identity",async()=>{
    const f=await fixture();const path=join(f.root,"test.lock"),reclaim=`${path}.reclaim`,dead=2147483647;
    await writeFile(path,JSON.stringify({pid:dead,token:"dead"}));await writeFile(reclaim,JSON.stringify({pid:dead,token:"dead-guard"}));
    const lease=await ProgramFileLease.acquire(path);await lease.assert();
    await expect(ProgramFileLease.acquire(path)).rejects.toThrow("busy");await lease.close();
    await writeFile(path,JSON.stringify({pid:dead,token:"dead"}));await writeFile(reclaim,JSON.stringify({pid:process.pid,token:"live-guard"}));
    await expect(ProgramFileLease.acquire(path)).rejects.toThrow("busy");expect(JSON.parse(await readFile(reclaim,"utf8")).token).toBe("live-guard");
    await rm(reclaim);const next=await ProgramFileLease.acquire(path);await writeFile(path,JSON.stringify({pid:process.pid,token:"changed"}));
    await expect(next.close()).rejects.toThrow("ownership changed");expect(JSON.parse(await readFile(path,"utf8")).token).toBe("changed");
  });
  test("executor input schemas reject invalid data before worker preparation",async()=>{
    const f=await fixture();f.registry.schemas["input@v2"]={type:"object",properties:{path:{type:"string"}},required:["path"],additionalProperties:false};f.registry.executors["read@v2"].inputSchema=schemaRef("input","v2");
    await expect(f.service.execute("program-start",{requestId:"start",program:workflow([read("a",{input:{path:123}})],output("a")),input:{}})).rejects.toThrow();expect(f.prepares).toHaveLength(0);
    f.registry.schemas["input@v2"]={type:"object",properties:{},additionalProperties:false};const valid=await start(f,workflow([agent("empty",{executor:executorRef("read","v2")})],output("empty")),"default-input");expect(valid.status).toBe("completed");expect(f.calls[0].data).toEqual({});
  });
  test("typed operation connections lower to the identical finite IR",()=>{
    const program=lowerWorkflowSource('import {defineWorkflow,schemaRef,policyRef,acceptanceRef,value,output,field} from "forgeos/agent-fabric/workflows"; const a=value("a",{value:{count:1}}); export default defineWorkflow({id:"typed",version:1,mode:"data",inputSchema:schemaRef("any","v2"),outputSchema:schemaRef("any","v2"),policy:policyRef("local","v2"),acceptance:acceptanceRef("goal","v2"),steps:[a],result:field(output(a),"count")});');
    expect(program.result).toEqual({$expr:"field",args:[{$expr:"output",args:["a"]},"count"]});
  });
  test("compact persistence keeps a validated linked history without duplicating state in envelope",async()=>{
    const f=await fixture();const run=await start(f,workflow([value("a",{value:1})],output("a")));
    const path=join(f.service.store.directory,`${programDigest(run.runId).slice(7)}.json`),envelope=JSON.parse(await readFile(path,"utf8"));
    expect(envelope.record.format).toBe(3);expect(envelope.record.state).toBeUndefined();expect(envelope.record.transitions).toBeUndefined();
    const beforeBytes=f.service.store.metrics.bytesWritten;const unchanged=await f.service.store.transact(run.runId,"unchanged",state=>state!);expect(unchanged.version).toBe(run.version);expect(f.service.store.metrics.bytesWritten).toBe(beforeBytes);
    await writeFile(`${path}.lock`,JSON.stringify({pid:2147483647,token:"dead"}));await writeFile(`${path}.lock.reclaim`,JSON.stringify({pid:2147483647,token:"dead-reclaim"}));await f.service.store.transact(run.runId,"recovered-noop",state=>state!);
    const history=await f.service.store.history(run.runId);expect(history.map(entry=>entry.version)).toEqual(Array.from({length:run.version},(_,i)=>i+1));
    const metrics=f.service.store.metrics;expect(metrics.bytesWritten).toBe(metrics.snapshotBytes+metrics.journalBytes+metrics.envelopeBytes+metrics.artifactBytes);
    expect(metrics.envelopeBytes).toBeLessThan(metrics.snapshotBytes);
    await writeFile(join(f.service.store.directory,"artifacts",`${envelope.record.journalRef.slice(7)}.json`),"{}");await expect(f.service.store.read(run.runId)).rejects.toThrow("integrity");
  });
  test("T07 scheduler round robin and exactly-once release",async()=>{
    const scheduler=new ProgramActivityScheduler(1), signal=new AbortController().signal;
    const first=await scheduler.acquire("a",1,[],signal);const a=scheduler.acquire("a",1,[],signal),b=scheduler.acquire("b",1,[],signal);first();first();
    const releaseB=await b;expect(scheduler.snapshot().active).toBe(1);releaseB();(await a)();expect(scheduler.snapshot().active).toBe(0);
  });
  test("T08 map waiting does not become failed and completed sibling is preserved",async()=>{
    const f=await fixture(); const run=await start(f,workflow([map("items",{items:[{id:"a"},{id:"b"}],key:field(item(),"id"),completion:"all-required",body:waitEvent("decision",{type:"choice",correlation:field(item(),"id"),schema:schemaRef("any","v2")})}),read("independent")],output("items")));
    expect(run.status).toBe("waiting");expect(run.operations.independent.status).toBe("completed");expect(run.operations["items/a/decision"].status).toBe("waiting");expect(f.calls).toHaveLength(1);
    for(const key of ["a","b"]) await control(f,"program-signal",{runId:run.runId,requestId:`signal-${key}`,signalId:key,target:`items/${key}/decision`,generation:1,type:"choice",correlation:key,payload:{approved:true},authorization:"fixture-owner"});
    const final=await finish(f,run.runId);expect(final.status).toBe("completed");expect(f.calls).toHaveLength(1);
  });
  test("T11 restart preserves wait deadline; resume does not extend it",async()=>{
    const f=await fixture();let run=await start(f,workflow([waitEvent("decision",{type:"choice",correlation:"one",schema:schemaRef("any","v2"),timeoutMs:5000})],output("decision")));
    const deadline=run.waits.decision.deadlineAt;await f.service.close(); f.service=await ProgramRunService.open(f.root,f.registry,f.adapter);resources.find(resource=>resource.root===f.root)!.service=f.service;
    await control(f,"program-resume",{runId:run.runId,requestId:"resume"});run=await finish(f,run.runId);expect(run.status).toBe("waiting");expect(run.waits.decision.deadlineAt).toBe(deadline);
  });
  test("T12/T13 same-run SDK-shaped output bypasses prepare and preserves budget after failure",async()=>{
    let failure=true;const f=await fixture(input=>(input.data as {id:string}).id==="bad"&&failure?{outcome:"infrastructure_failed",reason:"temporary"}:{outcome:"completed",data:input.data});
    Object.assign(f.registry.executors["read@v2"],{kind:"codex",isolation:"sandbox",network:"disabled"});
    let run=await start(f,workflow([read("good"),read("bad")],output("good")));expect(run.status).toBe("needs-attention");failure=false;
    await control(f,"program-resume",{runId:run.runId,requestId:"resume"});run=await finish(f,run.runId);
    expect(run.status).toBe("completed");expect(f.prepares.filter(input=>(input.data as {id:string}).id==="good")).toHaveLength(1);expect(run.totalAttempts).toBe(3);
    await f.service.store.transact(run.runId,"simulate-parent-commit-gap",current=>{current!.status="paused";delete current!.resultRef;return current!;});await control(f,"program-resume",{runId:run.runId,requestId:"resume-gap"});run=await finish(f,run.runId);expect(run.totalAttempts).toBe(3);
  });
  test("T14/T41 exclusive owner and uncertain reservations survive restart",async()=>{
    const f=await fixture(()=>({outcome:"uncertain",reason:"orphan may be alive"}));const run=await start(f,workflow([read("read")],output("read")));
    await expect(ProgramRunService.open(f.root,f.registry,f.adapter)).rejects.toThrow("owner");await f.service.close();f.service=await ProgramRunService.open(f.root,f.registry,f.adapter);resources.find(resource=>resource.root===f.root)!.service=f.service;
    const explanation=await f.service.execute("program-explain",{runId:run.runId}) as {scheduler:{active:number}};expect(explanation.scheduler.active).toBe(1);
    await control(f,"program-reconcile",{runId:run.runId,requestId:"observe",attemptId:Object.keys(run.attempts)[0],resolution:"failed",reason:"fixture observed original process exit"});
    expect((await f.service.execute("program-explain",{runId:run.runId}) as {scheduler:{active:number}}).scheduler.active).toBe(0);
  });
  test("T41 late SDK callback cannot mutate a successor owner",async()=>{
    let callback:()=>Promise<void>=async()=>{};const f=await fixture(input=>{callback=()=>input.onThread("late-thread");return{outcome:"uncertain",reason:"worker stop unobserved"};});
    const run=await start(f,workflow([read("read")],output("read")));await f.service.close();f.service=await ProgramRunService.open(f.root,f.registry,f.adapter);resources.find(resource=>resource.root===f.root)!.service=f.service;
    const before=(await f.service.store.read(run.runId))!.version;await expect(callback()).rejects.toThrow("Owner admission lease lost");expect((await f.service.store.read(run.runId))!.version).toBe(before);expect(Object.values((await f.service.store.read(run.runId))!.attempts)[0].threadId).toBeUndefined();
  });
  test("T15 corrupted completed output blocks instead of redispatch",async()=>{
    const f=await fixture();let run=await start(f,workflow([read("read")],output("read")));await control(f,"program-pause",{runId:run.runId,requestId:"pause"});
    await writeFile(join(f.service.store.directory,"artifacts",`${run.operations.read.outputRef!.slice(7)}.json`),"{}");await control(f,"program-resume",{runId:run.runId,requestId:"resume"});run=await finish(f,run.runId);expect(run.status).toBe("needs-attention");expect(f.calls).toHaveLength(1);
  });
  test("T38 quorum requires settled outcomes and counts valid data values",async()=>{
    const f=await fixture(); const options={items:[{id:"a"},{id:"b"}],key:field(item(),"id"),completion:"quorum" as const,quorum:{minAccepted:1},body:waitEvent("decision",{type:"choice",correlation:field(item(),"id"),schema:schemaRef("any","v2")})};
    let run=await start(f,workflow([map("items",options)],output("items")));await control(f,"program-signal",{runId:run.runId,requestId:"one",signalId:"a",target:"items/a/decision",generation:1,type:"choice",correlation:"a",payload:7,authorization:"owner"});run=await finish(f,run.runId);expect(run.status).toBe("waiting");
    await control(f,"program-signal",{runId:run.runId,requestId:"two",signalId:"b",target:"items/b/decision",generation:1,type:"choice",correlation:"b",payload:9,authorization:"owner"});run=await finish(f,run.runId);expect(run.status).toBe("completed");
    expect(()=>validateWorkflowProgram(workflow([map("bad",{...options,quorum:{minAccepted:0}})],output("bad")),f.registry)).toThrow("Quorum");
  });
  test("T40 NFC identity and slash encoding cannot collide",async()=>{
    expect(canonicalItemKey("e\u0301")).toBe("\u00e9");expect(programSegment("a/b")).toBe("a%2Fb");expect(programSegment("a%2Fb")).toBe("a%252Fb");
    const f=await fixture();const run=await start(f,workflow([map("items",{items:[{id:"\u00e9"},{id:"e\u0301"}],key:field(item(),"id"),completion:"all-required",body:value("copy",{value:item()})})],output("items")));expect(run.status).toBe("needs-attention");expect(f.calls).toHaveLength(0);
  });
  test("T33 completed facts remain readable after live policy revocation; new dispatch blocks",async()=>{
    const f=await fixture();const program=workflow([read("good"),waitEvent("hold",{after:["good"],type:"choice",correlation:"one",schema:schemaRef("any","v2")}),read("next",{after:["hold"]})],output("next"));
    const run=await start(f,program);expect(run.status).toBe("waiting");f.registry.policies["local@v2"].concurrency=1;
    await control(f,"program-signal",{runId:run.runId,requestId:"signal",signalId:"one",target:"hold",generation:1,type:"choice",correlation:"one",payload:{approved:true},authorization:"fixture-owner"});
    const final=await finish(f,run.runId);expect(final.status).toBe("needs-attention");expect(f.prepares).toHaveLength(1);expect(final.operations.good.status).toBe("completed");
  });
  test("T09 duplicate signal identity includes subject and expiry",async()=>{
    const f=await fixture();const run=await start(f,workflow([waitEvent("hold",{type:"choice",correlation:"one",schema:schemaRef("any","v2")})],output("hold")));
    await control(f,"program-pause",{runId:run.runId,requestId:"pause"});
    const request={runId:run.runId,signalId:"one",target:"hold",generation:1,type:"choice",correlation:"one",payload:{approved:true},subject:{candidate:"a"},authorization:"fixture-owner",expiresAt:new Date(Date.now()+60000).toISOString()};
    await control(f,"program-signal",{...request,requestId:"first"});await expect(control(f,"program-signal",{...request,requestId:"second",subject:{candidate:"b"}})).rejects.toThrow("Signal ID body changed");
  });
  test("admission deadline settles even when uncertain workers retain all slots",async()=>{
    const f=await fixture(()=>({outcome:"uncertain",reason:"unobserved"}));
    const occupied=await start(f,workflow([read("a"),read("b"),read("c"),read("d")],output("a")));expect(occupied.totalAttempts).toBe(4);
    f.registry.policies["local@v2"].deadlineMs=400;for(const executor of Object.values(f.registry.executors))executor.timeoutMs=100;
    const run=await start(f,workflow([read("queued")],output("queued")),"second-run");
    expect(run.status).toBe("needs-attention");expect(run.totalAttempts).toBe(0);expect(f.calls).toHaveLength(4);
  });
  test("T42 real provider factories fail closed in deterministic test mode",async()=>{
    const prior=process.env.FORGE_FABRIC_TEST_MODE;process.env.FORGE_FABRIC_TEST_MODE="1";
    try { await expect(runTypedCodexWorker({cwd:process.cwd(),prompt:"forbidden",role:"investigator",signal:new AbortController().signal,onEvent:()=>{},outputSchema:{},validateOutput:()=>{}})).rejects.toMatchObject({code:"AF_CODEX_TEST_MODE"}); } finally { if(prior===undefined)delete process.env.FORGE_FABRIC_TEST_MODE;else process.env.FORGE_FABRIC_TEST_MODE=prior; }
  });
});

describe("UI evidence and scoped obligations without a real LLM",()=>{
  async function uiFixture(omitCoverage=false,wrongEnvironment=false) {
    const f=await fixture(input=>{
      const context=(input.data as {assessmentContext?:ProgramAssessmentContext}).assessmentContext;
      if(input.executor.id==="capture")return{outcome:"completed",data:{captured:true},evidence:(context!.phase==="item"?[context!.itemKey!]:["a","b"]).map(itemKey=>({bytes:png,mime:"image/png",width:1,height:1,itemKey,buildDigest:input.candidate!.digest,environmentRef:wrongEnvironment?"wrong":context!.environmentRef,route:`/${itemKey}`,viewport:"1x1",state:"fixture"}))};
      if(input.executor.id==="review")return{outcome:"completed",data:{verdict:"approved",findings:[],coveredObligationIds:omitCoverage&&context!.phase==="final"?context!.obligationIds.slice(1):context!.obligationIds}};
      return{outcome:"completed",data:{passed:true}};
    },["a","b"]);
    Object.assign(f.registry.acceptance["goal@v2"],{requireReview:true,requiredChecksByScope:{item:["local-check@v2"],final:["global-check@v2"]},assessmentBindings:{local:"item",final:"final"},obligations:[{id:"layout",scope:"item",criteria:["known fixture constraint"],requiredEvidence:["capture"]},{id:"integration",scope:"final",criteria:["fixture integration"]}]});
    const items=[{id:"a"},{id:"b"}], local=repair("local",{...repairOptions(),assessmentScope:"item",evidence:[executorRef("capture","v2")]}), final=repair("final",{...repairOptions(),assessmentScope:"final",evidence:[executorRef("capture","v2")],checks:["global-check@v2"],initialCandidate:outputCandidate("integrated")});
    const program=workflow([map("uis",{items,key:field(item(),"id"),completion:"all-required",coverage:coverageFor(population(),{items}),body:local}),compose("integrated",{candidates:acceptedCandidates("uis"),onConflict:"needs-resolution"}),final,gate("ready",{candidate:acceptedCandidate("final"),coverage:coverageReceipt("uis")})],output("ready"),"candidate");program.population=populationRef("uis","v2");return{f,program};
  }
  for(const approved of [true,false])test(`T02/T10 human decision ${approved?'approves':'declines'} exact candidate`,async()=>{
    const {f,program}=await uiFixture();f.registry.acceptance["goal@v2"].requireHumanApproval=true;
    program.steps.splice(3,0,waitEvent("approval",{type:"approve",correlation:"final",schema:schemaRef("any","v2"),subject:object({candidate:acceptedCandidate("final"),contract:acceptance()})}));program.steps[4].options.authorization=output("approval");
    let run=await start(f,program);expect(run.status).toBe("waiting");expect(run.gateRef).toBeUndefined();
    const candidate=Object.values(run.assessments).find(assessment=>assessment.phase==="final")!.candidateDigest;
    const subject={candidate:Object.values(run.candidates).find(value=>value.digest===candidate),contract:run.registry.acceptance["goal@v2"]};
    await control(f,"program-signal",{runId:run.runId,requestId:"approval",signalId:"approval",target:"approval",generation:1,type:"approve",correlation:"final",payload:{approved},subject,authorization:"human-fixture",expiresAt:new Date(Date.now()+60000).toISOString()});run=await finish(f,run.runId);
    expect(run.status).toBe(approved?"acceptance-ready":"needs-attention");if(!approved)expect(run.gateRef).toBeUndefined();expect(f.calls.some(call=>call.executor.id==="implement")).toBe(false);
  });
  test("T26 final global repair regresses an approved item; fresh full matrix rejects it",async()=>{
    const {f,program}=await uiFixture();program.steps[2].options.maxRepairRounds=1;
    const adapter:ProgramWorkerAdapter=async input=>({directory:f.root,inputDigest:programDigest(input.data),async execute(){
      const context=(input.data as {assessmentContext?:ProgramAssessmentContext}).assessmentContext;
      if(input.executor.id==="implement")return{outcome:"completed",data:{changed:true},artifact:{digest:programDigest("regression"),files:[{path:"src/a",beforeDigest:null,contentBase64:Buffer.from("regressed").toString("base64")}]}};
      if(input.executor.id==="capture")return{outcome:"completed",data:{},evidence:(context!.phase==="item"?[context!.itemKey!]:["a","b"]).map(itemKey=>({bytes:png,mime:"image/png",width:1,height:1,itemKey,buildDigest:input.candidate!.digest,environmentRef:context!.environmentRef,route:`/${itemKey}`,viewport:"1x1",state:"fixture"}))};
      if(input.executor.id==="review")return{outcome:"completed",data:{verdict:context!.phase==="final"?"changes_requested":"approved",findings:context!.phase==="final"?[input.artifacts.length?"previously approved a now regressed":"global defect"]:[],coveredObligationIds:context!.obligationIds}};
      return{outcome:"completed",data:{passed:true}};
    }});
    await f.service.close();f.service=await ProgramRunService.open(f.root,f.registry,adapter);resources.find(resource=>resource.root===f.root)!.service=f.service;
    const run=await start(f,program);expect(run.status).toBe("needs-attention");expect(run.gateRef).toBeUndefined();
    const final=Object.values(run.assessments).filter(assessment=>assessment.phase==="final");expect(final).toHaveLength(2);expect(new Set(final.map(receipt=>receipt.candidateDigest)).size).toBe(2);const regression=final.find(receipt=>receipt.findings.includes("previously approved a now regressed"))!;expect(regression).toBeDefined();expect(regression.obligationIds).toContain("layout/a");expect(regression.evidenceRefs).toHaveLength(2);
  });
  test("T23/T36 local/final checks differ; final recaptures every UI and closes matrix",async()=>{
    const {f,program}=await uiFixture();const run=await start(f,program);expect(run.reason).toBeUndefined();expect(run.status).toBe("acceptance-ready");expect(f.calls.some(call=>call.executor.id==="implement")).toBe(false);
    const final=Object.values(run.assessments).find(assessment=>assessment.phase==="final")!;expect(final.satisfiedObligationIds).toEqual(["layout/a","layout/b","integration"]);expect(final.evidenceRefs).toHaveLength(2);expect(Object.keys(run.artifactRecords!)).toHaveLength(4);
    const capture=Object.values(run.artifactRecords!)[0];expect(await f.service.store.getBinary(capture.artifactRef)).toEqual(png);
    const artifact=await f.service.execute("program-artifact-get",{runId:run.runId,ref:capture.artifactRef,binary:true}) as {base64:string};expect(artifact.base64).toBe(png.toString("base64"));
    expect(f.calls.filter(call=>call.executor.id==="review").every(call=>(call.evidence??[]).length>0)).toBe(true);
  });
  test("final-only capture obligation does not force capture in item phase",async()=>{
    const {f,program}=await uiFixture();f.registry.acceptance["goal@v2"].obligations=[{id:"layout",scope:"item",criteria:["local structural check"]},{id:"integration",scope:"final",criteria:["integrated render"],requiredEvidence:["capture"]}];
    const body=program.steps[0].options.body as {options:Record<string,unknown>};body.options.evidence=[];
    const run=await start(f,program);expect(run.reason).toBeUndefined();expect(run.status).toBe("acceptance-ready");expect(f.calls.filter(call=>call.executor.id==="capture")).toHaveLength(1);
  });
  test("visual owner catalog rejects mismatched viewport and validates final case coverage",async()=>{
    const {f,program}=await uiFixture();const population=f.registry.populations["uis@v2"];
    population.visualCases=[{itemKey:"a",route:"/a",viewport:"1x1",state:"fixture",width:1,height:1},{itemKey:"b",route:"/b",viewport:"1x1",state:"fixture",width:1,height:1}];
    const run=await start(f,program);expect(run.status).toBe("acceptance-ready");
    population.visualCases[0].viewport="mobile";const failed=await start(f,program,"different-cases");expect(failed.status).toBe("needs-attention");expect(failed.gateRef).toBeUndefined();
    expect(Object.keys(failed.artifactRecords??{})).not.toContain(Object.keys(run.artifactRecords!)[0]);
    population.visualCases.pop();expect(()=>validateVisualPopulation(population)).toThrow("cover exactly");
  });
  test("T36 author cannot omit final check before dispatch",async()=>{const {f,program}=await uiFixture();program.steps[2].options.checks=[];await expect(f.service.execute("program-start",{requestId:"start",program,input:{}})).rejects.toThrow("omit required");expect(f.calls).toHaveLength(0);});
  test("T37 final report omitting an obligation cannot satisfy gate",async()=>{const {f,program}=await uiFixture(true);const run=await start(f,program);expect(run.status).toBe("needs-attention");expect(run.gateRef).toBeUndefined();});
  test("T19/T37 capture from another environment never approves",async()=>{const {f,program}=await uiFixture(false,true);const run=await start(f,program);expect(run.status).toBe("needs-attention");expect(run.gateRef).toBeUndefined();expect(f.calls.some(call=>call.executor.id==="implement")).toBe(false);});
  test("T18 malformed image metadata is separate from a UI finding",()=>{expect(programImage(png)).toEqual({mime:"image/png",width:1,height:1});expect(()=>programImage(Buffer.from("invalid image data bytes"))).toThrow();});
  test("history and diff read authoritative state without dispatch",async()=>{const f=await fixture();const program=workflow([value("a",{value:1})],output("a")),run=await start(f,program);expect((await f.service.execute("program-history",{runId:run.runId}) as unknown[]).length).toBeGreaterThan(0);const changed=structuredClone(program);changed.steps[0].options.value=2;expect(await f.service.execute("program-diff",{runId:run.runId,program:changed})).toHaveProperty("changed",["a"]);expect(f.calls).toHaveLength(0);});
});
