import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ManagedRunService } from "../../src/forge/agent-fabric/managed-run-service.ts";
import { managedDigest, validateManagedSpec, type ManagedRunSpec } from "../../src/forge/agent-fabric/managed-run-contract.ts";
import type { CodexWorkerInput, CodexWorkerOutput } from "../../src/forge/agent-fabric/codex-sdk-worker.ts";
import { publishManagedArtifacts } from "../../src/forge/agent-fabric/managed-workspace.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forge-managed-service-"));
  execFileSync("git", ["init", "-q", root]);
  await writeFile(join(root, "a.txt"), "old-a"); await writeFile(join(root, "b.txt"), "old-b");
  await writeFile(join(root, "verify.mjs"), 'import{readFileSync}from"node:fs";if(readFileSync("a.txt","utf8")!==process.argv[2]||readFileSync("b.txt","utf8")!=="B")process.exit(1);');
  execFileSync("git", ["-C", root, "add", "."]); execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]);
  return root;
}
function spec(requestId: string): ManagedRunSpec {
  const node = (nodeId: string, dependsOn: string[], kind: "activity" | "verification" = "activity") => ({ nodeId, dependsOn, kind, required: true, inputDigest: managedDigest(nodeId) });
  return { requestId, goal: "Two independent changes with joint review and verification", scope: ["a.txt", "b.txt"],
    workflow: { workflowId: requestId, nodes: [node("a", []), node("b", []), node("review", ["a", "b"]), node("check", ["a", "b"], "verification")] },
    executors: [
      { nodeId: "a", type: "codex", role: "implementer", prompt: "set-a:A", writeScope: ["a.txt"] },
      { nodeId: "b", type: "codex", role: "implementer", prompt: "set-b:B", writeScope: ["b.txt"] },
      { nodeId: "review", type: "codex", role: "reviewer", prompt: "Review both files independently" },
      { nodeId: "check", type: "command", argv: [process.execPath, "verify.mjs", "A"] },
    ] };
}
async function until(service: ManagedRunService, runId: string, predicate: (state: any) => boolean): Promise<any> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const state = await service.execute("run-status", { runId }) as any;
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error(`Managed state deadline: ${JSON.stringify(await service.execute("run-status", { runId }))}`);
}
function fakeWorker(options: { reviewChanges?: () => boolean; onStart?: (input: CodexWorkerInput) => Promise<void> } = {}) {
  let active = 0, maximum = 0, calls = 0;
  const worker = async (input: CodexWorkerInput): Promise<CodexWorkerOutput> => {
    calls++; active++; maximum = Math.max(maximum, active);
    try {
      const threadId = input.threadId ?? `fixture-thread-${calls}`;
      await input.onEvent({ type: "thread.started", threadId });
      await options.onStart?.(input);
      await new Promise(resolve => setTimeout(resolve, 300));
      if (input.signal.aborted) throw Object.assign(new Error("fixture worker interrupted"), { code: "AF_CODEX_ABORTED" });
      if (input.role === "implementer") {
        const match = input.prompt.match(/^set-([ab]):([^\n]+)/)!;
        await writeFile(join(input.cwd, `${match[1]}.txt`), match[2]);
      }
      if (input.role === "reviewer") {
        expect(await readFile(join(input.cwd, "a.txt"), "utf8")).toMatch(/^A/);
        expect(await readFile(join(input.cwd, "b.txt"), "utf8")).toBe("B");
      }
      return { threadId, report: { summary: "Observed fixture execution", ...(input.role === "reviewer" ? { verdict: options.reviewChanges?.() ? "changes_requested" as const : "approved" as const, findings: options.reviewChanges?.() ? [{ description: "fixture improvement required" }] : [] } : {}) }, eventsObserved: 1 };
    } finally { active--; }
  };
  return { worker, counts: () => ({ maximum, calls }) };
}

test("managed contracts reject unsupported proof labels instead of manufacturing evidence", () => {
  const request = spec("unsupported-proof");
  request.workflow.nodes[0].outputContract = { requiredEvidenceKinds: ["human-acceptance"] };
  expect(() => validateManagedSpec(request)).toThrow("only executor-observed evidence");
  request.workflow.nodes[0].outputContract = { requiredEvidenceKinds: ["executor-observed"] };
  expect(validateManagedSpec(request).requestId).toBe(request.requestId);
});

test("managed environment contracts accept bounded HTTPS settings and reject unsafe settings", () => {
  const valid: NonNullable<ManagedRunSpec["environment"]>[] = [
    {}, { mode: "auto", ignoreScripts: true, registry: "https://registry.npmjs.org/", timeoutMs: 100 },
    { mode: "none", ignoreScripts: false, registry: "https://packages.example.invalid/npm/", timeoutMs: 1800000 },
  ];
  for (const environment of valid) expect(validateManagedSpec({ ...spec("environment-contract"), environment }).environment).toEqual(environment);
  const invalid = [
    { registry: "http://registry.npmjs.org/" }, { registry: "https://user:secret@registry.npmjs.org/" },
    { registry: "https://registry.npmjs.org/?token=secret" }, { registry: "https://registry.npmjs.org/#secret" },
    { mode: "unsafe" }, { ignoreScripts: "false" }, { timeoutMs: 99 }, { timeoutMs: 1800001 },
    { timeoutMs: 100.5 }, { timeoutMs: NaN },
  ];
  for (const environment of invalid) {
    let failure: unknown;
    try { validateManagedSpec({ ...spec("environment-contract"), environment }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "AF_RUN_ENVIRONMENT" });
  }
});

test("resuming with a changed environment invalidates completed bindings while preserving the implicit plan", async () => {
  const root = await fixture(); let changes = true;
  const fake = fakeWorker({ reviewChanges: () => changes }); const service = await ManagedRunService.open(root, { worker: fake.worker });
  try {
    const request = { ...spec("environment-replan"), environment: { mode: "auto" as const } };
    const ack = await service.execute("run-start", request as any) as any;
    const blocked = await until(service, ack.runId, state => state.status === "blocked" && state.steps.every((step: any) => step.status !== "running"));
    const originalWorkflow = (await service.store.read(ack.runId))!.workflow;
    const originalAttempts = new Map(blocked.steps.map((step: any) => [step.nodeId, step.attemptId]));
    changes = false;
    await service.execute("run-resume", { runId: ack.runId, requestId: "environment-only-resume", expectedVersion: blocked.version,
      expectedRevision: blocked.workflow.revision, environment: { mode: "none" }, reason: "Run without dependency preparation", evidenceRefs: ["fixture:environment-policy"] });
    const done = await until(service, ack.runId, state => state.status === "completed" || state.status === "blocked");
    expect({ status: done.status, error: done.error }).toMatchObject({ status: "completed" }); expect(done.workflow.revision).toBe(2);
    const saved = await service.store.read(ack.runId);
    expect(saved!.spec.workflow).toEqual(request.workflow); expect(saved!.spec.executors).toEqual(request.executors);
    expect(saved!.spec.environment).toEqual({ mode: "none" });
    for (const nodeId of ["a", "b", "review", "check"]) {
      const attempts = done.steps.filter((step: any) => step.nodeId === nodeId);
      expect(attempts).toHaveLength(2); expect(attempts[1].attemptId).not.toBe(originalAttempts.get(nodeId));
      expect(saved!.workflow.nodes.find(node => node.nodeId === nodeId)!.inputDigest).not.toBe(originalWorkflow.nodes.find(node => node.nodeId === nodeId)!.inputDigest);
      expect(saved!.workflow.generations.find(node => node.nodeId === nodeId)!.generation).toBe(2);
      expect(attempts[1].status).toBe("succeeded");
    }
    expect(fake.counts().calls).toBe(6);
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test("managed command execution uses real frozen npm dependencies without installing into the source repository", async () => {
  const root = await fixture(); let service: ManagedRunService | undefined;
  try {
    const manifest = { name: "forge-managed-command-fixture", private: true, version: "1.0.0", dependencies: { "is-number": "7.0.0" },
      scripts: { postinstall: `${process.execPath} -e "require('fs').writeFileSync('lifecycle-ran.txt','ran')"` } };
    await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    await writeFile(join(root, "package-lock.json"), JSON.stringify({ name: manifest.name, version: "1.0.0", lockfileVersion: 3, requires: true,
      packages: { "": { name: manifest.name, version: "1.0.0", dependencies: manifest.dependencies, hasInstallScript: true },
        "node_modules/is-number": { version: "7.0.0", resolved: "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz", engines: { node: ">=0.12.0" } } } }));
    execFileSync("git", ["-C", root, "add", "package.json", "package-lock.json"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "frozen npm fixture"]);
    service = await ManagedRunService.open(root, { worker: async () => { throw new Error("Command-only fixture must never start a Codex worker"); } });
    const ack = await service.execute("run-start", { requestId: "real-npm-command", goal: "Verify prepared dependencies", scope: ["a.txt"], publish: false,
      environment: { mode: "auto", ignoreScripts: true, timeoutMs: 60000 },
      workflow: { workflowId: "real-npm-command", nodes: [{ nodeId: "check", kind: "verification", dependsOn: [], required: true, inputDigest: managedDigest("npm-check") }] },
      executors: [{ nodeId: "check", type: "command", argv: [process.execPath, "-e", "if(!require('is-number')(42))process.exit(1)"] }] }) as any;
    const done = await until(service, ack.runId, state => state.status === "completed" || state.status === "blocked" || state.status === "failed");
    expect({ status: done.status, error: done.error, steps: done.steps }).toMatchObject({ status: "completed" });
    expect(done.steps[0].environment.manager).toBe("npm"); expect(done.steps[0].environment.dependencyDigest).toMatch(/^sha256:/);
    const saved = await service.store.read(ack.runId), step = saved!.steps[0];
    expect(JSON.parse(await readFile(join(step.directory!, "node_modules/is-number/package.json"), "utf8")).version).toBe("7.0.0");
    expect(step.artifact!.files).toEqual([]);
    await expect(readFile(join(step.directory!, "lifecycle-ran.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(root, "node_modules/is-number/package.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
}, 90000);

test("managed dispatcher runs independent workers concurrently, reviews integrated artifacts, verifies and publishes once", async () => {
  const root = await fixture(), fake = fakeWorker(); const service = await ManagedRunService.open(root, { worker: fake.worker });
  try {
    const request = spec("parallel-publish"), ack = await service.execute("run-start", request as any) as any;
    const done = await until(service, ack.runId, state => state.status === "completed" || state.status === "blocked");
    expect(done.status).toBe("completed"); expect(done.workflow.complete).toBe(true);
    expect(fake.counts().maximum).toBe(2); expect(fake.counts().calls).toBe(3);
    expect(done.steps.filter((step: any) => step.threadId)).toHaveLength(3);
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("A"); expect(await readFile(join(root, "b.txt"), "utf8")).toBe("B");
    expect(done.published.changedFiles).toEqual(["a.txt", "b.txt"]);
    expect((await service.execute("run-start", request as any) as any).version).toBe(ack.version);
    expect(fake.counts().calls).toBe(3);
    const waiter = await service.execute("run-wait", { runId: ack.runId, cursor: 0, waitMs: 0 }) as any;
    expect(waiter.events.some((entry: any) => entry.type === "publication.started")).toBe(true);
    expect(JSON.stringify(done)).not.toContain("contentBase64");
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test("review rejection blocks publication; explicit replan invalidates changed executor and preserves independent output", async () => {
  const root = await fixture(); let changes = true; const fake = fakeWorker({ reviewChanges: () => changes }); const service = await ManagedRunService.open(root, { worker: fake.worker });
  try {
    const request = spec("replan-change"), ack = await service.execute("run-start", request as any) as any;
    let state = await until(service, ack.runId, state => state.status === "blocked" && state.steps.every((step: any) => step.status !== "running"));
    expect({ error: state.error, steps: state.steps.map((step: any) => ({ nodeId: step.nodeId, summary: step.summary })) }).toMatchObject({ error: "Independent review requested changes; coordinator must revise the plan" });
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("old-a");
    const bAttempt = state.steps.find((step: any) => step.nodeId === "b").attemptId;
    changes = false; const executors = structuredClone(request.executors);
    executors[0].prompt = "set-a:A2"; executors[3].argv = [process.execPath, "verify.mjs", "A2"];
    await service.execute("run-resume", { runId: ack.runId, requestId: "replan-1", expectedVersion: state.version, expectedRevision: state.workflow.revision,
      nodes: request.workflow.nodes, executors, reason: "Apply independent review feedback", evidenceRefs: ["fixture:review-findings"] });
    state = await until(service, ack.runId, state => state.status === "completed" || state.status === "blocked");
    expect({ status: state.status, error: state.error, steps: state.steps }).toMatchObject({ status: "completed" }); expect(state.workflow.revision).toBe(2);
    expect(state.steps.filter((step: any) => step.nodeId === "b")).toHaveLength(1);
    expect(state.steps.find((step: any) => step.nodeId === "b").attemptId).toBe(bAttempt);
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("A2");
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test("owner interruption leaves uncertain work; resume refuses until explicit reconciliation, then continues saved thread", async () => {
  const root = await fixture(); let block = true;
  const fake = fakeWorker({ onStart: async input => { if (block) await new Promise<void>(resolve => input.signal.addEventListener("abort", () => resolve(), { once: true })); } });
  let service = await ManagedRunService.open(root, { worker: fake.worker });
  try {
    const request = spec("recover-worker"); request.publish = false;
    const ack = await service.execute("run-start", request as any) as any;
    const interrupted = await until(service, ack.runId, state => state.steps.length === 2 && state.steps.every((step: any) => step.threadId));
    const originalThread = interrupted.steps.find((step: any) => step.nodeId === "a").threadId;
    await service.close(); block = false; service = await ManagedRunService.open(root, { worker: fake.worker });
    let state = await service.execute("run-status", { runId: ack.runId }) as any;
    expect(state.steps.filter((step: any) => step.status === "uncertain")).toHaveLength(2);
    await expect(service.execute("run-resume", { runId: ack.runId, requestId: "premature", expectedVersion: state.version })).rejects.toMatchObject({ code: "AF_RUN_UNCERTAIN" });
    for (const step of state.steps.filter((step: any) => step.status === "uncertain")) {
      state = await service.execute("run-status", { runId: ack.runId }) as any;
      await service.execute("run-reconcile", { runId: ack.runId, requestId: `discard-${step.attemptId}`, expectedVersion: state.version, attemptId: step.attemptId, resolution: "failed", reason: "Inspected interruption; abandon isolated attempt and authorize a fresh execution" });
    }
    state = await service.execute("run-status", { runId: ack.runId }) as any;
    await service.execute("run-resume", { runId: ack.runId, requestId: "resume-reconciled", expectedVersion: state.version });
    state = await until(service, ack.runId, state => state.status === "completed" || state.status === "blocked");
    expect(state.status).toBe("completed");
    expect(state.steps.filter((step: any) => step.nodeId === "a").map((step: any) => step.threadId)).toEqual([originalThread, originalThread]);
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("old-a");
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test("one same-process owner per repository; close releases its lease", async () => {
  const root = await fixture(); let service = await ManagedRunService.open(root);
  try {
    await expect(ManagedRunService.open(root)).rejects.toMatchObject({ code: "AF_RUN_OWNER_ACTIVE" });
    await service.close(); service = await ManagedRunService.open(root); await service.close();
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
});

test("a pause racing the next claim preserves already dispatched work", async () => {
  const root = await fixture(), fake = fakeWorker(); const service = await ManagedRunService.open(root, { worker: fake.worker });
  let injected = false;
  const original = (service as any).update.bind(service);
  (service as any).update = async (runId: string, apply: (state: any) => void) => {
    if (!injected && apply.toString().includes("claimWorkflow")) {
      const current = await service.store.read(runId);
      if (current?.steps.length === 1) {
        injected = true;
        await service.execute("run-pause", { runId, requestId: "pause-during-claim", expectedVersion: current.version });
      }
    }
    return original(runId, apply);
  };
  try {
    const ack = await service.execute("run-start", spec("pause-claim") as any) as any;
    let state = await until(service, ack.runId, value => injected && value.steps.length === 1 && value.steps[0].status !== "running");
    expect(state.status).toBe("paused"); expect(state.steps[0].status).toBe("succeeded");
    expect(state.steps.some((step: any) => step.status === "uncertain")).toBe(false);
    await service.execute("run-resume", { runId: ack.runId, requestId: "resume-after-pause", expectedVersion: state.version });
    state = await until(service, ack.runId, value => value.status === "completed" || value.status === "blocked");
    expect(state.status).toBe("completed");
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test("retry publication requires the actual original baseline and never repeats partial writes", async () => {
  const root = await fixture(), fake = fakeWorker(); let publications = 0;
  const service = await ManagedRunService.open(root, { worker: fake.worker, publisher: async (...args) => { if (++publications === 1) throw new Error("Fixture publication failed before writes"); return publishManagedArtifacts(...args); } });
  try {
    const ack = await service.execute("run-start", spec("retry-publication") as any) as any;
    let state = await until(service, ack.runId, value => value.status === "blocked");
    expect(state.publicationIntent).toBeDefined(); expect(await readFile(join(root, "a.txt"), "utf8")).toBe("old-a");
    await writeFile(join(root, "a.txt"), "partial-or-external");
    await expect(service.execute("run-reconcile", { runId: ack.runId, requestId: "unsafe-retry", expectedVersion: state.version, publication: "retry" })).rejects.toMatchObject({ code: "AF_RUN_PUBLICATION" });
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("partial-or-external"); expect(publications).toBe(1);
    await writeFile(join(root, "a.txt"), "old-a");
    const retry = { runId: ack.runId, requestId: "baseline-retry", expectedVersion: state.version, publication: "retry" };
    const retryAck = await service.execute("run-reconcile", retry); expect(await service.execute("run-reconcile", retry)).toEqual(retryAck);
    state = await service.execute("run-status", { runId: ack.runId }) as any;
    expect(state.status).toBe("paused"); expect(state.publicationIntent).toBeUndefined(); expect(publications).toBe(1);
    await service.execute("run-resume", { runId: ack.runId, requestId: "resume-publication", expectedVersion: state.version });
    state = await until(service, ack.runId, value => value.status === "completed" || value.status === "blocked");
    expect(state.status).toBe("completed"); expect(publications).toBe(2); expect(fake.counts().calls).toBe(3);
  } finally { await service.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test("closing during publication keeps its lease and requires explicit observed reconciliation", async () => {
  const root = await fixture(), fake = fakeWorker(); let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  let service = await ManagedRunService.open(root, { worker: fake.worker, closeTimeoutMs: 30, publisher: async (...args) => { entered = true; await pending; return publishManagedArtifacts(...args); } });
  try {
    const ack = await service.execute("run-start", spec("close-publication") as any) as any;
    await until(service, ack.runId, value => entered && value.status === "publishing");
    await service.close();
    expect((await service.store.read(ack.runId))?.status).toBe("blocked");
    await expect(ManagedRunService.open(root)).rejects.toMatchObject({ code: "AF_RUN_OWNER_ACTIVE" });
    release();
    let reopened: ManagedRunService | undefined;
    for (let i = 0; i < 100 && !reopened; i++) {
      try { reopened = await ManagedRunService.open(root); } catch (error) { if ((error as { code?: string }).code !== "AF_RUN_OWNER_ACTIVE") throw error; await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    expect(reopened).toBeDefined(); service = reopened!;
    const state = await service.execute("run-status", { runId: ack.runId }) as any;
    expect(state.status).toBe("blocked"); expect(state.publicationIntent).toBeDefined();
    await service.execute("run-reconcile", { runId: ack.runId, requestId: "confirm-closed-publication", expectedVersion: state.version, publication: "confirm" });
    expect((await service.execute("run-status", { runId: ack.runId }) as any).status).toBe("completed");
  } finally { release(); await service.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test("failed open releases the provisional per-root lease", async () => {
  const root = await fixture();
  try {
    for (let i = 0; i < 2; i++) {
      let failure: unknown;
      try { await ManagedRunService.open(join(root, "a.txt")); } catch (error) { failure = error; }
      expect(failure).toBeDefined(); expect((failure as { code?: string }).code).not.toBe("AF_RUN_OWNER_ACTIVE");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
