import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProgramRunService } from "../../src/forge/agent-fabric/program-service.ts";
import { ProgramRunStore } from "../../src/forge/agent-fabric/program-store.ts";
import { type ProgramRegistry, type ProgramRunV2, programDigest } from "../../src/forge/agent-fabric/program-contract.ts";
import { defineWorkflow, schemaRef, policyRef, acceptanceRef, executorRef, recipeRef, repair, gate, acceptedCandidate, candidateFromBaseline, output } from "../../src/forge/agent-fabric/program-dsl.ts";
import { createTraceOwnerConfiguration, createTraceRuntime, observeTraceRunGit } from "../../src/forge/agent-fabric/trace-owner-runtime.ts";
import { normalizeTraceAgentMemorySlice, type TraceAgentMemoryRef } from "../../src/forge/agent-fabric/trace-contract.ts";
import { DeltaStore } from "../../src/forge/delta/store.ts";
import type { AgentEventEnvelope } from "../../src/forge/agent-memory/types.ts";

export function fixtureGit(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", root, ...args], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" } }).trim();
}
export async function createTraceFixture(options: { lateOrigin?: boolean; identitySuffix?: string; dirtyOutsideAtStart?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "forge-trace-pilot-"));
  await mkdir(join(root, "src")); await mkdir(join(root, ".forge"));
  await writeFile(join(root, "src/a.txt"), "old-a\n"); await writeFile(join(root, "src/b.txt"), "old-b\n");
  await writeFile(join(root, ".gitignore"), ".forge/\n.codex/\nnode_modules/\n");
  fixtureGit(root, "init", "--quiet"); fixtureGit(root, "config", "core.autocrlf", "false"); fixtureGit(root, "add", ".");
  fixtureGit(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture baseline");
  if (options.dirtyOutsideAtStart) await writeFile(join(root, "outside.txt"), "preexisting outside work\n");
  const identity = { repositoryId: "fixture-repository", checkoutId: `fixture-checkout-${options.identitySuffix ?? "A"}`, fabricStoreId: `fixture-store-${options.identitySuffix ?? "A"}` };
  const memory = { memoryStoreId: "fixture-memory", sourceNamespace: "fixture-host" };
  const configuration = await createTraceOwnerConfiguration(root, identity, memory);
  await writeFile(join(root, ".forge/fabric-trace.json"), JSON.stringify(configuration));
  const delta = await DeltaStore.open(root, { access: "write" });
  const envelope: AgentEventEnvelope = {
    schema: "forge.agent-event.v1", source: { agent: "generic", integration: "manual-import", version: "fixture-v1" },
    workspace: { root, gitHead: fixtureGit(root, "rev-parse", "HEAD") }, session: { externalSessionId: "fixture-session", turnId: "fixture-turn" },
    event: { kind: "agent.tool.completed", timestamp: "2026-10-15T09:00:00.000Z" }, actor: { kind: "agent", name: "fixture-command" }, payload: { status: "passed" },
    privacy: { rawPromptStored: false, rawCompletionStored: false, rawToolArgsStored: false, transcriptImported: false, redacted: true, sensitiveFieldsRemoved: [] },
    capture: { trustLevel: "manual-import", confidence: 1 },
  };
  const summary = "Fixture changes two public text files";
  let memoryRef: TraceAgentMemoryRef | undefined;
  const recordMemory = async () => {
    const event = await delta.recordAgentMemoryEvent({ envelope, summary, idempotencyKey: "fixture-origin-occurrence" });
    const slice = normalizeTraceAgentMemorySlice({ sourceNamespace: memory.sourceNamespace, integration: envelope.source.integration, externalSessionId: "fixture-session", turnId: "fixture-turn", eventType: envelope.event.kind, summary });
    memoryRef = { memoryStoreId: memory.memoryStoreId, eventId: event.id, eventDigest: programDigest(slice), sourceNamespace: memory.sourceNamespace }; return memoryRef;
  };
  if (!options.lateOrigin) await recordMemory();
  const executor = (id: string, script: string, role: "implementer" | "reviewer" | "investigator", write = false) => ({
    id, version: "v1", kind: "command" as const, argv: [process.execPath, "-e", script], role, effect: write ? "isolated-write" as const : "read" as const,
    writeScope: write ? ["src"] : [], timeoutMs: 10000, network: "host" as const, isolation: "cooperative" as const, schema: schemaRef("any", "v1"), dependencies: "none" as const, tokenAccounting: "none" as const,
  });
  // The command adapter truthfully exposes its namespace network. The pilot runner supplies an OS network namespace without egress.
  const verify = `const f=require('fs');const ok=f.readFileSync('src/a.txt','utf8')==='new-a\\n'&&f.readFileSync('src/b.txt','utf8')==='new-b\\n';`;
  const registry: ProgramRegistry = { schemas: { "any@v1": {} }, executors: {
    "writer@v1": executor("writer", `const f=require('fs');f.writeFileSync('src/a.txt','new-a\\n');f.writeFileSync('src/b.txt','new-b\\n');console.log(JSON.stringify({summary:'fixture changed'}));`, "implementer", true),
    "review@v1": executor("review", verify + `console.log(JSON.stringify({verdict:ok?'approved':'changes_requested',findings:ok?[]:['fixture content mismatch']}));`, "reviewer"),
    "check@v1": executor("check", verify + `console.log(JSON.stringify({passed:ok}));`, "investigator"),
  }, policies: { "fixture@v1": { id: "fixture", version: "v1", concurrency: 2, maxItems: 10, maxAttempts: 50, maxOperations: 1000, maxDepth: 8, deadlineMs: 120000,
    maxOutputBytes: 4 * 1024 * 1024, writeScope: ["src"], executors: ["writer@v1", "review@v1", "check@v1"], allowCooperativeCommands: true, allowNetwork: true } },
  acceptance: { "fixture@v1": { id: "fixture", version: "v1", criteria: ["both public fixture files changed"], writeScope: ["src"], requireReview: true, requiredChecks: ["check@v1"], allowNoWork: false } }, populations: {} };
  const program = defineWorkflow({ id: "trace-fixture", version: 1, inputSchema: schemaRef("any", "v1"), outputSchema: schemaRef("any", "v1"), policy: policyRef("fixture", "v1"), acceptance: acceptanceRef("fixture", "v1"),
    steps: [repair("edit", { recipe: recipeRef("repair", "v2"), implement: executorRef("writer", "v1"), review: executorRef("review", "v1"), checks: ["check@v1"], maxRepairRounds: 2, maxAssessmentAttempts: 4, maxInfrastructureAttempts: 1,
      entryMode: "implement-first", initialCandidate: candidateFromBaseline(), progressPolicy: { unchangedCandidateRounds: 1, repeatedFindingsRounds: 1 }, writeScope: ["src"] }), gate("final", { candidate: acceptedCandidate("edit") })], result: output("final") });
  const service = await ProgramRunService.open(root, registry, undefined, { trace: createTraceRuntime(root, configuration) });
  const started = await service.execute("program-start", { requestId: "fixture-start", program, input: {}, trace: { origins: [{ origin: { issuerNamespace: memory.sourceNamespace, integration: "manual-import", externalSessionId: "fixture-session", turnId: "fixture-turn" }, agentMemoryRefs: memoryRef ? [memoryRef] : [] }] } }) as ProgramRunV2;
  const read = () => service.execute("program-status", { runId: started.runId }) as Promise<ProgramRunV2>;
  const finish = async () => {
    const end = Date.now() + 60000;
    for (;;) { const run = await read(); if (run.status !== "executing") return run; if (Date.now() >= end) throw new Error("Trace fixture timeout"); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  const complete = async () => {
    let run = await finish(); if (run.status !== "acceptance-ready") throw new Error(`Fixture failed: ${run.status}: ${run.reason}`);
    run = await service.execute("program-apply", { runId: run.runId, requestId: "fixture-apply", expectedVersion: run.version, authorization: "fixture controller authorizes only fixture src files" }) as ProgramRunV2;
    if (run.status !== "applied") throw new Error(`Fixture application failed: ${run.status}`);
    fixtureGit(root, "add", "src"); fixtureGit(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture candidate integration");
    const observation = await observeTraceRunGit({ root, identity, run, candidateDigest: run.acceptedCandidate!.digest, commitOid: fixtureGit(root, "rev-parse", "HEAD"), hostReported: true });
    const result = await service.execute("program-trace-annotate", { runId: run.runId, requestId: "fixture-git-link", expectedVersion: run.version, annotation: { type: "git-observation", observation } }) as ProgramRunV2;
    return { run: result, observation };
  };
  return { root, identity, configuration, delta, service, started, recordMemory, read, finish, complete,
    startAdditional: (requestId: string) => service.execute("program-start", { requestId, program, input: {}, trace: { origins: [{ origin: { issuerNamespace: memory.sourceNamespace, integration: "manual-import", externalSessionId: "fixture-session", turnId: "fixture-turn" }, agentMemoryRefs: [] }] } }) as Promise<ProgramRunV2>,
    async store() { const store = await ProgramRunStore.openReadOnly(root, identity); if (!store) throw new Error("Fixture source missing"); return store; },
    async close(preserve = false) { await service.close(); await delta.close(); if (!preserve) await rm(root, { recursive: true, force: true }); },
    readFile: (path: string) => readFile(join(root, path), "utf8"),
  };
}
