import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { requestExistingDeltaBroker } from "../delta/broker.ts";
import type { AgentMemoryEventRecord } from "../agent-memory/types.ts";
import { ProgramRunStore } from "./program-store.ts";
import { programAssert, programDigest, type ProgramRunV2 } from "./program-contract.ts";
import { normalizeTraceIdentity, normalizeTraceAgentMemorySlice, traceOpaque, traceObject, type TraceIdentity, type TraceRuntimeOptions } from "./trace-contract.ts";
import { captureTraceGitBaseline, observeTraceGit, type TraceGitBaselineObservation, type TraceGitObservation } from "./trace-git.ts";
import type { ManagedBase, ManagedArtifact } from "./managed-workspace.ts";

export interface TraceOwnerConfiguration {
  schema: "forge.fabric-trace-config.v1"; identity: TraceIdentity; checkoutBinding: string;
  memory?: { memoryStoreId: string; sourceNamespace: string };
}
const runFile = promisify(execFile);
/** Local configuration binds identity to a physical checkout without exporting its absolute path. */
export async function traceCheckoutBinding(root: string, options: { timeoutMs?: number } = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 10000;
  programAssert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10000, "Invalid trace configuration read budget", "TRACE_LIMIT_EXCEEDED");
  const deadline = Date.now() + timeoutMs, canonical = await realpath(root);
  programAssert(Date.now() < deadline, "Trace configuration read budget exhausted", "TRACE_LIMIT_EXCEEDED");
  const gitDir = (await runFile("git", ["-c", "core.hooksPath=/dev/null", "-C", canonical, "rev-parse", "--absolute-git-dir"], { timeout: Math.max(1, deadline - Date.now()), windowsHide: true })).stdout.trim();
  return programDigest({ root: canonical, gitDir: await realpath(gitDir) });
}
export async function createTraceOwnerConfiguration(root: string, identity: TraceIdentity, memory?: TraceOwnerConfiguration["memory"]): Promise<TraceOwnerConfiguration> {
  return { schema: "forge.fabric-trace-config.v1", identity: normalizeTraceIdentity(identity), checkoutBinding: await traceCheckoutBinding(root),
    ...(memory ? { memory: { memoryStoreId: traceOpaque(memory.memoryStoreId), sourceNamespace: traceOpaque(memory.sourceNamespace) } } : {}) };
}
/** Reads only. Configuration is opt-in and never installed as a side effect of querying. */
export async function readTraceOwnerConfiguration(root: string, options: { timeoutMs?: number } = {}): Promise<TraceOwnerConfiguration | undefined> {
  const timeoutMs = options.timeoutMs ?? 10000;
  programAssert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10000, "Invalid trace configuration read budget", "TRACE_LIMIT_EXCEEDED");
  const deadline = Date.now() + timeoutMs;
  const remaining = () => { programAssert(Date.now() < deadline, "Trace configuration read budget exhausted", "TRACE_LIMIT_EXCEEDED"); return Math.max(1, deadline - Date.now()); };
  const file = join(root, ".forge", "fabric-trace.json");
  try {
    const directory = await lstat(join(root, ".forge")), info = await lstat(file);
    programAssert(!directory.isSymbolicLink() && !info.isSymbolicLink() && info.isFile() && info.size <= 8192, "Invalid trace owner configuration", "TRACE_INVALID_REFERENCE");
    const value = traceObject(JSON.parse(await readFile(file, { encoding: "utf8", signal: AbortSignal.timeout(remaining()) })), ["schema", "identity", "checkoutBinding", "memory"]);
    programAssert(value.schema === "forge.fabric-trace-config.v1" && value.checkoutBinding === await traceCheckoutBinding(root, { timeoutMs: remaining() }), "Trace checkout configuration mismatch", "TRACE_IDENTITY_MISMATCH");
    const memory = value.memory === undefined ? undefined : traceObject(value.memory, ["memoryStoreId", "sourceNamespace"]);
    return { schema: "forge.fabric-trace-config.v1", identity: normalizeTraceIdentity(value.identity), checkoutBinding: String(value.checkoutBinding),
      ...(memory ? { memory: { memoryStoreId: traceOpaque(memory.memoryStoreId), sourceNamespace: traceOpaque(memory.sourceNamespace) } } : {}) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}

async function recoverBaseline(store: ProgramRunStore, run: ProgramRunV2, base: ManagedBase): Promise<TraceGitBaselineObservation | undefined> {
  const cut = await store.cut(run.runId); if (!cut) return;
  if (!run.traceBindingsRef) return;
  // Origins are immutable and remain reachable in the current manifest; no historical scan is needed.
  const closure = await store.traceArtifacts(run.runId, { journalRef: cut.journalRef });
  for (const item of closure.artifacts) if (item.type === "origin" && item.value.gitBaseline) {
    const stamp = item.value.gitBaseline;
    if (stamp.head === base.head && stamp.baselineDigest === base.digest) return stamp;
  }
  return undefined;
}

export async function observeTraceRunGit(input: {
  root: string; identity: TraceIdentity; run: ProgramRunV2; candidateDigest: string; commitOid: string;
  baselineObservation?: TraceGitBaselineObservation; hostReported?: boolean;
}): Promise<TraceGitObservation> {
  const store = await ProgramRunStore.openReadOnly(input.root, input.identity);
  programAssert(store && input.run.baseRef, "Trace managed source unavailable", "TRACE_SOURCE_UNAVAILABLE");
  const committed = await store.read(input.run.runId);
  programAssert(committed && committed.version === input.run.version && programDigest(committed) === programDigest(input.run), "Trace run changed during observation", "TRACE_VERSION_CONFLICT");
  const candidate = Object.values(committed.candidates).find(item => item.digest === input.candidateDigest);
  programAssert(candidate, "Trace candidate unavailable", "TRACE_SOURCE_UNAVAILABLE");
  const base = await store.get<ManagedBase>(committed.baseRef!);
  const artifacts: ManagedArtifact[] = [];
  for (const ref of candidate.deltas) { const delta = committed.deltas[ref]; programAssert(delta, "Trace delta unavailable", "TRACE_SOURCE_UNAVAILABLE"); artifacts.push(await store.get<ManagedArtifact>(delta.artifactRef)); }
  let applyReceipt: Parameters<typeof observeTraceGit>[0]["applyReceipt"];
  if (committed.status === "applied" && committed.receiptRef && committed.intent?.candidateDigest === candidate.digest) {
    const receipt = await store.get<{ digest?: string; observed?: boolean; intent?: ProgramRunV2["intent"] }>(committed.receiptRef);
    programAssert(receipt.intent?.id === committed.intent.id && receipt.intent.candidateDigest === candidate.digest
      && programDigest(receipt.intent) === programDigest(committed.intent)
      && (receipt.digest === committed.intent.expectedDigest || receipt.observed === true), "Trace application receipt mismatch", "TRACE_SOURCE_CONFLICT");
    // Pin the actual journal transition that confirmed this receipt, rather than a later metadata version.
    const history = await store.history(committed.runId);
    let appliedJournal: string | undefined;
    for (const transition of history) if (transition.type === "applied" || transition.type === "apply-reconciled") {
      const snapshot = await store.get<ProgramRunV2>(transition.stateRef);
      if (snapshot.receiptRef === committed.receiptRef && snapshot.status === "applied") {
        programAssert(receipt.observed !== true || transition.type === "apply-reconciled", "Trace reconciliation receipt mismatch", "TRACE_SOURCE_CONFLICT");
        appliedJournal = (await store.confirmedCut(committed.runId, programDigest(transition))).journalRef; break;
      }
    }
    programAssert(appliedJournal, "Committed apply journal unavailable", "TRACE_SOURCE_UNAVAILABLE");
    applyReceipt = { status: "applied", candidateDigest: candidate.digest, baselineDigest: base.digest, sourceJournalRef: appliedJournal, receiptRef: committed.receiptRef };
  }
  const baselineObservation = input.baselineObservation ?? await recoverBaseline(store, committed, base);
  return observeTraceGit({ root: input.root, identity: input.identity, commitOid: input.commitOid, base, artifacts, candidateDigest: candidate.digest,
    ...(baselineObservation ? { baselineObservation } : {}), ...(applyReceipt ? { applyReceipt } : {}),
    ...(input.hostReported ? { hostLink: { claimKind: "declared", capture: "host-reported" } } : {}) });
}
export function createTraceRuntime(root: string, configuration: TraceOwnerConfiguration): TraceRuntimeOptions {
  return { identity: normalizeTraceIdentity(configuration.identity), capture: "configured-local-owner",
    observeGitBaseline: async () => {
      let head = "";
      try { head = (await runFile("git", ["-c", "core.hooksPath=/dev/null", "-C", root, "rev-parse", "--verify", "HEAD"], { timeout: 10000, windowsHide: true })).stdout.trim(); }
      catch { /* The observer returns unknown, never clean, when HEAD cannot be verified. */ }
      return captureTraceGitBaseline({ root, identity: configuration.identity, head, baselineDigest: programDigest("pending-baseline-capture") });
    },
    resolveAgentMemoryEvent: async reference => {
      const memory = configuration.memory;
      if (!memory || reference.memoryStoreId !== memory.memoryStoreId || reference.sourceNamespace !== memory.sourceNamespace) return;
      const row = await requestExistingDeltaBroker(root, "traceReadAgentMemoryEvent", [reference.eventId]) as AgentMemoryEventRecord | null;
      if (!row?.externalSessionId) return;
      const slice = normalizeTraceAgentMemorySlice({ sourceNamespace: memory.sourceNamespace, integration: row.integrationKind,
        externalSessionId: row.externalSessionId, ...(row.externalTurnId ? { turnId: row.externalTurnId } : {}), eventType: row.eventKind, ...(row.summary ? { summary: row.summary } : {}) });
      return { committed: true, memoryStoreId: memory.memoryStoreId, eventId: row.id, slice };
    },
    resolveGitObservation: async (requested, run) => observeTraceRunGit({ root, identity: configuration.identity, run,
      candidateDigest: requested.candidate.digest, commitOid: requested.commit.oid ?? "", hostReported: requested.hostLink === "host-reported" }),
  };
}
