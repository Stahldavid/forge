import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ProgramRunService } from "../src/forge/agent-fabric/program-service.ts";

if (!process.argv.includes("--yes")) throw new Error("Real SDK pilot requires --yes; it uses the configured account/model and may consume usage.");
const output = process.argv[process.argv.indexOf("--output") + 1];
if (!output || !process.argv.includes("--output")) throw new Error("--output PATH is required");
const root = await mkdtemp(join(tmpdir(), "forge-program-sdk-pilot-"));
await mkdir(join(root, "src")); await writeFile(join(root, "src/input.txt"), "fabric-v2-pilot");
for (const args of [["init", "--quiet"], ["add", "src"], ["-c", "user.name=Forge Pilot", "-c", "user.email=pilot@example.invalid", "commit", "--quiet", "-m", "pilot baseline"]]) {
  if (spawnSync("git", args, { cwd: root, windowsHide: true }).status !== 0) throw new Error("Pilot Git preparation failed");
}
const ref = id => ({ id, version: "v1" }), modelIndex = process.argv.indexOf("--model"), model = modelIndex >= 0 ? process.argv[modelIndex + 1] : "gpt-6.1-sol";
const registry = {
  schemas: { "input@v1": { type: "object", properties: {}, required: [], additionalProperties: false }, "answer@v1": { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } },
  executors: { "read@v1": { id: "read", version: "v1", kind: "codex", role: "investigator", effect: "read", model, prompt: "Read src/input.txt and return its exact contents as answer. Do not edit any file. No other work is needed.", timeoutMs: 90000, writeScope: [], network: "disabled", isolation: "sandbox", schema: ref("answer"), cache: "none" } },
  policies: { "pilot@v1": { id: "pilot", version: "v1", captureScope: ["src"], writeScope: [], concurrency: 1, maxItems: 1, maxAttempts: 1, maxOperations: 4, maxDepth: 2, deadlineMs: 110000, maxOutputBytes: 4096, executors: ["read@v1"], allowNetwork: false, allowCooperativeCommands: false } },
  acceptance: { "pilot@v1": { id: "pilot", version: "v1", writeScope: [], criteria: ["exact input read"], requiredChecks: [], requireReview: false, allowNoWork: false } }, populations: {},
};
const program = { schemaVersion: 2, id: "sdk-pilot", version: 1, inputSchema: ref("input"), outputSchema: ref("answer"), policy: ref("pilot"), acceptance: ref("pilot"), steps: [{ kind: "agent", id: "read", options: { executor: ref("read"), input: {} } }], result: { $expr: "output", args: ["read"] } };
const service = await ProgramRunService.open(root, registry); const startedAt = new Date().toISOString(); let state;
try {
  state = await service.execute("program-start", { requestId: "pilot", program, input: {} });
  while (state.status === "executing") { await new Promise(resolve => setTimeout(resolve, 200)); state = await service.execute("program-status", { runId: state.runId }); }
  const result = state.resultRef ? await service.store.get(state.resultRef) : null, unchanged = await readFile(join(root, "src/input.txt"), "utf8") === "fabric-v2-pilot";
  const passed = state.status === "completed" && result?.answer === "fabric-v2-pilot" && unchanged && Object.values(state.attempts).every(attempt => attempt.outcome === "completed" && attempt.threadId);
  const evidence = { kind: "actual-sdk-readonly-pilot", startedAt, finishedAt: new Date().toISOString(), root, model, passed, status: state.status, attempts: state.totalAttempts, threadIds: Object.values(state.attempts).map(attempt => attempt.threadId ?? null), outcomes: Object.values(state.attempts).map(attempt => attempt.outcome), inputUnchanged: unchanged, typedResultMatches: result?.answer === "fabric-v2-pilot", reason: state.reason ?? null, limitations: ["one local readonly activity", "no code migration, publication, production or App-closed acceptance", "no Claude product benchmark"] };
  await writeFile(resolve(output), JSON.stringify(evidence, null, 2) + "\n"); console.log(JSON.stringify(evidence)); if (!passed) process.exitCode = 1;
} finally { await service.close(); }
