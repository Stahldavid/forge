/** Runtime-only profile: deterministic adapter, fixed tasks/fault, zero providers. */
import { mkdtemp, rm, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProgramRunService } from "../src/forge/agent-fabric/program-service.ts";
import { programDigest, type ProgramRegistry, type ProgramRunV2 } from "../src/forge/agent-fabric/program-contract.ts";
import { defineWorkflow, schemaRef, executorRef, policyRef, acceptanceRef, agent, map, item, field, output } from "../src/forge/agent-fabric/program-dsl.ts";
import type { ProgramWorkerAdapter } from "../src/forge/agent-fabric/program-worker.ts";

process.env.FORGE_FABRIC_TEST_MODE = "1";
const sizes = [12, 48, 96], repeats = 1;
const profiles: unknown[] = [];
for (const size of sizes) {
const dataset = { items: Array.from({ length: size }, (_, index) => ({ id: `item-${index}` })), failure: "item-7", delayMs: 3, concurrency: 4, repeats };
const runs: unknown[] = [];
for (let repeat = 0; repeat < dataset.repeats; repeat++) {
  const root = await mkdtemp(join(tmpdir(), "forge-runtime-profile-"));
  let service: ProgramRunService | undefined;
  try {
    const registry: ProgramRegistry = { schemas: { "any@v2": {} }, executors: { "read@v2": { id: "read", version: "v2", kind: "codex", effect: "read", role: "investigator", timeoutMs: 5000, writeScope: [], network: "disabled", isolation: "sandbox", schema: schemaRef("any", "v2") } },
      policies: { "local@v2": { id: "local", version: "v2", concurrency: 4, maxItems: 100, maxAttempts: 256, maxOperations: 2000, maxDepth: 8, deadlineMs: 180000, maxOutputBytes: 65536, writeScope: [], executors: ["read@v2"], allowNetwork: false, allowCooperativeCommands: false } },
      acceptance: { "data@v2": { id: "data", version: "v2", criteria: ["fixed deterministic dataset"], writeScope: [], requiredChecks: [], requireReview: false, allowNoWork: false } }, populations: {} };
    let fail = true, peak = 0, active = 0;
    const calls: string[] = [];
    const adapter: ProgramWorkerAdapter = async input => ({ directory: root, inputDigest: programDigest(input.data), async execute() {
      const id = String((input.data as { id: string }).id); calls.push(id); peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, dataset.delayMs)); active--;
      return fail && id === dataset.failure ? { outcome: "infrastructure_failed", reason: "fixed injected failure" } : { outcome: "completed", data: { id, value: 42 } };
    } });
    service = await ProgramRunService.open(root, registry, adapter);
    const program = defineWorkflow({ id: "profile", version: 1, mode: "data", inputSchema: schemaRef("any", "v2"), outputSchema: schemaRef("any", "v2"), policy: policyRef("local", "v2"), acceptance: acceptanceRef("data", "v2"),
      steps: [map("items", { items: dataset.items, key: field(item(), "id"), completion: "all-required", body: agent("read", { executor: executorRef("read", "v2"), input: item() }) })], result: output("items") });
    const start = performance.now(), initial = await service.execute("program-start", { requestId: "start", program, input: {} }) as ProgramRunV2;
    async function settled() { let run: ProgramRunV2; do { await new Promise(resolve => setTimeout(resolve, 5)); run = (await service!.store.read(initial.runId))!; } while (run.status === "executing"); return run; }
    const failed = await settled(), coldStorage = {...service.store.metrics}, coldMs = performance.now() - start, beforeCalls = calls.length, recovery = performance.now();
    if (failed.status !== "needs-attention") throw new Error("Expected injected failure");
    await service.close(); service = await ProgramRunService.open(root, registry, adapter); fail = false;
    await service.execute("program-resume", { runId: initial.runId, requestId: "resume", expectedVersion: failed.version });
    const final = await settled(), recoveryMs = performance.now() - recovery;
    if (final.status !== "completed" || final.totalAttempts !== size + 1 || calls.length - beforeCalls !== 1 || calls.at(-1) !== dataset.failure) throw new Error(`Recovery invariant failed: ${JSON.stringify({size,status:final.status,attempts:final.totalAttempts,recoveryCalls:calls.length-beforeCalls,last:calls.at(-1),reason:final.reason})}`);
    let diskBytes = 0; async function collectSize(path: string): Promise<void> { for (const entry of await readdir(path, { withFileTypes: true })) { const file = join(path, entry.name); if (entry.isDirectory()) await collectSize(file); else diskBytes += (await stat(file)).size; } } await collectSize(service.store.directory);
    runs.push({ coldMs: Math.round(coldMs), recoveryMs: Math.round(recoveryMs), attempts: final.totalAttempts, recoveryCalls: calls.length - beforeCalls, intactRepeatedCalls: calls.filter(id => id !== dataset.failure).length - (size - 1), peak, diskBytes, coldStorage, recoveryStorage: service.store.metrics, llmCalls: 0 });
  } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
}
profiles.push({ dataset, datasetDigest: programDigest(dataset), runs });
}
const report = { profiles, sizes, repeats, llmCalls: 0, limitations: ["Deterministic adapter; not a Claude benchmark or model quality evaluation", "Local filesystem snapshots; latency is host-specific", "No external effects or provider calls"] };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
