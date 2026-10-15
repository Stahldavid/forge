/** Owned fixture subprocess. Crash barriers live only in tests, never in production code. */
import { readFile } from "node:fs/promises";
import { createPgliteAdapter } from "../../src/forge/runtime/db/pglite-adapter.ts";
import type { DbAdapter, DbTransaction } from "../../src/forge/runtime/db/adapter.ts";
import { getDeltaStorePath } from "../../src/forge/delta/store.ts";
import { projectTraceBatch, readTraceProjectionStatus, type TraceProjectionBatch } from "../../src/forge/delta/trace-projection.ts";
import { ProgramRunStore } from "../../src/forge/agent-fabric/program-store.ts";
import { programDigest, type ProgramApplyIntent } from "../../src/forge/agent-fabric/program-contract.ts";
import { previewManagedArtifacts, publishManagedArtifacts, type ManagedArtifact, type ManagedBase } from "../../src/forge/agent-fabric/managed-workspace.ts";

const [mode, root, inputPath] = process.argv.slice(2);
async function send(value: Record<string, unknown>): Promise<void> {
  if (!process.send) throw new Error("Fixture IPC required");
  await new Promise<void>((resolve, reject) => process.send!({ ...value, fixturePid: process.pid }, error => error ? reject(error) : resolve()));
}
async function stopAt(value: Record<string, unknown>): Promise<never> {
  await send(value);
  // The parent kills this owned process after receiving the confirmed barrier.
  setInterval(() => {}, 1000);
  return new Promise<never>(() => {});
}
async function projectionCrash() {
  const input = JSON.parse(await readFile(inputPath, "utf8")) as TraceProjectionBatch;
  const adapter = await createPgliteAdapter(getDeltaStorePath(root));
  const wrapped: DbAdapter = {
    kind: adapter.kind,
    query: (sql, args) => adapter.query(sql, args),
    close: () => adapter.close(),
    async begin(): Promise<DbTransaction> {
      const tx = await adapter.begin();
      return {
        query: (sql, args) => tx.query(sql, args), rollback: () => tx.rollback(),
        async commit() {
          const visible = await tx.query("SELECT version FROM trace_projection_checkpoints WHERE generation_id=$1", [input.generationId]);
          const facts = await tx.query("SELECT COUNT(*)::int AS count FROM trace_projection_sources WHERE generation_id=$1", [input.generationId]);
          const barrier = { boundary: mode, generationId: input.generationId, transactionVisibleVersion: Number(visible.rows[0]?.version), transactionVisibleFacts: Number(facts.rows[0]?.count), requestedVersion: input.cut.version };
          if (mode === "before-commit") await stopAt({ ...barrier, commitReturned: false });
          await tx.commit();
          const durable = await readTraceProjectionStatus(adapter, input.generationId);
          await stopAt({ ...barrier, commitReturned: true, committedCuts: durable.cuts, committedCounts: durable.counts });
        },
      };
    },
  };
  await projectTraceBatch(wrapped, input);
  throw new Error("Fixture commit barrier unexpectedly returned");
}
async function beforeProjection() {
  const { runId } = JSON.parse(await readFile(inputPath, "utf8")) as { runId: string };
  const store = await ProgramRunStore.openReadOnly(root); if (!store) throw new Error("Fixture source missing");
  const cut = await store.cut(runId), run = await store.read(runId); if (!cut || !run) throw new Error("Fixture run missing");
  await stopAt({ boundary: mode, cut, attempts: Object.keys(run.attempts), status: run.status, sourceDigest: programDigest(run), projectionStarted: false });
}
async function publicationCrash() {
  const { runId } = JSON.parse(await readFile(inputPath, "utf8")) as { runId: string };
  const store = await ProgramRunStore.open(root), run = await store.read(runId);
  if (!run?.baseRef || !run.gateRef || !run.acceptedCandidate || run.status !== "acceptance-ready") throw new Error("Fixture accepted candidate required");
  const base = await store.get<ManagedBase>(run.baseRef), candidate = run.acceptedCandidate;
  const gate = await store.get<Record<string, unknown>>(run.gateRef);
  if (gate.candidateDigest !== candidate.digest || gate.semanticVersion !== run.semanticVersion) throw new Error("Fixture gate mismatch");
  const artifacts: ManagedArtifact[] = [];
  for (const reference of candidate.deltas) { const delta = run.deltas[reference]; if (!delta) throw new Error("Fixture delta missing"); artifacts.push(await store.get<ManagedArtifact>(delta.artifactRef)); }
  const preview = await previewManagedArtifacts(base, artifacts);
  const intent: ProgramApplyIntent = {
    id: "fixture-owned-crash-publication", requestId: "fixture-crash-apply", requestDigest: programDigest({ fixture: true, mode }),
    candidateDigest: candidate.digest, gateRef: run.gateRef, semanticVersion: run.semanticVersion, programDigest: run.programDigest,
    acceptanceDigest: String(gate.acceptanceDigest), policyDigest: String(gate.policyDigest), populationDigest: String(gate.populationDigest),
    sealRefs: Object.values(run.seals), authorization: "fixture controller authorizes only fixture src files", expectedDigest: preview.digest, changedFiles: preview.changedFiles,
  };
  const applying = await store.transact(runId, "apply-intent", current => ({ ...current!, status: "applying", intent }), { expectedVersion: run.version });
  let writeBoundary = 0;
  const receipt = await publishManagedArtifacts(base, artifacts, { beforeWrite: async () => {
    writeBoundary++;
    if (mode === "after-first-file" && writeBoundary === 2) {
      const snapshot = await store.read(runId);
      await stopAt({ boundary: mode, sourceVersion: applying.version, status: snapshot?.status, receiptPublished: Boolean(snapshot?.receiptRef), writesCompleted: 1, expectedChangedFiles: preview.changedFiles });
    }
  } });
  const orphanReceiptRef = await store.put({ ...receipt, intent });
  const snapshot = await store.read(runId);
  await stopAt({ boundary: mode, sourceVersion: applying.version, status: snapshot?.status, receiptPublished: Boolean(snapshot?.receiptRef), writesCompleted: preview.changedFiles.length, orphanReceiptRef, expectedDigest: receipt.digest });
}
try {
  if (!root || !inputPath || !process.send) throw new Error("Fixture arguments and IPC required");
  if (mode === "before-commit" || mode === "after-commit") await projectionCrash();
  else if (mode === "before-project") await beforeProjection();
  else if (mode === "after-first-file" || mode === "after-all-bytes") await publicationCrash();
  else throw new Error("Unknown fixture crash mode");
} catch (error) {
  await send({ boundary: "error", reason: error instanceof Error ? error.message : "fixture-error" }).catch(() => {});
  process.exit(1);
}
