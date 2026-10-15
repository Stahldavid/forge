import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ProgramRunService } from "../../src/forge/agent-fabric/program-service.ts";
import { schemaRef, policyRef, acceptanceRef, executorRef, recipeRef, defineWorkflow, repair, output, candidateFromBaseline } from "../../src/forge/agent-fabric/program-dsl.ts";
import type { ProgramRegistry, ProgramRunV2 } from "../../src/forge/agent-fabric/program-contract.ts";
import type { ProgramWorkerAdapter } from "../../src/forge/agent-fabric/program-worker.ts";

const mode = process.argv[2], root = process.argv[3];
if (!["close", "deadline"].includes(mode) || !root) throw new Error("Expected close/deadline and an owned fixture root");
const ref = (id: string) => ({ id, version: "v1" });
let entered!: () => void, release!: () => void;
const reviewing = new Promise<void>(resolve => { entered = resolve; });
const released = new Promise<void>(resolve => { release = resolve; });
let phase = "startup", service: ProgramRunService | undefined, runId: string | undefined, lastState: ProgramRunV2 | undefined;
const watchdog = setTimeout(() => {
  console.log(JSON.stringify({ ok: false, code: "REPAIR_DID_NOT_STOP", mode, phase, status: lastState?.status, infrastructure: lastState?.repairs.fix?.infrastructure, version: lastState?.version }));
  process.exit(1);
}, 5000);
const observer = setInterval(() => {
  if (service && runId) void service.store.read(runId).then(state => { lastState = state; }).catch(() => {});
}, 50);
try {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "fixture.txt"), "owned fixture\n");
  const command = { ...ref("review"), kind: "command" as const, effect: "read" as const, role: "reviewer" as const, argv: [process.execPath], timeoutMs: 10000, writeScope: [] as string[], network: "host" as const, isolation: "cooperative" as const, schema: ref("any") };
  const registry: ProgramRegistry = {
    schemas: { "any@v1": {} },
    executors: { "review@v1": command, "implement@v1": { ...command, id: "implement", effect: "isolated-write", role: "implementer", writeScope: ["src"] } },
    policies: { "local@v1": { ...ref("local"), maxItems: 10, concurrency: 1, maxAttempts: 10, maxOperations: 20, maxDepth: 5, deadlineMs: 30000, maxOutputBytes: 100000, writeScope: ["src"], executors: ["review@v1", "implement@v1"], allowNetwork: true, allowCooperativeCommands: true } },
    acceptance: { "goal@v1": { ...ref("goal"), criteria: ["complete"], writeScope: ["src"], requiredChecks: [], requireReview: true, allowNoWork: true } },
    populations: {},
  };
  const adapter: ProgramWorkerAdapter = async input => ({ directory: root, inputDigest: "fixture", async execute() {
    if (input.executor.id !== "review") throw new Error("Unexpected implementation in terminal-stop fixture");
    entered(); await released;
    return { outcome: "completed", data: { verdict: "inconclusive", findings: [] } };
  } });
  service = await ProgramRunService.open(root, registry, adapter);
  const program = defineWorkflow({ mode: "data", id: "repair-stop", version: 1, inputSchema: schemaRef("any", "v1"), outputSchema: schemaRef("any", "v1"), policy: policyRef("local", "v1"), acceptance: acceptanceRef("goal", "v1"), steps: [
    repair("fix", { recipe: recipeRef("repair", "v2"), implement: executorRef("implement", "v1"), review: executorRef("review", "v1"), writeScope: ["src"], entryMode: "assess-first", initialCandidate: candidateFromBaseline(), assessmentScope: "final", checks: [], maxRepairRounds: 1, maxAssessmentAttempts: 3, maxInfrastructureAttempts: 2, progressPolicy: { unchangedCandidateRounds: 2, repeatedFindingsRounds: 2 } }),
  ], result: output("fix") });
  const started = await service.execute("program-start", { requestId: "terminal-stop", program, input: {} }) as ProgramRunV2;
  runId = started.runId; phase = "waiting-review"; await reviewing;
  phase = `terminal-${mode}`;
  if (mode === "close") {
    const closing = service.close(); release(); await closing;
  } else {
    await service.store.transact(runId, "fixture-expired-deadline", current => { current!.deadlineAt = new Date(0).toISOString(); return current!; });
    release();
    while ((await service.store.read(runId))?.status === "executing") await new Promise(resolve => setTimeout(resolve, 5));
    await service.close();
  }
  const state = (await service.store.read(runId))!;
  if (state.status !== "needs-attention") throw new Error(`Unexpected terminal status: ${state.status}`);
  if ((state.repairs.fix?.infrastructure ?? 0) > 2) throw new Error("Infrastructure retries exceeded the declared limit");
  await new Promise(resolve => setTimeout(resolve, 50));
  const stable = (await service.store.read(runId))!;
  if (stable.version !== state.version) throw new Error("Persistence continued after terminal settlement");
  clearInterval(observer); clearTimeout(watchdog);
  console.log(JSON.stringify({ ok: true, mode, phase, status: state.status, reason: state.reason, infrastructure: state.repairs.fix?.infrastructure ?? 0, version: state.version, stableVersion: stable.version }));
} catch (error) {
  clearInterval(observer); clearTimeout(watchdog);
  console.log(JSON.stringify({ ok: false, code: "FIXTURE_FAILED", mode, phase, message: (error as Error).message }));
  process.exit(1);
}
