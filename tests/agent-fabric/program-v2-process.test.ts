import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProgramRunService } from "../../src/forge/agent-fabric/program-service.ts";
import { type ProgramRegistry, type ProgramRunV2 } from "../../src/forge/agent-fabric/program-contract.ts";
import { defineWorkflow, schemaRef, policyRef, acceptanceRef, populationRef, executorRef, recipeRef, agent, map, item, field, population, coverageFor, output, repair, candidateFromBaseline, compose, acceptedCandidates, outputCandidate, acceptedCandidate, gate, coverageReceipt } from "../../src/forge/agent-fabric/program-dsl.ts";
import { serveLocalTasks, requestProgramRun } from "../../src/forge/agent-fabric/local-task-server.ts";

const roots: string[] = [], services: { close(): Promise<void> }[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function project(names = ["a.txt"]) {
  const root = await mkdtemp(join(tmpdir(), "forge-program-process-")); roots.push(root); await mkdir(join(root, "src")); await mkdir(join(root, ".forge")); await writeFile(join(root, "src/a.txt"), "old");
  for (const name of names) await writeFile(join(root, "src", name), "old");
  for (const args of [["init", "--quiet"], ["add", "src"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "base"]]) { const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }); if (result.status) throw new Error(result.stderr); }
  const executor = (id: string, script: string, role: "implementer" | "reviewer" | "investigator", effect: "read" | "isolated-write") => ({ id, version: "v1", kind: "command" as const, argv: [process.execPath, "-e", script], timeoutMs: 10000, role, effect, writeScope: effect === "read" ? [] : ["src"], network: "host" as const, isolation: "cooperative" as const, schema: schemaRef("any", "v1") });
  const registry: ProgramRegistry = { schemas: { "any@v1": {} }, executors: {
    "discover@v1": executor("discover", `const fs=require('fs'); console.log(JSON.stringify({items:fs.readdirSync('src').map(name=>({id:'src/'+name,allowedPaths:['src/'+name]}))}));`, "investigator", "read"),
    "implement@v1": executor("implement", `const fs=require('fs'), data=JSON.parse(fs.readFileSync(process.env.FORGE_PROGRAM_INPUT_PATH,'utf8')); const paths=data.workItem?[data.workItem.id]:fs.readdirSync('src').map(name=>'src/'+name); for(const path of paths)fs.writeFileSync(path,'new'); console.log(JSON.stringify({summary:'changed'}));`, "implementer", "isolated-write"),
    "review@v1": executor("review", `const fs=require('fs'), data=JSON.parse(fs.readFileSync(process.env.FORGE_PROGRAM_INPUT_PATH,'utf8')); const paths=data.workItem?[data.workItem.id]:fs.readdirSync('src').map(name=>'src/'+name); const ok=paths.every(path=>fs.readFileSync(path,'utf8')==='new'); console.log(JSON.stringify({verdict:ok?'approved':'changes_requested',findings:ok?[]:['must migrate']}));`, "reviewer", "read"),
    "check@v1": executor("check", `const fs=require('fs'), data=JSON.parse(fs.readFileSync(process.env.FORGE_PROGRAM_INPUT_PATH,'utf8')); const paths=data.workItem?[data.workItem.id]:fs.readdirSync('src').map(name=>'src/'+name); console.log(JSON.stringify({passed:paths.every(path=>fs.readFileSync(path,'utf8')==='new')}));`, "investigator", "read") },
    policies: { "local@v1": { id: "local", version: "v1", concurrency: 4, maxItems: 100, maxAttempts: 100, maxOperations: 1000, maxDepth: 8, deadlineMs: 120000, maxOutputBytes: 4 * 1024 * 1024, writeScope: ["src"], executors: ["discover@v1", "implement@v1", "review@v1", "check@v1"], allowNetwork: true, allowCooperativeCommands: true } },
    acceptance: { "goal@v1": { id: "goal", version: "v1", criteria: ["migrated"], writeScope: ["src"], requireReview: true, requiredChecks: ["check@v1"], allowNoWork: false } },
    populations: { "files@v1": { id: "files", version: "v1", members: [], exclusions: [], baselineDigest: "capture", inventoryRoots: ["src"], extensions: [".txt"], evidence: "owner inventory", allowNoWork: false } } };
  await writeFile(join(root, ".forge/fabric-programs.json"), JSON.stringify(registry));
  const recipe = { recipe: recipeRef("repair", "v1"), implement: executorRef("implement", "v1"), review: executorRef("review", "v1"), checks: ["check@v1"], maxRepairRounds: 3, maxAssessmentAttempts: 6, maxInfrastructureAttempts: 2, progressPolicy: { unchangedCandidateRounds: 2, repeatedFindingsRounds: 2 } };
  const program = defineWorkflow({ id: "migrate", version: 1, inputSchema: schemaRef("any", "v1"), outputSchema: schemaRef("any", "v1"), acceptance: acceptanceRef("goal", "v1"), population: populationRef("files", "v1"), policy: policyRef("local", "v1"), steps: [
    agent("discover", { executor: executorRef("discover", "v1"), input: {} }),
    map("migrate", { items: field(output("discover"), "items"), key: field(item(), "id"), coverage: coverageFor(population(), output("discover")), completion: "all-required", concurrency: 4,
      body: repair("component", { ...recipe, entryMode: "implement-first", initialCandidate: candidateFromBaseline(item()), writeScope: field(item(), "allowedPaths") }) }),
    compose("integrate", { candidates: acceptedCandidates("migrate"), onConflict: "needs-resolution" }),
    repair("integration", { ...recipe, entryMode: "assess-first", initialCandidate: outputCandidate("integrate"), writeScope: ["src"] }),
    gate("final", { candidate: acceptedCandidate("integration"), coverage: coverageReceipt("migrate") }),
  ], result: output("final") });
  return { root, registry, program };
}
async function finish(read: () => Promise<unknown>): Promise<ProgramRunV2> {
  const deadline = Date.now() + 60000;
  for (;;) { const run = await read() as ProgramRunV2; if (run.status !== "executing") return run; if (Date.now() >= deadline) throw new Error("Process fixture timeout"); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test("actual commands migrate, compose, assess and apply once from frozen intent", async () => {
  const f = await project(), service = await ProgramRunService.open(f.root); services.push(service);
  const started = await service.execute("program-start", { requestId: "start", program: f.program, input: {} }) as ProgramRunV2;
  const run = await finish(() => service.execute("program-status", { runId: started.runId }));
  expect(run.reason).toBeUndefined(); expect(run.status).toBe("acceptance-ready"); expect(await readFile(join(f.root, "src/a.txt"), "utf8")).toBe("old");
  expect(run.registry.populations["files@v1"].members).toEqual(["src/a.txt"]); expect(run.totalAttempts).toBe(6);
  const request = { runId: run.runId, requestId: "apply", expectedVersion: run.version, authorization: "fixture host authorizes src local application" };
  const applied = await Promise.all([service.execute("program-apply", request), service.execute("program-apply", request)]) as ProgramRunV2[];
  expect(applied.map(run => run.status)).toEqual(["applied", "applied"]); expect(applied[0].intent?.id).toBe(applied[1].intent?.id); expect(applied[0].version).toBe(applied[1].version);
  expect(await readFile(join(f.root, "src/a.txt"), "utf8")).toBe("new");
  await expect(service.execute("program-apply", { ...request, authorization: "changed body" })).rejects.toThrow("changed");
}, 120000);

test("external destination edits are preserved and application becomes uncertain", async () => {
  const f = await project(), service = await ProgramRunService.open(f.root); services.push(service);
  const started = await service.execute("program-start", { requestId: "start", program: f.program, input: {} }) as ProgramRunV2, run = await finish(() => service.execute("program-status", { runId: started.runId }));
  expect(run.status).toBe("acceptance-ready"); await writeFile(join(f.root, "src/a.txt"), "external-edit");
  const applied = await service.execute("program-apply", { runId: run.runId, requestId: "apply", expectedVersion: run.version, authorization: "fixture host" }) as ProgramRunV2;
  expect(applied.status).toBe("apply-uncertain"); expect(await readFile(join(f.root, "src/a.txt"), "utf8")).toBe("external-edit");
}, 120000);

test("v2 transports share the existing authenticated project owner", async () => {
  const f = await project(), owner = await serveLocalTasks(f.root); services.push(owner);
  const validation = await requestProgramRun(f.root, "program-validate", { program: f.program }) as { valid: boolean }; expect(validation.valid).toBe(true);
  const started = await requestProgramRun(f.root, "program-start", { requestId: "transport", program: f.program, input: {} }) as ProgramRunV2;
  const run = await finish(() => requestProgramRun(f.root, "program-status", { runId: started.runId })); expect(run.reason).toBeUndefined(); expect(run.status).toBe("acceptance-ready");
}, 120000);
test("real workers receive distinct map items and compose independent file changes", async () => {
  const f = await project(["a.txt", "b.txt"]), service = await ProgramRunService.open(f.root); services.push(service);
  const started = await service.execute("program-start", { requestId: "two-files", program: f.program, input: { requirement: "migrate both files" } }) as ProgramRunV2;
  const run = await finish(() => service.execute("program-status", { runId: started.runId })); expect(run.reason).toBeUndefined(); expect(run.status).toBe("acceptance-ready"); expect(run.totalAttempts).toBe(9);
  const applied = await service.execute("program-apply", { runId: run.runId, requestId: "apply", expectedVersion: run.version, authorization: "fixture host" }) as ProgramRunV2;
  expect(applied.status).toBe("applied"); expect(await readFile(join(f.root, "src/a.txt"), "utf8")).toBe("new"); expect(await readFile(join(f.root, "src/b.txt"), "utf8")).toBe("new");
}, 120000);
test("readonly programs capture data without receiving source write authority", async () => {
  const f = await project(); f.registry.policies["local@v1"].captureScope = ["src"]; f.registry.policies["local@v1"].writeScope = []; f.registry.acceptance["goal@v1"].writeScope = [];
  const program = { ...f.program, steps: [agent("discover", { executor: executorRef("discover", "v1"), input: {} })], result: output("discover") }; delete program.population;
  const service = await ProgramRunService.open(f.root, f.registry); services.push(service);
  const started = await service.execute("program-start", { requestId: "read", program, input: {} }) as ProgramRunV2, run = await finish(() => service.execute("program-status", { runId: started.runId }));
  expect(run.reason).toBeUndefined(); expect(run.status).toBe("completed"); expect(await readFile(join(f.root, "src/a.txt"), "utf8")).toBe("old"); expect(run.gateRef).toBeUndefined();
}, 120000);
test("three repair deltas preserve successive beforeimages of the same file", async () => {
  const f = await project();
  f.registry.executors["implement@v1"].argv = [process.execPath, "-e", `const fs=require('fs');fs.writeFileSync('src/a.txt',fs.readFileSync('src/a.txt','utf8')+'x');console.log(JSON.stringify({summary:'next'}));`];
  f.registry.executors["review@v1"].argv = [process.execPath, "-e", `const ok=require('fs').readFileSync('src/a.txt','utf8')==='oldxxx'; console.log(JSON.stringify({verdict:ok?'approved':'changes_requested',findings:ok?[]:['one more x']}));`];
  f.registry.executors["check@v1"].argv = [process.execPath, "-e", `console.log(JSON.stringify({passed:require('fs').readFileSync('src/a.txt','utf8')==='oldxxx'}));`];
  const options = (f.program.steps[1].options.body as { options: Record<string, unknown> }).options;
  const program = { ...f.program, steps: [repair("three", { ...options, writeScope: ["src/a.txt"] }), gate("final", { candidate: acceptedCandidate("three") })], result: output("final") }; delete program.population;
  const service = await ProgramRunService.open(f.root, f.registry); services.push(service);
  const started = await service.execute("program-start", { requestId: "three", program, input: {} }) as ProgramRunV2, run = await finish(() => service.execute("program-status", { runId: started.runId }));
  expect(run.reason).toBeUndefined(); expect(run.status).toBe("acceptance-ready"); expect(run.acceptedCandidate?.deltas).toHaveLength(3); expect(run.repairs.three.rounds).toBe(3);
  const applied = await service.execute("program-apply", { runId: run.runId, requestId: "apply", expectedVersion: run.version, authorization: "fixture" }) as ProgramRunV2;
  expect(applied.status).toBe("applied"); expect(await readFile(join(f.root, "src/a.txt"), "utf8")).toBe("oldxxx");
}, 120000);
test("diamond composition applies the shared ancestor once", async () => {
  const f = await project(["a.txt", "b.txt", "c.txt"]), options = (f.program.steps[1].options.body as { options: Record<string, unknown> }).options;
  const edit = (id: string, path: string, candidate?: unknown) => agent(id, { executor: executorRef("implement", "v1"), input: { workItem: { id: path } }, writeScope: [path], ...(candidate ? { candidate } : {}) });
  const program = { ...f.program, steps: [edit("ancestor", "src/a.txt"), edit("left", "src/b.txt", outputCandidate("ancestor")), edit("right", "src/c.txt", outputCandidate("ancestor")), compose("diamond", { candidates: [outputCandidate("left"), outputCandidate("right")] }), repair("integration", { ...options, entryMode: "assess-first", initialCandidate: outputCandidate("diamond"), writeScope: ["src"] }), gate("final", { candidate: acceptedCandidate("integration") })], result: output("final") }; delete program.population;
  const service = await ProgramRunService.open(f.root, f.registry); services.push(service);
  const started = await service.execute("program-start", { requestId: "diamond", program, input: {} }) as ProgramRunV2, run = await finish(() => service.execute("program-status", { runId: started.runId }));
  expect(run.reason).toBeUndefined(); expect(run.status).toBe("acceptance-ready"); expect(run.acceptedCandidate?.deltas).toHaveLength(3);
  const applied = await service.execute("program-apply", { runId: run.runId, requestId: "apply", expectedVersion: run.version, authorization: "fixture" }) as ProgramRunV2;
  expect(applied.status).toBe("applied"); for (const name of ["a.txt", "b.txt", "c.txt"]) expect(await readFile(join(f.root, "src", name), "utf8")).toBe("new");
}, 120000);
test("independent producers of identical patches still conflict", async () => {
  const f = await project(), edit = (id: string) => agent(id, { executor: executorRef("implement", "v1"), input: { workItem: { id: "src/a.txt" } }, writeScope: ["src/a.txt"] });
  const program = { ...f.program, steps: [edit("left"), edit("right"), compose("conflict", { candidates: [outputCandidate("left"), outputCandidate("right")] })], result: output("conflict") }; delete program.population;
  const service = await ProgramRunService.open(f.root, f.registry); services.push(service);
  const started = await service.execute("program-start", { requestId: "conflict", program, input: {} }) as ProgramRunV2, run = await finish(() => service.execute("program-status", { runId: started.runId }));
  expect(run.status).toBe("needs-attention"); expect(run.reason).toContain("Independent writers conflict"); expect(Object.keys(run.deltas)).toHaveLength(2); expect(await readFile(join(f.root, "src/a.txt"), "utf8")).toBe("old");
}, 120000);
