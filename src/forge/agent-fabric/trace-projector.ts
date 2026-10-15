import { ProgramRunStore, type ProgramHistoryEntry } from "./program-store.ts";
import { programAssert, type ProgramRunV2 } from "./program-contract.ts";
import { normalizeTraceIdentity, assertTraceIdentity, type TraceIdentity, type TraceRunKey } from "./trace-contract.ts";
import { extractFabricTrace, TRACE_EXTRACTOR_VERSION } from "./trace-extractor.ts";
import type { DeltaStore } from "../delta/store.ts";
import { traceRunKeyString, traceCanonicalJson, type TraceCut, type TraceProjectionFact } from "../delta/trace-projection.ts";
import type { ManagedArtifact } from "./managed-workspace.ts";

type TraceSink = Pick<DeltaStore, "traceCreateGeneration" | "traceStatus" | "traceProjectBatch" | "traceActivateGeneration">;
export interface ProjectFabricTraceOptions {
  root: string; identity: TraceIdentity; generationId: string; delta: TraceSink;
  runIds?: string[]; activate?: boolean; maxTransitions?: number;
}
/** Explicitly projects an already existing Fabric store. This function never starts an owner or a worker. */
export async function projectFabricTrace(options: ProjectFabricTraceOptions) {
  const identity = normalizeTraceIdentity(options.identity), store = await ProgramRunStore.openReadOnly(options.root, identity);
  programAssert(store, "Fabric trace source unavailable", "TRACE_SOURCE_UNAVAILABLE");
  const maxTransitions = options.maxTransitions ?? 4096;
  programAssert(Number.isSafeInteger(maxTransitions) && maxTransitions > 0 && maxTransitions <= 100000, "Invalid trace source budget", "TRACE_LIMIT_EXCEEDED");
  const runIds = options.runIds ?? await store.list();
  programAssert(runIds.length > 0 && runIds.length <= 1024 && new Set(runIds).size === runIds.length, "Invalid source inventory", "TRACE_LIMIT_EXCEEDED");
  const sources = await Promise.all(runIds.map(async runId => {
    const cut = await store.cut(runId); programAssert(cut, "Fabric run unavailable", "TRACE_SOURCE_UNAVAILABLE");
    if (cut.runKey) assertTraceIdentity(cut.runKey, identity);
    return { runKey: cut.runKey ?? { ...identity, runId }, cut };
  }));
  await options.delta.traceCreateGeneration({ generationId: options.generationId, extractorVersion: TRACE_EXTRACTOR_VERSION });
  const status = await options.delta.traceStatus(options.generationId);
  const results: { runKey: TraceRunKey; cut: TraceCut; inserted: number; replayed: number; sourceVersions: number }[] = [];
  for (const source of sources) {
    const prior = status.cuts.find(item => traceRunKeyString(item.runKey) === traceRunKeyString(source.runKey))?.cut;
    const cut: TraceCut = { version: source.cut.version, journalRef: source.cut.journalRef, stateRef: source.cut.stateRef };
    if (prior && traceCanonicalJson(prior) === traceCanonicalJson(cut)) { results.push({ runKey: source.runKey, cut, inserted: 0, replayed: 0, sourceVersions: 0 }); continue; }
    programAssert(!prior || prior.version < cut.version, "Source checkpoint diverged", "TRACE_SOURCE_CONFLICT");
    const entries: ProgramHistoryEntry[] = []; let cursor: string | undefined;
    do {
      const page = await store.historySuffix(source.cut.runId, { cut: source.cut, ...(prior ? { after: prior } : {}), ...(cursor ? { cursor } : {}), limit: 128 });
      entries.push(...page.entries); programAssert(entries.length <= maxTransitions, "Trace source budget exceeded", "TRACE_LIMIT_EXCEEDED");
      cursor = page.nextCursor;
    } while (cursor);
    entries.reverse();
    let previous = prior ? await store.get<ProgramRunV2>(prior.stateRef) : undefined, checkpoint = prior, inserted = 0, replayed = 0;
    const artifacts = new Map<string, ManagedArtifact>(); let batch: TraceProjectionFact[] = [], batchCut: TraceCut | undefined;
    const flush = async () => {
      if (!batch.length || !batchCut) return;
      const result = await options.delta.traceProjectBatch({ generationId: options.generationId, runKey: source.runKey, ...(checkpoint ? { previous: checkpoint } : {}), cut: batchCut, facts: batch });
      inserted += result.inserted; replayed += result.replayed; checkpoint = result.checkpoint; batch = []; batchCut = undefined;
    };
    for (const entry of entries) {
      const facts = await extractFabricTrace({ store, identity, artifacts }, entry, previous);
      programAssert(facts.length <= 256, "Trace transition fact budget exceeded", "TRACE_LIMIT_EXCEEDED");
      if (batch.length + facts.length > 128 || Buffer.byteLength(traceCanonicalJson([...batch, ...facts])) > 700 * 1024) await flush();
      batch.push(...facts); batchCut = { version: entry.version, journalRef: entry.journalRef, stateRef: entry.stateRef }; previous = entry.state;
    }
    await flush();
    results.push({ runKey: source.runKey, cut, inserted, replayed, sourceVersions: entries.length });
  }
  const after = await options.delta.traceStatus(options.generationId);
  if (options.activate !== false) await options.delta.traceActivateGeneration({ generationId: options.generationId, cuts: after.cuts });
  return { schema: "forge.trace-projection-result.v1", generationId: options.generationId, extractorVersion: TRACE_EXTRACTOR_VERSION,
    status: "fabric-current-at-cut", sourceValidation: "head-and-new-suffix",
    sourceReadMetrics: { artifactReads: store.metrics.artifactReads, sourceVersions: results.reduce((total, item) => total + item.sourceVersions, 0) },
    cuts: sources.map(source => ({ runKey: source.runKey, cut: { version: source.cut.version, journalRef: source.cut.journalRef, stateRef: source.cut.stateRef } })), results };
}
