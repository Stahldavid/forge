import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ProgramRunService } from "../../src/forge/agent-fabric/program-service.ts";
import type { ProgramAuthorProposal } from "../../src/forge/agent-fabric/program-authoring.ts";
import { programDigest, type ProgramRegistry, type ProgramRunV2, type ProgramAssessmentContext } from "../../src/forge/agent-fabric/program-contract.ts";
import type { ProgramWorkerAdapter, ProgramWorkerInput } from "../../src/forge/agent-fabric/program-worker.ts";

test("authored review/bugfix/migration close owner gates without edits on correct baseline; negative review cannot write", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-template-execution-"));
  let service: ProgramRunService | undefined;
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
  const ref = (id: string) => ({ id, version: "v1" });
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.txt"), "correct\n");
    await writeFile(join(root, ".gitignore"), ".forge/\n");
    git("init", "-q"); git("config", "user.name", "Fabric Fixture"); git("config", "user.email", "fabric@example.invalid");
    git("add", "."); git("commit", "-qm", "Independent fixture baseline");
    const registry: ProgramRegistry = {
      schemas: { "any@v1": {}, "approval@v1": { type: "object", properties: { approved: { const: true } }, required: ["approved"] } }, executors: {},
      policies: { "local@v1": { ...ref("local"), maxItems: 4, concurrency: 2, maxAttempts: 40, maxOperations: 80, maxDepth: 8, deadlineMs: 15000, maxOutputBytes: 100000, writeScope: ["src"], executors: ["implement@v1", "review@v1", "check@v1"], allowCooperativeCommands: true, allowNetwork: true } },
      acceptance: { "goal@v1": { ...ref("goal"), criteria: ["Fixture remains correct"], writeScope: ["src"], requiredChecks: ["check@v1"], requireReview: true, allowNoWork: false } },
      populations: { "files@v1": { ...ref("files"), members: ["src/a.txt"], exclusions: [], baselineDigest: programDigest({ root }), evidence: "Independent one-file inventory", allowNoWork: false } },
    };
    for (const id of ["implement", "review", "check"]) registry.executors[`${id}@v1`] = {
      ...ref(id), kind: "command", argv: [process.execPath], schema: ref("any"), timeoutMs: 10000,
      role: id === "implement" ? "implementer" : id === "review" ? "reviewer" : "investigator",
      effect: id === "implement" ? "isolated-write" : "read", writeScope: id === "implement" ? ["src"] : [], network: "host", isolation: "cooperative", tokenAccounting: "none",
    };
    const calls: ProgramWorkerInput[] = []; let rejectReview = false;
    const adapter: ProgramWorkerAdapter = async input => ({ directory: root, inputDigest: programDigest({ data: input.data, candidate: input.candidate }), async execute() {
      calls.push(input);
      if (input.executor.id === "implement") throw new Error("Correct or read-only fixture must never dispatch implementation");
      const context = (input.data as { assessmentContext: ProgramAssessmentContext }).assessmentContext;
      return { outcome: "completed", data: input.executor.id === "review" ? {
        verdict: rejectReview ? "changes_requested" : "approved", findings: rejectReview ? ["Negative independent review"] : [], coveredObligationIds: context.obligationIds,
      } : { passed: true } };
    } });
    service = await ProgramRunService.open(root, registry, adapter);
    const options = { inputSchema: ref("any"), outputSchema: ref("any"), policy: ref("local"), acceptance: ref("goal"), implement: ref("implement"), review: ref("review"), population: ref("files"), approvalSchema: ref("approval") };
    await expect(service.execute("program-author", { kind: "review", options, registry: {} })).rejects.toThrow("owner-controlled");
    expect((await service.execute("program-author-types", {}) as { source: string }).source).toContain("OwnerSchemas");
    for (const kind of ["review", "bugfix", "migration", "negative-review", "human-review"] as const) {
      rejectReview = kind === "negative-review"; calls.length = 0;
      registry.acceptance["goal@v1"].requireHumanApproval = kind === "human-review";
      const proposal = await service.execute("program-author", { kind: rejectReview || kind === "human-review" ? "review" : kind, options }) as ProgramAuthorProposal;
      expect(proposal.diagnostics).toEqual([]);
      let state = await service.execute("program-start", { requestId: kind, program: proposal.program!, input: { items: [{ id: "src/a.txt", allowedPaths: ["src/a.txt"] }] } }) as ProgramRunV2;
      const deadline = Date.now() + 10000;
      while (state.status === "executing") {
        if (Date.now() > deadline) throw new Error(`Template ${kind} stalled`);
        await new Promise(resolve => setTimeout(resolve, 5));
        state = await service.execute("program-status", { runId: state.runId }) as ProgramRunV2;
      }
      if (kind === "human-review") {
        expect(state.status).toBe("waiting"); expect(state.gateRef).toBeUndefined();
        const wait = proposal.program!.steps.find(step => step.id === "human-approval")!;
        const candidate = state.repairs.assessment.candidate;
        await service.execute("program-signal", { runId: state.runId, expectedVersion: state.version, requestId: "approve-fixture", signalId: "human-fixture", target: wait.id, generation: state.operations[wait.id].generation, type: "human-approval", correlation: wait.options.correlation, authorization: "fixture-owner-observed", subject: { candidate, contract: state.registry.acceptance["goal@v1"] }, payload: { approved: true } });
        do {
          if (Date.now() > deadline) throw new Error("Human approval fixture stalled");
          await new Promise(resolve => setTimeout(resolve, 5)); state = await service.execute("program-status", { runId: state.runId }) as ProgramRunV2;
        } while (state.status === "executing" || state.status === "waiting");
      }
      expect(calls.filter(call => call.executor.id === "implement")).toEqual([]);
      expect(await readFile(join(root, "src", "a.txt"), "utf8")).toBe("correct\n");
      expect(git("status", "--porcelain")).toBe("");
      expect(calls.some(call => call.executor.id === "check")).toBe(true);
      if (rejectReview) {
        expect(state.status).toBe("needs-attention"); expect(state.gateRef).toBeUndefined();
      } else {
        expect(state.reason).toBeUndefined(); expect(state.status).toBe("acceptance-ready"); expect(state.gateRef).toBeDefined();
        expect(Object.values(state.assessments).some(assessment => assessment.phase === "final" && assessment.verdict === "approved" && assessment.checks.some(check => check.id === "check@v1" && check.passed))).toBe(true);
        if (kind === "migration") expect(state.collections.migrate.obligationsSatisfied).toBe(true);
      }
    }
  } finally {
    await service?.close();
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("forge-template-execution-")) throw new Error("Fixture cleanup escaped owned temp directory");
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
