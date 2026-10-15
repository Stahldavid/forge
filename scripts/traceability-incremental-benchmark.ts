/** Explicit synthetic, single-broker multi-run benchmark. No Fabric worker or external provider is used. */
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { DeltaStore } from "../src/forge/delta/store.ts";
import { shutdownDeltaBroker } from "../src/forge/delta/broker.ts";
import type { TraceCut, TraceEntityInput, TraceProjectionBatch, TraceProjectionFact, TraceRelationInput } from "../src/forge/delta/trace-projection.ts";
import type { TraceRunKey } from "../src/forge/agent-fabric/trace-contract.ts";

export interface IncrementalBenchmarkOptions { output: string; smoke?: boolean; volumes?: number[]; repetitions?: number }
type Source = { sourceKey: string; digest: string; version: number; journalRef: string; stateRef: string; factKind: string; factIdentity: string };
type Edge = { relation: TraceRelationInput; evidence: { sourceKey: string; provenance: TraceRelationInput["provenance"] }[] };
type Mirror = { sources: Source[]; entities: TraceEntityInput[]; edges: Edge[] };
interface Page { sources: Source[]; entities: TraceEntityInput[]; relations: Edge[]; truncated: boolean; nextOffset?: number }
const EXTRACTOR = "fixture-multi-run-incremental-v1", KIND = "fixture-observation", SHARED_ID = "shared-run";
const provenance = { capture: "fixture-synthetic", claimKind: "declared" as const, authority: "none" };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function assert(value: unknown, label: string): asserts value { if (!value) throw new Error(`TRACE_INCREMENTAL_ASSERTION:${label}`); }
// Independent JSON/digest recipe; no production canonicalizer, digest, extractor or projector imported.
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, value]) => value !== undefined).sort(([a], [b]) => compare(a, b)).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(",")}}`;
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const same = (actual: unknown, expected: unknown, label: string) => assert(digest(actual) === digest(expected), label);
function key(volume: number): TraceRunKey { return { repositoryId: "fixture-incremental-repository", checkoutId: "fixture-shared-checkout", fabricStoreId: "fixture-shared-store", runId: `run-${volume}` }; }
const namespace = (volume: number) => `fixture-volume-${volume}`;
const eventId = (version: number) => `shared-event-${String(version).padStart(6, "0")}`;
const ref = (volume: number, version: number, domain: string) => `sha256:${digest({ domain, namespace: namespace(volume), version })}`;
const cut = (volume: number, version: number): TraceCut => ({ version, journalRef: ref(volume, version, "journal"), stateRef: ref(volume, version, "state") });
function fact(volume: number, version: number): TraceProjectionFact {
  const point = cut(volume, version);
  return { journalVersion: version, journalRef: point.journalRef, stateRef: point.stateRef, factKind: KIND, factIdentity: `occurrence-${version}`,
    sourceDigest: digest({ fixture: EXTRACTOR, namespace: namespace(volume), version }),
    entities: [
      { id: SHARED_ID, kind: "run", data: { observedStatus: "completed", generation: version, sourceName: namespace(volume) } },
      { id: eventId(version), kind: "attempt", data: { attemptId: eventId(version), generation: version, sourceName: namespace(volume) } },
    ], relations: [{ from: eventId(version), to: SHARED_ID, predicate: "attempt-of", provenance }] };
}
function batch(volume: number, generationId: string, first: number, last: number): TraceProjectionBatch {
  return { generationId, runKey: key(volume), ...(first > 1 ? { previous: cut(volume, first - 1) } : {}), cut: cut(volume, last),
    facts: Array.from({ length: last - first + 1 }, (_, index) => fact(volume, first + index)) };
}
function expectedSource(volume: number, version: number): Source {
  // Ledger occurrence identity is specified as SHA256([canonical(runKey), version, kind, occurrence ID]).
  return { sourceKey: digest([canonical(key(volume)), version, "fixture-observation", `occurrence-${version}`]),
    digest: digest({ fixture: "fixture-multi-run-incremental-v1", namespace: `fixture-volume-${volume}`, version }), version,
    journalRef: `sha256:${digest({ domain: "journal", namespace: `fixture-volume-${volume}`, version })}`,
    stateRef: `sha256:${digest({ domain: "state", namespace: `fixture-volume-${volume}`, version })}`,
    factKind: "fixture-observation", factIdentity: `occurrence-${version}` };
}
function normalize(mirror: Mirror): Mirror {
  return { sources: [...mirror.sources].sort((a, b) => a.version - b.version), entities: [...mirror.entities].sort((a, b) => compare(a.id, b.id)),
    edges: mirror.edges.map(edge => ({ relation: edge.relation, evidence: [...edge.evidence].sort((a, b) => compare(a.sourceKey, b.sourceKey)) }))
      .sort((a, b) => compare(canonical(a.relation), canonical(b.relation))) };
}
function oracle(volume: number, count: number): Mirror {
  const sources = Array.from({ length: count }, (_, index) => expectedSource(volume, index + 1));
  return normalize({ sources,
    entities: [{ id: "shared-run", kind: "run", data: { observedStatus: "completed", generation: count, sourceName: `fixture-volume-${volume}` } },
      ...Array.from({ length: count }, (_, index) => ({ id: `shared-event-${String(index + 1).padStart(6, "0")}`, kind: "attempt", data: { attemptId: `shared-event-${String(index + 1).padStart(6, "0")}`, generation: index + 1, sourceName: `fixture-volume-${volume}` } }))],
    edges: sources.map(source => ({ relation: { from: `shared-event-${String(source.version).padStart(6, "0")}`, to: "shared-run", predicate: "attempt-of", provenance: { capture: "fixture-synthetic", claimKind: "declared", authority: "none" } }, evidence: [{ sourceKey: source.sourceKey, provenance: { capture: "fixture-synthetic", claimKind: "declared", authority: "none" } }] })),
  });
}
const mirrorHashes = (mirror: Mirror) => ({ sources: digest(mirror.sources), entities: digest(mirror.entities), edges: digest(mirror.edges), complete: digest(mirror) });
async function readback(store: DeltaStore, volume: number, count: number, generationId: string) {
  const sources: Source[] = [], entities = new Map<string, TraceEntityInput>(), edges = new Map<string, Edge>(); let offset = 0, pages = 0;
  for (;;) {
    const page = await store.traceExplain({ runKey: key(volume), generationId, limit: 128, offset }) as Page; pages++;
    assert(Array.isArray(page.sources) && Array.isArray(page.entities) && Array.isArray(page.relations), "readback-shape");
    sources.push(...page.sources);
    for (const entity of page.entities) { assert(entity.data?.sourceName === namespace(volume), "namespace-entity-isolation"); entities.set(entity.id, entity); }
    for (const edge of page.relations) {
      const semantic = canonical(edge.relation), prior = edges.get(semantic);
      if (prior) prior.evidence.push(...edge.evidence); else edges.set(semantic, { relation: edge.relation, evidence: [...edge.evidence] });
    }
    if (!page.truncated) break;
    assert(Number.isSafeInteger(page.nextOffset) && page.nextOffset! > offset && page.nextOffset! <= count, "readback-cursor-progress"); offset = page.nextOffset!;
  }
  const normalized = normalize({ sources, entities: [...entities.values()], edges: [...edges.values()] });
  assert(sources.length === count && new Set(sources.map(source => source.sourceKey)).size === count, "readback-source-count");
  same(mirrorHashes(normalized), mirrorHashes(oracle(volume, count)), "independent-full-readback-hashes");
  return { mirror: normalized, hashes: mirrorHashes(normalized), pages };
}
function counts(volumes: number[], additions = 0) { const total = volumes.reduce((sum, volume) => sum + volume + additions, 0); return { sources: total, entities: total + volumes.length, relations: total, issues: 0, logicalRelations: total }; }
function distribution(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b), rank = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { samples: samples.length, unit: "ms", method: "nearest-rank", p50: rank(0.5), p95: rank(0.95), min: sorted[0], max: sorted.at(-1) };
}
async function timed<T>(body: () => Promise<T>) { const start = performance.now(); const value = await body(); return { value, ms: performance.now() - start }; }

export async function runTraceabilityIncrementalBenchmark(options: IncrementalBenchmarkOptions) {
  assert(process.env.FORGE_FABRIC_TEST_MODE === "1" && isAbsolute(options.output), "explicit-fixture-mode-and-absolute-output");
  const volumes = options.volumes ?? (options.smoke ? [3, 7, 11] : [100, 1000, 10000]), repetitions = options.repetitions ?? (options.smoke ? 3 : 30);
  assert(volumes.length === 3 && new Set(volumes).size === 3 && volumes.every(volume => Number.isSafeInteger(volume) && volume >= 1 && volume <= 10000), "three-bounded-namespaces");
  assert(Number.isSafeInteger(repetitions) && repetitions >= 1 && repetitions <= 100, "sample-bound");
  const output = resolve(options.output); await mkdir(dirname(output), { recursive: true });
  const root = await mkdtemp(join(tmpdir(), "forge-trace-incremental-"));
  const oldDrain = process.env.FORGE_DELTA_BACKGROUND_DRAIN; process.env.FORGE_DELTA_BACKGROUND_DRAIN = "0";
  const generationId = "fixture-incremental-A", rebuildId = "fixture-incremental-B", started = performance.now(); let store: DeltaStore | undefined;
  try {
    store = await DeltaStore.open(root, { access: "write" }); await store.traceCreateGeneration({ generationId, extractorVersion: EXTRACTOR });
    const initialWrites = [];
    for (const volume of volumes) {
      const initialized = await timed(async () => {
        let inserted = 0;
        for (let first = 1; first <= volume; first += 128) inserted += (await store!.traceProjectBatch(batch(volume, generationId, first, Math.min(volume, first + 127)))).inserted;
        return inserted;
      });
      assert(initialized.value === volume, "initial-unique-facts"); initialWrites.push({ volume, ms: initialized.ms, inserted: initialized.value });
    }
    const initialCuts = volumes.map(volume => ({ runKey: key(volume), cut: cut(volume, volume) }));
    await store.traceActivateGeneration({ generationId, cuts: initialCuts }); const initial = await store.traceStatus(generationId);
    same(initial.counts, counts(volumes), "initial-multi-run-counts"); assert(initial.cuts.length === 3, "initial-checkpoint-namespaces");
    for (const volume of volumes) await readback(store, volume, volume, generationId);
    // The initial catalog construction and readback warm the same broker. Every timed operation below is a genuinely NEW version.
    const samples: { baseVolume: number; previousVersion: number; newVersion: number; ownRunFactsBefore: number; catalogFactsBefore: number; inserted: number; replayed: number; ms: number }[] = [];
    let catalogFacts = volumes.reduce((sum, volume) => sum + volume, 0);
    for (let sample = 1; sample <= repetitions; sample++) for (const volume of volumes) {
      const version = volume + sample, result = await timed(() => store!.traceProjectBatch(batch(volume, generationId, version, version)));
      assert(result.value.inserted === 1 && result.value.replayed === 0, "warm-call-is-new-write"); same(result.value.checkpoint, cut(volume, version), "warm-checkpoint-advanced-once");
      samples.push({ baseVolume: volume, previousVersion: version - 1, newVersion: version, ownRunFactsBefore: version - 1, catalogFactsBefore: catalogFacts, inserted: 1, replayed: 0, ms: result.ms }); catalogFacts++;
    }
    const finalCuts = volumes.map(volume => ({ runKey: key(volume), cut: cut(volume, volume + repetitions) }));
    await store.traceActivateGeneration({ generationId, cuts: finalCuts }); const final = await store.traceStatus(generationId);
    same(final.counts, counts(volumes, repetitions), "final-multi-run-counts"); same(final.cuts.map(item => item.cut.version).sort((a, b) => a - b), volumes.map(volume => volume + repetitions).sort((a, b) => a - b), "final-checkpoint-versions");
    const expectedHashes = new Map<number, ReturnType<typeof mirrorHashes>>(), sourceSets: Set<string>[] = [], readbacks = [];
    for (const volume of volumes) {
      const checked = await readback(store, volume, volume + repetitions, generationId), expected = mirrorHashes(oracle(volume, volume + repetitions)); expectedHashes.set(volume, expected); sourceSets.push(new Set(checked.mirror.sources.map(source => source.sourceKey)));
      readbacks.push({ baseVolume: volume, totalFacts: volume + repetitions, pages: checked.pages, expected, observed: checked.hashes });
    }
    for (let i = 0; i < sourceSets.length; i++) for (let j = i + 1; j < sourceSets.length; j++) assert([...sourceSets[i]!].every(source => !sourceSets[j]!.has(source)), "namespace-source-occurrences-disjoint");
    await store.traceCreateGeneration({ generationId: rebuildId, extractorVersion: EXTRACTOR });
    const rebuild = await timed(async () => {
      for (const volume of volumes) for (let first = 1; first <= volume + repetitions; first += 128) await store!.traceProjectBatch(batch(volume, rebuildId, first, Math.min(volume + repetitions, first + 127)));
      const rebuilt = [];
      for (const volume of volumes) { const checked = await readback(store!, volume, volume + repetitions, rebuildId); same(checked.hashes, expectedHashes.get(volume), "rebuilt-independent-hashes"); rebuilt.push({ baseVolume: volume, pages: checked.pages, hashes: checked.hashes }); }
      return rebuilt;
    });
    assert((await store.traceStatus()).generationId === generationId, "old-generation-active-until-switch"); same((await store.traceStatus(rebuildId)).counts, final.counts, "rebuild-aggregate-counts");
    await store.traceActivateGeneration({ generationId: rebuildId, cuts: finalCuts }); assert((await store.traceStatus()).generationId === rebuildId, "rebuilt-generation-atomic-activation");
    const report = { schema: "forge.trace-incremental-benchmark.v1", mode: options.smoke ? "smoke" : "benchmark", runtime: { node: process.version, platform: process.platform, arch: process.arch },
      catalog: { brokerInstances: 1, runCount: 3, baseVolumes: volumes, baseFacts: counts(volumes).sources, finalFacts: counts(volumes, repetitions).sources, sharedCheckoutAndFabricStore: true, distinctRunIds: true, reusedEntityIds: [SHARED_ID, "shared-event-N"], runKeys: volumes.map(key) },
      initialization: { batchLimit: 128, writes: initialWrites, counts: initial.counts },
      incremental: { repetitionsPerRun: repetitions, totalNewWrites: samples.length, factsPerWrite: 1, replayWrites: 0, timingScope: "one new fact with BEGIN, ledger/entity/relation/checkpoint work and COMMIT through the existing single broker; no full rebuild inside measured calls",
        perRun: volumes.map(volume => ({ baseVolume: volume, finalVolume: volume + repetitions, warm: distribution(samples.filter(item => item.baseVolume === volume).map(item => item.ms)) })), samples },
      independentReadback: { method: "independent canonical JSON and SHA256 mathematical occurrence/entity/relation recipe; no production digest or Fabric extractor used", allCompared: true, expectedAggregateCounts: counts(volumes, repetitions), observedAggregateCounts: final.counts,
        namespaceIsolation: { sharedLocalIds: true, disjointOccurrenceKeys: true, exactPerRunSourceEntityEdgeHashes: true }, runs: readbacks },
      rebuild: { ms: rebuild.ms, runs: rebuild.value, sameIndependentHashes: true, activeGeneration: rebuildId },
      boundaries: { syntheticDeltaOnly: true, sourceFabricExecutions: 0, backgroundQueueDrain: false, providersInvoked: false, hooksActivated: false, gitOperations: false, externalNetworkRequests: false, push: false, deploy: false },
      limits: ["Synthetic Delta broker workload; these are not Fabric scheduler or source-history extraction timings.", "All runs share one broker and one populated catalog. Local entity IDs repeat across three runIds within the same repository, checkout and Fabric store namespace.", "Thirty new one-fact appends per run are measured by default; a separate untimed rebuild validates equivalent data.", "No OS cache eviction or production SLO is claimed. The construction and full baseline readback precede warm incremental measurements."], totalMs: performance.now() - started };
    await store.close(); store = undefined; await shutdownDeltaBroker(root); await rm(root, { recursive: true, force: true });
    await writeFile(output, `${JSON.stringify({ ...report, fixtureRemoved: true }, null, 2)}\n`, { flag: "wx" }); return report;
  } finally {
    await store?.close(); await shutdownDeltaBroker(root).catch(() => {}); await rm(root, { recursive: true, force: true });
    if (oldDrain === undefined) delete process.env.FORGE_DELTA_BACKGROUND_DRAIN; else process.env.FORGE_DELTA_BACKGROUND_DRAIN = oldDrain;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2); let output: string | undefined, smoke = false;
  for (let index = 0; index < argv.length; index++) { if (argv[index] === "--output") output = argv[++index]; else if (argv[index] === "--smoke") smoke = true; else throw new Error("TRACE_INCREMENTAL_UNKNOWN_ARGUMENT"); }
  assert(output, "absolute-output-required");
  runTraceabilityIncrementalBenchmark({ output, smoke }).then(report => process.stdout.write(`${JSON.stringify({ schema: report.schema, mode: report.mode, newWrites: report.incremental.totalNewWrites, allCompared: true, totalMs: report.totalMs })}\n`)).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "TRACE_INCREMENTAL_FAILED"}\n`); process.exitCode = 1; });
}
