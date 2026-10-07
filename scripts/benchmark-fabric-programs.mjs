import { mkdtemp, rm, stat, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { performance } from "node:perf_hooks";
import { ProgramRunService } from "../src/forge/agent-fabric/program-service.ts";
import { programDigest } from "../src/forge/agent-fabric/program-contract.ts";

const outputIndex = process.argv.indexOf("--output"), output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
if (!output) throw new Error("--output PATH is required");
const repetitions = 3, itemCount = 80, concurrency = 4;
const items = Array.from({ length: itemCount }, (_, index) => ({ id: "item-" + index })), ref = id => ({ id, version: "v1" }), expr = ($expr, ...args) => ({ $expr, args });
const sleep = () => new Promise(resolve => setTimeout(resolve, 1));
async function bytes(directory) { let total = 0; for (const entry of await readdir(directory, { withFileTypes: true })) total += entry.isDirectory() ? await bytes(join(directory, entry.name)) : (await stat(join(directory, entry.name))).size; return total; }
async function windowed(values, execute) { let cursor = 0; const results = new Array(values.length); await Promise.all(Array.from({ length: concurrency }, async () => { for (;;) { const index = cursor++; if (index >= values.length) return; results[index] = await execute(values[index]); } })); return results; }
const measurements = [];
for (let repetition = 0; repetition < repetitions; repetition++) {
  const root = await mkdtemp(join(tmpdir(), "forge-program-benchmark-"));
  const registry = { schemas: { "data@v1": {} }, executors: { "work@v1": { id: "work", version: "v1", kind: "command", role: "investigator", effect: "read", argv: [process.execPath, "-e", ""], timeoutMs: 10000, writeScope: [], network: "host", isolation: "cooperative", schema: ref("data") } }, policies: { "local@v1": { id: "local", version: "v1", maxItems: 100, concurrency, maxAttempts: 200, maxOperations: 1000, maxDepth: 8, deadlineMs: 180000, maxOutputBytes: 4194304, writeScope: [], executors: ["work@v1"], allowCooperativeCommands: true, allowNetwork: true } }, acceptance: { "data@v1": { id: "data", version: "v1", criteria: ["every data item observed"], writeScope: [], requiredChecks: [], requireReview: false, allowNoWork: false } }, populations: { "items@v1": { id: "items", version: "v1", members: items.map(item => item.id), exclusions: [], baselineDigest: programDigest({ root }), evidence: "frozen benchmark data", allowNoWork: false } } };
  const failed = new Set(), calls = [];
  const adapter = async input => ({ directory: root, reusable: true, inputDigest: programDigest({ executor: input.executor, data: input.data, candidate: input.candidate }), async execute() { const id = input.data.id; calls.push(id); await sleep(); if (["item-0", "item-1"].includes(id) && !failed.has(id)) { failed.add(id); return { outcome: "infrastructure_failed", reason: "deterministic observed fixture failure" }; } return { outcome: "completed", data: { id } }; } });
  const program = { schemaVersion: 2, id: "benchmark", version: 1, inputSchema: ref("data"), outputSchema: ref("data"), policy: ref("local"), acceptance: ref("data"), population: ref("items"), steps: [{ kind: "map", id: "items", options: { items, key: expr("field", expr("item"), "id"), coverage: expr("coverageFor", expr("population"), { items }), completion: "all-required", concurrency, body: { kind: "agent", id: "work", options: { executor: ref("work"), input: expr("item") } } } }], result: expr("output", "items") };
  const service = await ProgramRunService.open(root, registry, adapter); const start = performance.now(); let state;
  try {
    state = await service.execute("program-start", { requestId: "benchmark", program, input: {} });
    while (state.status === "executing") { await sleep(); state = await service.execute("program-status", { runId: state.runId }); }
    const firstStatus = state.status, recoveryStart = performance.now(); await service.close();
    const recovered = await ProgramRunService.open(root, registry, adapter);
    try { state = await recovered.execute("program-resume", { runId: state.runId, requestId: "resume", expectedVersion: state.version }); while (state.status === "executing") { await sleep(); state = await recovered.execute("program-status", { runId: state.runId }); } }
    finally { await recovered.close(); }
    const recoveryMs = performance.now() - recoveryStart, totalMs = performance.now() - start, retainedBytes = await bytes(join(root, ".forge/local/agent-fabric/program-runs"));
    const referenceStart = performance.now(), referenceCache = new Map(), referenceCalls = [], referenceFailures = new Set();
    const executeReference = async item => { if (referenceCache.has(item.id)) return referenceCache.get(item.id); referenceCalls.push(item.id); await sleep(); if (["item-0", "item-1"].includes(item.id) && !referenceFailures.has(item.id)) { referenceFailures.add(item.id); return null; } const result = { id: item.id }; referenceCache.set(item.id, result); return result; };
    await windowed(items, executeReference); await windowed(items, executeReference);
    const referenceMs = performance.now() - referenceStart, result = await service.store.get(state.resultRef), correct = firstStatus === "needs-attention" && state.status === "completed" && result.results.length === itemCount && calls.length === 82 && referenceCalls.length === 82;
    if (!correct) throw new Error("Benchmark correctness gate failed");
    measurements.push({ repetition: repetition + 1, fabric: { totalMs, recoveryMs, calls: calls.length, outputItems: result.results.length, status: state.status, retainedBytes, operations: Object.keys(state.operations).length, journalTransitions: (await service.store.history(state.runId)).length }, referenceModel: { totalMs: referenceMs, calls: referenceCalls.length, outputItems: referenceCache.size }, correct });
  } finally {
    await service.close(); const target = resolve(root); if (dirname(target) !== resolve(tmpdir()) || !/^forge-program-benchmark-[A-Za-z0-9]+$/.test(basename(target))) throw new Error("Benchmark cleanup target escaped owned temp directory"); await rm(target, { recursive: true, force: true });
  }
}
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const report = { kind: "deterministic-local-runtime-reference-benchmark", at: new Date().toISOString(), settings: { repetitions, itemCount, concurrency, activityDelayMs: 1, failures: 2, paidModels: false }, measurements, means: { fabricTotalMs: average(measurements.map(entry => entry.fabric.totalMs)), fabricRecoveryMs: average(measurements.map(entry => entry.fabric.recoveryMs)), referenceTotalMs: average(measurements.map(entry => entry.referenceModel.totalMs)) }, limitations: ["reference model is an in-memory procedural scheduler with completed-output replay, not Claude Code", "Fabric includes journal/stateRefs/restart; reference has no disk durability", "fake adapters attest pure inputs; no process clone/model quality/cost comparison", "three local repetitions; no production, high-concurrency or superiority claim"] };
await writeFile(resolve(output), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
