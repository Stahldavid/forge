import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProgramRunService } from "../../src/forge/agent-fabric/program-service.ts";
import { programDigest, validateProgramData, validateWorkflowProgram, type ProgramRegistry, type ProgramRunV2, type WorkflowProgramV2 } from "../../src/forge/agent-fabric/program-contract.ts";
import { lowerWorkflowSource, defineWorkflow, schemaRef, programRef, policyRef, acceptanceRef, populationRef, executorRef, recipeRef, value, literal, output, object, item, field, map, population, coverageFor, repair, candidateFromBaseline, acceptedCandidate, gate, branch, subworkflow, workflowInput, waitEvent, loop, loopState, eq } from "../../src/forge/agent-fabric/program-dsl.ts";
import { validateProgramCapabilities, type ProgramWorkerAdapter, type ProgramWorkerInput, type ProgramWorkerResult } from "../../src/forge/agent-fabric/program-worker.ts";

const roots: string[] = [], services: ProgramRunService[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function registry(root: string, members: string[] = []): ProgramRegistry {
  const executor = (id: string, effect: "read" | "isolated-write", role: "implementer" | "reviewer" | "investigator") => ({ id, version: "v1", kind: "command" as const, role, effect, argv: [process.execPath, "-e", "console.log('{}')"], timeoutMs: 10000, writeScope: effect === "read" ? [] : ["src"], network: "host" as const, isolation: "cooperative" as const, schema: schemaRef("any", "v1") });
  return { schemas: { "any@v1": {}, "object@v1": { type: "object" }, "number@v1": { type: "number" } },
    executors: { "implement@v1": executor("implement", "isolated-write", "implementer"), "review@v1": executor("review", "read", "reviewer"), "check@v1": executor("check", "read", "investigator"), "read@v1": executor("read", "read", "investigator") },
    policies: { "local@v1": { id: "local", version: "v1", maxItems: 100, concurrency: 4, maxAttempts: 1000, maxOperations: 2000, maxDepth: 8, deadlineMs: 120000, maxOutputBytes: 4 * 1024 * 1024, writeScope: ["src"], executors: ["implement@v1", "review@v1", "check@v1", "read@v1"], allowCooperativeCommands: true, allowNetwork: true } },
    acceptance: { "goal@v1": { id: "goal", version: "v1", criteria: ["behavior-preserved"], writeScope: ["src"], requiredChecks: ["check@v1"], requireReview: true, allowNoWork: false, allowPartial: true } },
    populations: { "components@v1": { id: "components", version: "v1", members, exclusions: [], baselineDigest: programDigest({ root }), evidence: "Owner-enumerated fixture inventory", allowNoWork: false } } };
}
function program(steps: WorkflowProgramV2["steps"], result: unknown): WorkflowProgramV2 {
  return defineWorkflow({ id: "test", version: 1, inputSchema: schemaRef("any", "v1"), outputSchema: schemaRef("any", "v1"), acceptance: acceptanceRef("goal", "v1"), policy: policyRef("local", "v1"), steps, result });
}
async function fixture(handler?: (input: ProgramWorkerInput) => Promise<ProgramWorkerResult> | ProgramWorkerResult, members: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), "forge-program-test-")); roots.push(root); const catalog = registry(root, members), calls: ProgramWorkerInput[] = [];
  const adapter: ProgramWorkerAdapter = async input => ({ directory: root, reusable: true, inputDigest: programDigest({ candidate: input.candidate, executor: input.executor, data: input.data }), async execute() {
    calls.push(input); if (handler) return handler(input);
    return { outcome: "completed", data: input.executor.id === "review" ? { verdict: "approved", findings: [] } : input.executor.id === "check" ? { passed: true } : { ok: true } };
  } });
  const service = await ProgramRunService.open(root, catalog, adapter); services.push(service); return { root, catalog, calls, service, adapter };
}
async function finish(service: ProgramRunService, runId: string): Promise<ProgramRunV2> {
  const deadline = Date.now() + 30000;
  for (;;) { const state = await service.execute("program-status", { runId }) as ProgramRunV2; if (state.status !== "executing") return state; if (Date.now() > deadline) throw new Error("Fixture did not finish"); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function control(service: ProgramRunService, action: Parameters<ProgramRunService["execute"]>[0], request: Record<string, unknown>): Promise<unknown> {
  for (let retry = 0; retry < 30; retry++) {
    const state = await service.execute("program-status", { runId: request.runId }) as ProgramRunV2;
    try { return await service.execute(action, { ...request, expectedVersion: state.version }); }
    catch (error) { if ((error as {code?: string}).code !== "AF_PROGRAM_CONFLICT") throw error; }
  } throw new Error("Control CAS did not settle");
}
async function start(service: ProgramRunService, workflow: WorkflowProgramV2, input: unknown = {}, requestId = "start") {
  const state = await service.execute("program-start", { requestId, program: workflow, input }) as ProgramRunV2; return finish(service, state.runId);
}
function repairStep(entryMode: "assess-first" | "implement-first" = "assess-first") {
  return repair("repair", { recipe: recipeRef("repair", "v2"), entryMode, initialCandidate: candidateFromBaseline(item()), writeScope: ["src"], implement: executorRef("implement", "v1"), review: executorRef("review", "v1"), checks: ["check@v1"], maxRepairRounds: 3, maxAssessmentAttempts: 5, maxInfrastructureAttempts: 2, progressPolicy: { unchangedCandidateRounds: 2, repeatedFindingsRounds: 2 } });
}

describe("program v2 authored source and contracts", () => {
  test("lowers finite constructors without executing source", () => {
    const source = `import { defineWorkflow, schemaRef, programRef, policyRef, acceptanceRef, value, literal, output } from "forgeos/agent-fabric/workflows";
      const label = "hello";
      export default defineWorkflow({ id: "demo", version: 1, inputSchema: schemaRef("any", "v1"), outputSchema: schemaRef("any", "v1"), acceptance: acceptanceRef("goal", "v1"), policy: policyRef("local", "v1"), steps: [value("greeting", {value: literal(label)})], result: output("greeting") });`;
    const lowered = lowerWorkflowSource(source); expect(lowered.steps[0].kind).toBe("value"); validateWorkflowProgram(lowered, registry("fixture"));
  });
  test.each([`import x from "node:fs"; export default x();`, `import {defineWorkflow} from "forgeos/agent-fabric/workflows"; export = defineWorkflow({});`, `import {defineWorkflow} from "forgeos/agent-fabric/workflows"; export default defineWorkflow({`, `while(true){}`, `const x = Date.now(); export default x;`, `const x = (()=>{throw 1})(); export default x;`])("rejects arbitrary/malformed syntax: %s", source => { expect(() => lowerWorkflowSource(source)).toThrow(); });
  test("validates anyOf siblings and rejects unsupported keywords", () => {
    expect(() => validateProgramData("wrong", { type: "object", required: ["verdict"], anyOf: [{}] })).toThrow();
    const catalog = registry("fixture"); catalog.schemas["any@v1"] = { type: "string", pattern: ".*" } as never;
    expect(() => validateWorkflowProgram(program([], literal("ok")), catalog)).toThrow("schema keyword");
  });
  test("rejects unknown outputs, expression arity, duplicate IDs and cycles", () => {
    const catalog = registry("fixture");
    expect(() => validateWorkflowProgram(program([value("a", { value: output("missing") })], output("a")), catalog)).toThrow("Unknown output");
    expect(() => validateWorkflowProgram(program([value("a", { value: output("b") }), value("b", { value: output("a") })], output("a")), catalog)).toThrow("cycle");
    expect(() => validateWorkflowProgram(program([value("a", { value: 1 }), value("a", { value: 2 })], output("a")), catalog)).toThrow();
    expect(() => validateWorkflowProgram(program([], { $expr: "exec", args: [] }), catalog)).toThrow("Unknown expression");
  });
  test("requires real cooperative versus sandbox capabilities", () => {
    const catalog = registry("fixture"), executor = catalog.executors["check@v1"], policy = catalog.policies["local@v1"], acceptance = catalog.acceptance["goal@v1"];
    expect(() => validateProgramCapabilities({ ...executor, network: "disabled" }, policy, acceptance, [])).toThrow("cannot prove");
    expect(() => validateProgramCapabilities(catalog.executors["implement@v1"], policy, acceptance, ["outside"])).toThrow("authorization");
    expect(() => validateProgramCapabilities(catalog.executors["implement@v1"], policy, acceptance, [])).toThrow("resolved scope");
  });
});

describe("program v2 durable execution", () => {
  test("typed values, branch selection and explicit result", async () => {
    const f = await fixture();
    const state = await start(f.service, program([branch("select", { condition: true, then: value("chosen", { value: literal({ ok: true }) }), else: value("ignored", { value: literal({ ok: false }) }) })], output("select")));
    expect(state.status).toBe("completed"); expect(state.operations["select/else/ignored"].status).toBe("skipped"); expect(await f.service.store.get<{ ok: boolean }>(state.resultRef!)).toEqual({ ok: true });
  });
  test("80 stable items use a closed owner-validated collection", async () => {
    const ids = Array.from({ length: 80 }, (_, index) => `component-${index}`), f = await fixture(undefined, ids), items = ids.map(id => ({ id }));
    const workflow = program([map("items", { items: literal(items), key: field(item(), "id"), coverage: coverageFor(population(), literal({ items })), completion: "all-required", concurrency: 4, body: value("copy", { value: item() }) })], output("items")); workflow.population = populationRef("components", "v1");
    const state = await start(f.service, workflow); expect(state.reason).toBeUndefined(); expect(state.status).toBe("completed"); const result = await f.service.store.get<{ results: unknown[] }>(state.resultRef!); expect(result.results.length).toBe(80); expect(Object.keys(state.seals)).toEqual(["items"]);
  }, 60000);
  test.each([[], [{ id: "a" }], [{ id: "a" }, { id: "a" }], [{ id: "a" }, { id: "extra" }]].map(items => ({ items })))("discovery omission/vacuity/duplicates/extras block: %j", async ({ items }) => {
    const f = await fixture(undefined, ["a", "b"]), workflow = program([map("items", { items: literal(items), key: field(item(), "id"), coverage: coverageFor(population(), literal({ items })), completion: "all-required", body: value("copy", { value: item() }) })], output("items")); workflow.population = populationRef("components", "v1");
    expect((await start(f.service, workflow)).status).toBe("needs-attention");
  });
  test("literal coverage and fabricated review cannot satisfy owner gates", async () => {
    const f = await fixture(undefined, ["a"]), workflow = program([map("items", { items: literal([{ id: "a" }]), key: field(item(), "id"), coverage: literal({ status: "covered", ids: ["a"] }), completion: "all-required", body: value("copy", { value: item() }) })], output("items")); workflow.population = populationRef("components", "v1");
    expect((await start(f.service, workflow)).status).toBe("needs-attention");
    const fabricated = program([value("candidate", { value: candidateFromBaseline(item()) }), value("fake", { value: object({ status: "accepted", acceptedCandidate: output("candidate"), assessment: literal({ verdict: "approved", findings: [], checks: [{ id: "check@v1", passed: true }] }) }) }), gate("final", { candidate: output("candidate") })], output("final"));
    const state = await start(f.service, fabricated, {}, "fake-review"); expect(state.status).toBe("needs-attention"); expect(state.gateRef).toBeUndefined();
  });
  test("assess-first approves with zero implementations and same-candidate checks", async () => {
    const f = await fixture(), state = await start(f.service, program([repairStep(), gate("final", { candidate: acceptedCandidate("repair") })], output("final")));
    expect(state.status).toBe("acceptance-ready"); expect(f.calls.map(call => call.executor.id)).toEqual(["review", "check"]); expect(state.gateRef).toBeDefined(); expect(Object.values(state.assessments).length).toBe(1);
  });
  test("negative verdict repairs instead of treating completed as approved", async () => {
    let reviews = 0; const f = await fixture(input => ({ outcome: "completed", data: input.executor.id === "review" ? { verdict: ++reviews === 1 ? "changes_requested" : "approved", findings: reviews === 1 ? ["fix"] : [] } : input.executor.id === "check" ? { passed: true } : { summary: "fixed" } }));
    const state = await start(f.service, program([repairStep(), gate("final", { candidate: acceptedCandidate("repair") })], output("final")));
    expect(state.status).toBe("acceptance-ready"); expect(f.calls.filter(call => call.executor.id === "implement").length).toBe(1); expect(reviews).toBe(2);
  });
  test("inconclusive re-evaluates within bounds, without editing", async () => {
    const f = await fixture(input => ({ outcome: "completed", data: input.executor.id === "review" ? { verdict: "inconclusive", findings: [] } : { passed: true } }));
    const state = await start(f.service, program([repairStep(), gate("final", { candidate: acceptedCandidate("repair") })], output("final")));
    expect(state.status).toBe("needs-attention"); expect(f.calls.some(call => call.executor.id === "implement")).toBe(false); expect(state.totalAttempts).toBeLessThanOrEqual(10); expect(state.gateRef).toBeUndefined();
  });
  test("invalid reviewer and check executor categories are refused", async () => {
    const f = await fixture(), step = repairStep(); step.options.review = executorRef("implement", "v1");
    expect((await start(f.service, program([step], output("repair")))).status).toBe("needs-attention"); expect(f.calls.length).toBe(0);
  });
  test("post-dispatch exception is uncertain and blocks resume", async () => {
    const f = await fixture(() => { throw new Error("lost after launch"); });
    const workflow = program([{ kind: "agent", id: "read", options: { executor: executorRef("read", "v1"), input: literal({}) } }], output("read")), state = await start(f.service, workflow);
    expect(state.status).toBe("needs-attention"); expect(Object.values(state.attempts)[0].outcome).toBe("uncertain");
    await expect(control(f.service, "program-resume", { runId: state.runId, requestId: "resume", expectedVersion: state.version })).rejects.toThrow("reconciliation");
  });
  test("subworkflow validates and receives child input", async () => {
    const f = await fixture(), child = program([value("echo", { value: workflowInput() })], output("echo")); child.inputSchema = schemaRef("number", "v1"); f.catalog.programs = { "child@v1": child };
    const state = await start(f.service, program([subworkflow("child", { program: programRef("child", "v1"), input: literal(42) })], output("child")), { root: "different" });
    expect(state.status).toBe("completed"); expect(await f.service.store.get<number>(state.resultRef!)).toBe(42);
    await expect(start(f.service, program([subworkflow("child", { program: programRef("child", "v1"), input: literal("wrong") })], output("child")), {}, "bad-child")).rejects.toThrow("Expected number");
  });
  test("loop state terminates or exhausts without silent acceptance", async () => {
    const f = await fixture(), workflow = program([loop("bounded", { initialState: 0, maxRounds: 3, body: value("next", { value: literal(1) }), next: output("next"), until: eq(loopState(), literal(1)) })], output("bounded"));
    const state = await start(f.service, workflow); expect(state.status).toBe("completed"); expect(await f.service.store.get<number>(state.resultRef!)).toBe(1);
  });
  test("human event matches generation/correlation and is consumed once", async () => {
    const f = await fixture(), workflow = program([waitEvent("approval", { schema: schemaRef("number", "v1"), type: "choice", correlation: "request-1" })], output("approval"));
    let state = await start(f.service, workflow); expect(state.status).toBe("waiting");
    state = await control(f.service, "program-signal", { runId: state.runId, requestId: "signal", expectedVersion: state.version, signalId: "human-1", target: "approval", generation: 1, type: "choice", correlation: "request-1", payload: 7, authorization: "fixture-host-human" }) as ProgramRunV2;
    state = await finish(f.service, state.runId); expect(state.status).toBe("completed"); expect(state.signals[0].status).toBe("consumed"); expect(await f.service.store.get<number>(state.resultRef!)).toBe(7);
  });
  test("same start request is idempotent, changed body conflicts", async () => {
    const f = await fixture(), workflow = program([value("a", { value: literal(1) })], output("a")); const state = await start(f.service, workflow);
    const replay = await f.service.execute("program-start", { requestId: "start", program: workflow, input: {} }) as ProgramRunV2; expect(replay.runId).toBe(state.runId);
    await expect(f.service.execute("program-start", { requestId: "start", program: workflow, input: { changed: true } })).rejects.toThrow("changed");
    await expect(f.service.execute("program-start", { requestId: "registry-override", program: workflow, input: {}, registry: f.catalog })).rejects.toThrow("owner-controlled");
  });
  test("artifacts and journal reject corruption", async () => {
    const f = await fixture(), state = await start(f.service, program([value("a", { value: literal(1) })], output("a")));
    const artifactPath = join(f.service.store.directory, "artifacts", `${state.resultRef!.slice(7)}.json`); await writeFile(artifactPath, "2"); await expect(f.service.store.get(state.resultRef!)).rejects.toThrow("integrity");
    const recordPath = join(f.service.store.directory, `${programDigest(state.runId).slice(7)}.json`), envelope = JSON.parse(await readFile(recordPath, "utf8")); envelope.record.version++; await writeFile(recordPath, JSON.stringify(envelope));
    await expect(f.service.store.read(state.runId)).rejects.toThrow("integrity");
  });
  test("compiler rejects branch merges, result types, parent-body cycles and recursive children before dispatch", async () => {
    const f = await fixture(), bad = program([branch("choice", { condition: true, then: value("yes", { value: 1 }), else: value("no", { value: "wrong" }) })], output("choice"));
    expect(() => validateWorkflowProgram(bad, f.catalog)).toThrow("merge");
    const result = program([value("text", { value: "wrong" })], output("text")); result.outputSchema = schemaRef("number", "v1");
    expect(() => validateWorkflowProgram(result, f.catalog)).toThrow();
    const cycle = program([map("cycle", { items: [], key: field(item(), "id"), completion: "partial", body: value("copy", { value: output("cycle") }) })], output("cycle"));
    expect(() => validateWorkflowProgram(cycle, f.catalog)).toThrow("cycle");
    const recursive = program([subworkflow("child", { program: programRef("self", "v1"), input: {} })], output("child")); f.catalog.programs = { "self@v1": recursive };
    expect(() => validateWorkflowProgram(recursive, f.catalog)).toThrow("cycle"); expect(f.calls).toHaveLength(0);
  });
  test("map inside a child preserves child input rather than root input", async () => {
    const f = await fixture(), child = program([map("each", { items: [{ id: "a" }], key: field(item(), "id"), completion: "partial", body: value("echo", { value: workflowInput() }) })], output("each"));
    child.inputSchema = schemaRef("number", "v1"); f.catalog.programs = { "child@v1": child };
    const state = await start(f.service, program([subworkflow("child", { program: programRef("child", "v1"), input: 42 })], output("child")), { root: "different" });
    expect(state.status).toBe("completed"); expect((await f.service.store.get<{ results: number[] }>(state.resultRef!)).results).toEqual([42]);
  });
  test("repair receives each work item and preserves its authorized scope and criteria", async () => {
    const f = await fixture(), step = repairStep("implement-first");
    const state = await start(f.service, program([map("each", { items: [{ id: "a" }, { id: "b" }], key: field(item(), "id"), completion: "partial", body: step })], output("each")), { requirement: "migrate" });
    expect(state.status).toBe("completed");
    const implementations = f.calls.filter(call => call.executor.id === "implement"); expect(implementations).toHaveLength(2);
    expect(implementations.map(call => (call.data as { workItem: { id: string } }).workItem.id).sort()).toEqual(["a", "b"]);
    expect(implementations[0].data).toMatchObject({ workflowInput: { requirement: "migrate" }, writeScope: ["src"], criteria: ["behavior-preserved"] });
  });
  test("fenced wait rejects the previous generation's signal", async () => {
    const f = await fixture(); f.catalog.policies["local@v1"].allowFencedReplan = true;
    const workflow = program([waitEvent("decision", { schema: schemaRef("number", "v1"), type: "choice", correlation: "old" })], output("decision"));
    let state = await start(f.service, workflow);
    state = await control(f.service, "program-pause", { runId: state.runId, requestId: "pause-old" }) as ProgramRunV2;
    state = await control(f.service, "program-signal", { runId: state.runId, requestId: "old-event", expectedVersion: state.version, signalId: "old", target: "decision", generation: 1, type: "choice", correlation: "new", payload: 9, authorization: "host" }) as ProgramRunV2;
    const replacement = program([waitEvent("decision", { schema: schemaRef("number", "v1"), type: "choice", correlation: "new" })], output("decision"));
    state = await control(f.service, "program-replan", { runId: state.runId, requestId: "replace", expectedVersion: state.version, mode: "fenced", program: replacement }) as ProgramRunV2;
    expect(state.operations.decision.generation).toBe(2);
    await control(f.service, "program-resume", { runId: state.runId, requestId: "resume-old", expectedVersion: state.version }); state = await finish(f.service, state.runId);
    expect(state.status).toBe("waiting"); expect(state.signals[0].status).toBe("pending"); expect(state.waits.decision.generation).toBe(2);
    state = await control(f.service, "program-signal", { runId: state.runId, requestId: "new-event", expectedVersion: state.version, signalId: "new", target: "decision", generation: 2, type: "choice", correlation: "new", payload: 7, authorization: "host" }) as ProgramRunV2;
    state = await finish(f.service, state.runId);
    expect(state.status).toBe("completed"); expect(await f.service.store.get<number>(state.resultRef!)).toBe(7);
  });
  test("fenced active worker's late success cannot complete the replacement", async () => {
    let complete!: () => void; const held = new Promise<void>(resolve => { complete = resolve; });
    const f = await fixture(async () => { await held; return { outcome: "completed", data: { old: true } }; }); f.catalog.policies["local@v1"].allowFencedReplan = true;
    const workflow = program([{ kind: "agent", id: "work", options: { executor: executorRef("read", "v1"), input: { version: 1 } } }], output("work"));
    const started = await f.service.execute("program-start", { requestId: "start", program: workflow, input: {} }) as ProgramRunV2;
    while (!f.calls.length) await new Promise(resolve => setTimeout(resolve, 10));
    let state = await f.service.store.read(started.runId); const replacement = structuredClone(workflow); replacement.steps[0].options.input = { version: 2 };
    state = await control(f.service, "program-replan", { runId: started.runId, requestId: "fence", expectedVersion: state!.version, mode: "fenced", program: replacement }) as ProgramRunV2;
    complete(); await f.service.close(); state = (await f.service.store.read(started.runId))!;
    expect(state.status).toBe("paused"); expect(state.operations.work.status).toBe("uncertain"); expect(Object.values(state.attempts)[0].outcome).toBe("uncertain"); expect(state.resultRef).toBeUndefined();
  });
  test("restart marks unobserved dispatch uncertain and does not automatically redispatch", async () => {
    const f = await fixture(), workflow = program([value("a", { value: 1 })], output("a")), state = await start(f.service, workflow); await f.service.close();
    await f.service.store.transact(state.runId, "injected-crash-after-intent", current => { current!.status = "executing"; current!.attempts.lost = { attemptId: "lost", operationId: "a", generation: 1, inputDigest: programDigest({}), executorDigest: programDigest({}), startedAt: new Date().toISOString(), outcome: "running" }; current!.operations.a.status = "running"; return current!; });
    const recovered = await ProgramRunService.open(f.root, f.catalog, f.adapter); services.push(recovered); const run = (await recovered.store.read(state.runId))!;
    expect(run.status).toBe("needs-attention"); expect(run.attempts.lost.outcome).toBe("uncertain"); expect(f.calls).toHaveLength(0);
    await expect(recovered.execute("program-resume", { runId: run.runId, requestId: "unsafe", expectedVersion: run.version })).rejects.toThrow("reconciliation");
  });
  test("barrier replan preserves intact completed invocation generations", async () => {
    const f = await fixture(), workflow = program([{ kind: "agent", id: "read", options: { executor: executorRef("read", "v1"), input: { same: true } } }, value("changed", { value: 1 })], output("changed"));
    let state = await start(f.service, workflow), replacement = structuredClone(workflow); replacement.steps[1].options.value = 2;
    state = await control(f.service, "program-replan", { runId: state.runId, requestId: "replan", expectedVersion: state.version, program: replacement }) as ProgramRunV2;
    await control(f.service, "program-resume", { runId: state.runId, requestId: "resume", expectedVersion: state.version }); state = await finish(f.service, state.runId);
    expect(state.status).toBe("completed"); expect(f.calls).toHaveLength(1); expect(state.operations.read.generation).toBe(1); expect(await f.service.store.get<number>(state.resultRef!)).toBe(2);
  });
  test("authorized empty inventory is explicit no-work; normalized duplicate keys are rejected", async () => {
    const f = await fixture(); f.catalog.populations["components@v1"].allowNoWork = true; f.catalog.acceptance["goal@v1"].allowNoWork = true;
    const workflow = program([map("empty", { items: [], key: field(item(), "id"), coverage: coverageFor(population(), { items: [] }), completion: "all-required", body: value("copy", { value: item() }) })], output("empty")); workflow.population = populationRef("components", "v1");
    const state = await start(f.service, workflow); expect(state.status).toBe("completed"); expect((await f.service.store.get<{ status: string }>(state.resultRef!)).status).toBe("no-work");
    const bad = program([map("keys", { items: [{ id: "\u00e9" }, { id: "e\u0301" }], key: field(item(), "id"), completion: "partial", body: value("copy", { value: item() }) })], output("keys"));
    expect((await start(f.service, bad, {}, "bad-keys")).status).toBe("needs-attention");
  });
  test("resume cannot replenish an exhausted recipe's infrastructure budget", async () => {
    const f = await fixture(() => ({ outcome: "infrastructure_failed", reason: "observed failure" }));
    let state = await start(f.service, program([repairStep(), gate("final", { candidate: acceptedCandidate("repair") })], output("final")));
    expect(state.status).toBe("needs-attention"); expect(state.totalAttempts).toBe(2); expect(state.repairs.repair.infrastructure).toBe(2);
    await control(f.service, "program-resume", { runId: state.runId, requestId: "resume", expectedVersion: state.version }); state = await finish(f.service, state.runId);
    expect(state.status).toBe("needs-attention"); expect(state.totalAttempts).toBe(2); expect(f.calls).toHaveLength(2); expect(state.repairs.repair.phase).toBe("exhausted");
  });
  test.each([false, true])("additive extension handles an in-flight gate without masking sibling failure (%s)", async failSibling => {
    let complete!: () => void; const held = new Promise<void>(resolve => { complete = resolve; });
    const f = await fixture(async input => input.executor.id === "read" ? (await held, failSibling ? { outcome: "infrastructure_failed", reason: "expected sibling failure" } : { outcome: "completed", data: {} }) : { outcome: "completed", data: input.executor.id === "review" ? { verdict: "approved", findings: [] } : { passed: true } });
    let gateReached!: () => void, releaseGate!: () => void;
    const reached = new Promise<void>(resolve => { gateReached = resolve; }), gateHeld = new Promise<void>(resolve => { releaseGate = resolve; });
    const transact = f.service.store.transact.bind(f.service.store); let intercept = true;
    f.service.store.transact = async (...args: Parameters<typeof transact>) => {
      if (args[1] === "gate-receipt" && intercept) { intercept = false; gateReached(); await gateHeld; }
      return transact(...args);
    };
    const workflow = program([repairStep(), gate("final", { candidate: acceptedCandidate("repair") }), { kind: "agent", id: "hold", options: { executor: executorRef("read", "v1"), input: {} } }], output("final"));
    const started = await f.service.execute("program-start", { requestId: "start", program: workflow, input: {} }) as ProgramRunV2;
    while (!f.calls.some(call => call.executor.id === "read")) await new Promise(resolve => setTimeout(resolve, 10));
    await reached;
    let state = (await f.service.store.read(started.runId))!; const oldGate = state.gateRef, replacement = structuredClone(workflow); replacement.steps.push(value("new", { value: 1 }));
    state = await control(f.service, "program-replan", { runId: state.runId, requestId: "extend", expectedVersion: state.version, mode: "additive", program: replacement }) as ProgramRunV2;
    releaseGate(); complete(); state = await finish(f.service, state.runId);
    if (failSibling) { expect(state.status).toBe("needs-attention"); expect(state.reason).toContain("expected sibling failure"); expect(state.gateRef).toBeUndefined(); return; }
    expect(state.reason).toBeUndefined(); expect(state.status).toBe("acceptance-ready"); expect(state.gateRef).toBeDefined(); expect(state.gateRef).not.toBe(oldGate);
    expect((await f.service.store.get<{ semanticVersion: number }>(state.gateRef!)).semanticVersion).toBe(state.semanticVersion); expect(f.calls.filter(call => call.executor.id === "read")).toHaveLength(1);
  });
  test("data completion and a forged accepted result cannot bypass acceptance", async () => {
    const f = await fixture(), data = await start(f.service, program([value("data", { value: 1 })], output("data")));
    expect(data.status).toBe("completed"); expect(data.gateRef).toBeUndefined();
    const forged = await start(f.service, program([], literal({ status: "accepted" })), {}, "forge-accepted"); expect(forged.status).toBe("needs-attention");
  });
  test("close retains the active cycle until its durable finalizer read settles", async () => {
    const f = await fixture(); let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const read = f.service.store.read.bind(f.service.store); let intercept = true;
    f.service.store.read = async id => {
      const state = await read(id);
      if (intercept && state?.status === "completed") { intercept = false; entered(); await held; }
      return state;
    };
    const started = await f.service.execute("program-start", { requestId: "finalizer", program: program([value("done", { value: 1 })], output("done")), input: {} }) as ProgramRunV2;
    await reached;
    const active = (f.service as unknown as { active: Map<string, Promise<void>> }).active;
    const closing = f.service.close();
    try { expect(active.has(started.runId)).toBe(true); }
    finally { release(); await closing; }
    expect(active.has(started.runId)).toBe(false);
  });
  test("expression expansion stops at byte/item bounds before concat allocation", async () => {
    const f = await fixture(); f.catalog.policies["local@v1"].maxOutputBytes = 4096;
    const workflow = program([value("blob", { value: literal(["a".repeat(3000)]) }), value("expand", { value: { $expr: "concat", args: [output("blob"), output("blob")] } })], output("expand"));
    const state = await start(f.service, workflow); expect(state.status).toBe("needs-attention"); expect(state.reason).toContain("byte budget"); expect(state.operations.blob.status).toBe("completed");
  });
  test("history stateRefs reconstruct prior programs and retired templates remain observable", async () => {
    const f = await fixture(); f.catalog.policies["local@v1"].allowFencedReplan = true;
    const workflow = program([value("keep", { value: 1 }), value("remove", { value: 2 })], output("keep")); let state = await start(f.service, workflow);
    const previousVersion = state.version, history = await f.service.store.history(state.runId); expect((await f.service.store.get<ProgramRunV2>(history.at(-1)!.stateRef)).program.steps).toHaveLength(2);
    const replacement = program([value("keep", { value: 1 })], output("keep"));
    state = await control(f.service, "program-replan", { runId: state.runId, requestId: "remove", expectedVersion: state.version, mode: "fenced", program: replacement }) as ProgramRunV2;
    expect(state.operations.remove.status).toBe("skipped"); expect(state.operations.remove.retired).toBe(true);
    await control(f.service, "program-resume", { runId: state.runId, requestId: "resume", expectedVersion: state.version }); state = await finish(f.service, state.runId);
    expect(state.status).toBe("completed"); const prior = (await f.service.store.history(state.runId)).find(entry => entry.version === previousVersion)!;
    expect((await f.service.store.get<ProgramRunV2>(prior.stateRef)).program.steps).toHaveLength(2); expect(state.program.steps).toHaveLength(1);
  });
  test("a trailing value cannot mask rejected item repair, and late uncertainty blocks an early gate", async () => {
    const f = await fixture(input => input.executor.id === "review" ? { outcome: "completed", data: { verdict: "changes_requested", findings: ["not migrated"] } } : { outcome: "completed", data: { passed: false } }, ["a"]);
    const workflow = program([map("items", { items: [{ id: "a" }], key: field(item(), "id"), coverage: coverageFor(population(), { items: [{ id: "a" }] }), completion: "all-required", body: { steps: [repairStep(), value("ignored", { value: 1 })], result: output("ignored") } })], output("items")); workflow.population = populationRef("components", "v1");
    const state = await start(f.service, workflow); expect(state.status).toBe("needs-attention"); expect(state.gateRef).toBeUndefined();
    const late = await fixture(input => input.executor.id === "read" ? { outcome: "uncertain", reason: "lost process" } : { outcome: "completed", data: input.executor.id === "review" ? { verdict: "approved", findings: [] } : { passed: true } });
    const lateState = await start(late.service, program([repairStep(), gate("early", { candidate: acceptedCandidate("repair") }), { kind: "agent", id: "late", options: { executor: executorRef("read", "v1"), input: {} } }], output("early")));
    expect(lateState.status).toBe("needs-attention"); expect(Object.values(lateState.attempts).some(attempt => attempt.outcome === "uncertain")).toBe(true);
    await expect(late.service.execute("program-apply", { runId: lateState.runId, requestId: "unsafe", expectedVersion: lateState.version, authorization: "host" })).rejects.toThrow("gate");
  });
  test("the shipped authoring example lowers and validates against its owner registry", async () => {
    const source = await readFile(join(process.cwd(), "examples/agent-fabric-v2/migrate.workflow.ts"), "utf8"), catalog = JSON.parse(await readFile(join(process.cwd(), "examples/agent-fabric-v2/registry.example.json"), "utf8"));
    const lowered = lowerWorkflowSource(source); expect(() => validateWorkflowProgram(lowered, catalog)).not.toThrow(); expect(lowered.steps[1].options.body).toMatchObject({ kind: "repair", options: { recipe: { id: "repair", version: "v2" }, entryMode: "implement-first" } });
  });
});
