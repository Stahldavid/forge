import { describe, expect, test } from "bun:test";
import { fork, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeltaStore } from "../../src/forge/delta/store.ts";
import { shutdownDeltaBroker } from "../../src/forge/delta/broker.ts";
import { programDigest, type ProgramRunV2 } from "../../src/forge/agent-fabric/program-contract.ts";
import { ProgramRunStore } from "../../src/forge/agent-fabric/program-store.ts";
import { ProgramRunService } from "../../src/forge/agent-fabric/program-service.ts";
import { projectFabricTrace } from "../../src/forge/agent-fabric/trace-projector.ts";
import { createTraceRuntime, observeTraceRunGit } from "../../src/forge/agent-fabric/trace-owner-runtime.ts";
import type { TraceProjectionBatch } from "../../src/forge/delta/trace-projection.ts";
import { createTraceFixture, fixtureGit } from "./trace-fixture.ts";

const directory = dirname(fileURLToPath(import.meta.url)), repository = resolve(directory, "../..");
const nodeExecutable = process.env.FORGE_TRACE_NODE ?? execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
type Barrier = Record<string, unknown> & { boundary: string; fixturePid: number };
interface OwnedChild { child: ChildProcess; barrier: Promise<Barrier>; closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> }
function startOwned(root: string, mode: string, inputPath: string): OwnedChild {
  const child = fork(join(directory, "trace-crash-child.ts"), [mode, root, inputPath], {
    execPath: nodeExecutable, execArgv: ["--import", "tsx"], cwd: repository,
    env: { ...process.env, FORGE_DELTA_BACKGROUND_DRAIN: "0", FORGE_FABRIC_TEST_MODE: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stderr = ""; child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-4096); }); child.stdout?.resume();
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  const barrier = new Promise<Barrier>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Owned fixture IPC barrier timeout")), 45000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.on("message", raw => {
      const message = raw as Barrier;
      if (message.fixturePid !== child.pid) { clearTimeout(timer); reject(new Error("Fixture child identity mismatch")); return; }
      clearTimeout(timer);
      if (message.boundary === "error") reject(new Error(`Owned fixture failed: ${String(message.reason)}`)); else resolve(message);
    });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`Owned fixture exited before barrier: ${stderr}`)); });
  });
  return { child, barrier, closed };
}
async function killOwned(owned: OwnedChild): Promise<void> {
  if (owned.child.exitCode === null && owned.child.signalCode === null) owned.child.kill("SIGKILL");
  const exit = await owned.closed; expect(exit.signal).toBe("SIGKILL");
}
async function cleanupOwned(owned?: OwnedChild) {
  if (owned && owned.child.exitCode === null && owned.child.signalCode === null) { owned.child.kill("SIGKILL"); await owned.closed; }
}
const runKey = { repositoryId: "fixture-crash-repository", checkoutId: "fixture-crash-checkout", fabricStoreId: "fixture-crash-store", runId: "fixture-crash-run" };
function batch(version: number): TraceProjectionBatch {
  const cut = { version, journalRef: programDigest({ fixtureJournal: version }), stateRef: programDigest({ fixtureState: version }) };
  return { generationId: "fixture-crash-generation", runKey, cut, ...(version > 1 ? { previous: { version: version - 1, journalRef: programDigest({ fixtureJournal: version - 1 }), stateRef: programDigest({ fixtureState: version - 1 }) } } : {}),
    facts: [{ journalVersion: version, journalRef: cut.journalRef, stateRef: cut.stateRef, factKind: "fixture-state", factIdentity: "fixture-run-state", sourceDigest: programDigest({ fixtureFact: version }), entities: [{ id: "fixture-run", kind: "run", data: { observedStatus: version === 1 ? "completed" : "applied" } }], relations: [] }] };
}

describe("deterministic trace crash recovery through owned Node processes", () => {
  test.each(["before-commit", "after-commit"] as const)("T07/T08 %s: kill after confirmed IPC, reopen broker, readback checkpoint and retry", async mode => {
    const root = await mkdtemp(join(tmpdir(), "forge-trace-transaction-crash-")); let store: DeltaStore | undefined, child: OwnedChild | undefined;
    const previousDrain = process.env.FORGE_DELTA_BACKGROUND_DRAIN; process.env.FORGE_DELTA_BACKGROUND_DRAIN = "0";
    try {
      store = await DeltaStore.open(root, { access: "write" });
      await store.traceCreateGeneration({ generationId: batch(1).generationId, extractorVersion: "fixture-crash-v1" });
      await store.traceProjectBatch(batch(1)); const before = await store.traceStatus(batch(1).generationId);
      await store.close(); store = undefined; await shutdownDeltaBroker(root);
      const input = join(root, "fixture-batch.json"); await writeFile(input, JSON.stringify(batch(2)));
      child = startOwned(root, mode, input); const barrier = await child.barrier;
      expect(barrier.boundary).toBe(mode); expect(barrier.transactionVisibleVersion).toBe(2); expect(barrier.transactionVisibleFacts).toBe(2); expect(barrier.commitReturned).toBe(mode === "after-commit");
      await killOwned(child);
      // Same bytes/store, newly launched broker. No source execution is involved in replay.
      store = await DeltaStore.open(root, { access: "write" }); const recovered = await store.traceStatus(batch(1).generationId);
      expect(recovered.cuts[0]?.cut.version).toBe(mode === "before-commit" ? 1 : 2);
      expect(recovered.counts.sources).toBe(mode === "before-commit" ? before.counts.sources : 2);
      if (mode === "before-commit") expect(recovered.counts).toEqual(before.counts);
      const retry = await store.traceProjectBatch(batch(2)); expect(retry.inserted).toBe(mode === "before-commit" ? 1 : 0); expect(retry.replayed).toBe(mode === "before-commit" ? 0 : 1);
      const confirmed = await store.traceStatus(batch(1).generationId); expect(confirmed.cuts[0]?.cut).toEqual(batch(2).cut); expect(confirmed.counts.sources).toBe(2);
      await store.traceProjectBatch(batch(2)); expect((await store.traceStatus(batch(1).generationId)).counts).toEqual(confirmed.counts);
    } finally { await cleanupOwned(child); await store?.close(); await shutdownDeltaBroker(root).catch(() => {}); await rm(root, { recursive: true, force: true }); if (previousDrain === undefined) delete process.env.FORGE_DELTA_BACKGROUND_DRAIN; else process.env.FORGE_DELTA_BACKGROUND_DRAIN = previousDrain; }
  }, 120000);

  test("T06 confirmed Fabric journal survives process crash before projection; retry does not execute source", async () => {
    const fixture = await createTraceFixture(); let child: OwnedChild | undefined, reopened: DeltaStore | undefined;
    try {
      const run = await fixture.finish(), source = await fixture.store(), cut = (await source.cut(run.runId))!;
      const attempts = Object.keys(run.attempts), sourceDigest = programDigest(run);
      await fixture.close(true); await shutdownDeltaBroker(fixture.root);
      const input = join(fixture.root, "fixture-before-project.json"); await writeFile(input, JSON.stringify({ runId: run.runId }));
      child = startOwned(fixture.root, "before-project", input); const barrier = await child.barrier;
      expect(barrier.cut).toEqual(cut); expect(barrier.attempts).toEqual(attempts); expect(barrier.projectionStarted).toBe(false); await killOwned(child);
      reopened = await DeltaStore.open(fixture.root, { access: "write" });
      await projectFabricTrace({ root: fixture.root, identity: fixture.identity, generationId: "fixture-recovery", delta: reopened });
      const status = await reopened.traceStatus("fixture-recovery"), counts = status.counts;
      expect(status.cuts[0]?.cut.version).toBe(cut.version);
      const replay = await projectFabricTrace({ root: fixture.root, identity: fixture.identity, generationId: "fixture-recovery", delta: reopened }); expect(replay.results[0]?.sourceVersions).toBe(0);
      expect((await reopened.traceStatus("fixture-recovery")).counts).toEqual(counts);
      const freshSource = (await ProgramRunStore.openReadOnly(fixture.root, fixture.identity))!;
      expect(programDigest(await freshSource.read(run.runId))).toBe(sourceDigest); expect(Object.keys((await freshSource.read(run.runId))!.attempts)).toEqual(attempts);
    } finally { await cleanupOwned(child); await reopened?.close(); await shutdownDeltaBroker(fixture.root).catch(() => {}); await fixture.close(); }
  }, 120000);

  test.each(["after-first-file", "after-all-bytes"] as const)("T16 publisher boundary %s: restart marks apply uncertain and preserves bytes", async mode => {
    const fixture = await createTraceFixture(); let child: OwnedChild | undefined, recoveredService: ProgramRunService | undefined, reopened: DeltaStore | undefined;
    try {
      const accepted = await fixture.finish(); expect(accepted.status).toBe("acceptance-ready");
      await fixture.close(true); await shutdownDeltaBroker(fixture.root);
      const input = join(fixture.root, "fixture-publication-crash.json"); await writeFile(input, JSON.stringify({ runId: accepted.runId }));
      child = startOwned(fixture.root, mode, input); const barrier = await child.barrier;
      expect(barrier.status).toBe("applying"); expect(barrier.receiptPublished).toBe(false); expect(barrier.writesCompleted).toBe(mode === "after-first-file" ? 1 : 2); await killOwned(child);
      const firstBytes = await readFile(join(fixture.root, "src/a.txt"), "utf8"), secondBytes = await readFile(join(fixture.root, "src/b.txt"), "utf8");
      expect(firstBytes).toBe("new-a\n"); expect(secondBytes).toBe(mode === "after-first-file" ? "old-b\n" : "new-b\n");
      recoveredService = await ProgramRunService.open(fixture.root, accepted.registry, undefined, { trace: createTraceRuntime(fixture.root, fixture.configuration) });
      const run = (await recoveredService.store.read(accepted.runId))!; expect(run.status).toBe("apply-uncertain"); expect(run.receiptRef).toBeUndefined(); expect(Object.keys(run.attempts)).toEqual(Object.keys(accepted.attempts));
      reopened = await DeltaStore.open(fixture.root, { access: "write" }); await projectFabricTrace({ root: fixture.root, identity: fixture.identity, generationId: "fixture-partial-publication", delta: reopened });
      const explanation = await reopened.traceExplain({ runKey: { ...fixture.identity, runId: run.runId }, generationId: "fixture-partial-publication" });
      expect(explanation).toMatchObject({ execution: { observedStatus: "apply-uncertain" }, git: { observation: "not-observed" } });
      expect(JSON.stringify(explanation)).not.toContain('"predicate":"applied-as"');
      expect(await readFile(join(fixture.root, "src/a.txt"), "utf8")).toBe(firstBytes); expect(await readFile(join(fixture.root, "src/b.txt"), "utf8")).toBe(secondBytes);
      if (mode === "after-all-bytes") {
        const source = (await ProgramRunStore.openReadOnly(fixture.root, fixture.identity))!;
        expect(await source.get(String(barrier.orphanReceiptRef))).toBeDefined(); expect((await source.read(run.runId))!.receiptRef).toBeUndefined();
        // Reconcile through the real owner operation after independent bytes readback.
        const reconciled = await recoveredService.execute("program-reconcile", { runId: run.runId, requestId: "fixture-observed-publication", expectedVersion: run.version, publication: true, authorization: "fixture controller observes only fixture src bytes" }) as ProgramRunV2;
        expect(reconciled.status).toBe("applied"); expect(reconciled.receiptRef).toBeDefined(); expect(reconciled.receiptRef).not.toBe(barrier.orphanReceiptRef);
        const receiptRef = reconciled.receiptRef; if (!receiptRef) throw new Error("Fixture reconciliation receipt missing");
        const receipt = await source.get<{ observed: boolean; intent: unknown }>(receiptRef); expect(receipt.observed).toBe(true); expect(receipt.intent).toEqual(reconciled.intent);
        const history = await source.history(run.runId), transition = history.find(entry => entry.type === "apply-reconciled"); expect(transition).toBeDefined();
        const reconciledJournalRef = programDigest(transition), committed = await source.confirmedCut(run.runId, reconciledJournalRef); expect(committed.stateRef).toBe(transition!.stateRef);
        fixtureGit(fixture.root, "add", "src"); fixtureGit(fixture.root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture reconciled publication");
        const observation = await observeTraceRunGit({ root: fixture.root, identity: fixture.identity, run: reconciled, candidateDigest: reconciled.acceptedCandidate!.digest, commitOid: fixtureGit(fixture.root, "rev-parse", "HEAD"), hostReported: true });
        expect(observation.contentMatch).toBe("matches"); expect(observation.exactIntegration).toBe(true); expect(observation.apply).toEqual({ receiptRef, sourceJournalRef: reconciledJournalRef });
        const annotated = await recoveredService.execute("program-trace-annotate", { runId: run.runId, requestId: "fixture-reconciled-git", expectedVersion: reconciled.version, annotation: { type: "git-observation", observation } }) as ProgramRunV2;
        expect(annotated.status).toBe("applied");
        await projectFabricTrace({ root: fixture.root, identity: fixture.identity, generationId: "fixture-partial-publication", delta: reopened });
        const confirmedExplanation = await reopened.traceExplain({ runKey: { ...fixture.identity, runId: run.runId }, generationId: "fixture-partial-publication" });
        expect(confirmedExplanation).toMatchObject({ execution: { observedStatus: "applied" }, git: { observation: "observed", contentMatch: "matches" } });
        expect(await readFile(join(fixture.root, "src/a.txt"), "utf8")).toBe(firstBytes); expect(await readFile(join(fixture.root, "src/b.txt"), "utf8")).toBe(secondBytes);
      }
    } finally { await cleanupOwned(child); await recoveredService?.close(); await reopened?.close(); await shutdownDeltaBroker(fixture.root).catch(() => {}); await fixture.close(); }
  }, 120000);
});
