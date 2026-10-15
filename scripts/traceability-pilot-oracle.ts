/** Independent, fixture-only source oracle. No production canonicalizer, extractor or projector is imported. */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface ExpectedTraceEdge { from: string; to: string; predicate: string }
const predicates = new Set(["requested-by", "recorded-as", "produced-by", "assessed-by", "includes-check", "gated-by", "applied-as", "contains-candidate-content", "commit-linked-by-host"]);
type ObjectValue = Record<string, unknown>;
function assert(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(`TRACE_ORACLE_ASSERTION:${label}`); }
function object(value: unknown, label: string): ObjectValue { assert(value !== null && typeof value === "object" && !Array.isArray(value), label); return value as ObjectValue; }
function string(value: unknown, label: string): string { assert(typeof value === "string" && value.length > 0, label); return value; }
function list(value: unknown, label: string): unknown[] { assert(Array.isArray(value), label); return value; }
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as ObjectValue).filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}
const sha = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
const sourceNode = (kind: string, identity: unknown) => `${kind}:${sha(identity)}`;
const reference = (value: unknown): string => { assert(typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value), "digest-reference"); return value; };

export async function deriveExpectedTraceEdges(input: { directory: string; runId: string; journalRef: string }) {
  const directory = resolve(input.directory), artifacts = join(directory, "artifacts");
  assert(await realpath(directory) === directory && await realpath(artifacts) === artifacts, "source-directory-symlink");
  const cache = new Map<string, ObjectValue>(); let bytesRead = 0;
  async function readJson(path: string) {
    const stat = await lstat(path); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32 * 1024 * 1024, "source-file-bound-or-type");
    bytesRead += stat.size; assert(bytesRead <= 128 * 1024 * 1024, "source-total-byte-budget");
    return object(JSON.parse(await readFile(path, "utf8")), "source-json-object");
  }
  async function get(raw: unknown): Promise<ObjectValue> {
    const ref = reference(raw), prior = cache.get(ref); if (prior) return prior;
    assert(cache.size < 32768, "source-object-budget");
    const value = await readJson(join(artifacts, `${ref.slice(7)}.json`)); assert(`sha256:${sha(value)}` === ref, "cas-object-hash"); cache.set(ref, value); return value;
  }
  const envelope = await readJson(join(directory, `${sha(input.runId)}.json`)), record = object(envelope.record, "committed-record");
  assert(envelope.digest === `sha256:${sha(record)}` && record.runId === input.runId && record.format === 4, "committed-envelope-integrity");
  assert(record.journalRef === input.journalRef, "committed-envelope-cut");
  const seen = new Set<string>(), history: { journalRef: string; stateRef: string; version: number; state: ObjectValue; type: string }[] = [];
  let next: string | undefined = reference(input.journalRef), expectedVersion = Number(record.version);
  assert(Number.isSafeInteger(expectedVersion) && expectedVersion > 0 && expectedVersion <= 4096, "journal-version-budget");
  while (next) {
    assert(!seen.has(next) && seen.size < 4096, "journal-cycle-or-budget"); seen.add(next);
    const journal = await get(next), stateRef = reference(journal.stateRef), state = await get(stateRef);
    assert(journal.runId === input.runId && journal.version === expectedVersion && journal.stateDigest === stateRef && state.runId === input.runId && state.version === expectedVersion, "journal-state-ancestry");
    if (history.length === 0) assert(record.stateRef === stateRef, "envelope-state-head");
    history.push({ journalRef: next, stateRef, version: expectedVersion, state, type: string(journal.type, "journal-type") });
    next = journal.parentRef === undefined ? undefined : reference(journal.parentRef); expectedVersion--;
  }
  assert(expectedVersion === 0, "journal-complete-from-one"); history.reverse();
  const committedJournals = new Map(history.map(entry => [entry.journalRef, entry]));
  const edges = new Map<string, ExpectedTraceEdge>(), commitOids = new Set<string>(), applyReceipts = new Set<string>();
  let runKey: ObjectValue | undefined, originCount = 0, annotationCount = 0, verifiedApplyStates = 0;
  const countedOrigins = new Set<string>(), countedAnnotations = new Set<string>();
  const add = (from: string, to: string, predicate: string) => {
    assert(predicates.has(predicate), "unexpected-oracle-predicate"); const edge = { from, to, predicate }; edges.set(canonical(edge), edge);
  };
  const candidateEntries = (state: ObjectValue) => Object.entries(object(state.candidates, "candidates")).map(([key, value]) => ({ key, value: object(value, "candidate") }));
  function confirmMemoryBinding(rawEvent: unknown, rawSlice: unknown, rawOrigin: unknown) {
    const event = object(rawEvent, "confirmed-event"), slice = object(rawSlice, "confirmed-slice"), origin = object(rawOrigin, "external-origin");
    assert(reference(event.eventDigest) === `sha256:${sha(slice)}`, "confirmed-slice-digest");
    assert(event.sourceNamespace === slice.sourceNamespace && slice.sourceNamespace === origin.issuerNamespace
      && slice.integration === origin.integration && slice.externalSessionId === origin.externalSessionId && slice.turnId === origin.turnId, "confirmed-slice-origin");
    return [string(event.memoryStoreId, "memory-store"), string(event.eventId, "memory-event")];
  }
  for (const entry of history) {
    const state = entry.state, candidates = candidateEntries(state), attempts = object(state.attempts, "attempts"), deltas = object(state.deltas, "deltas");
    for (const candidate of candidates) {
      assert(candidate.value.candidateId === candidate.key, "candidate-identity");
      const target = sourceNode("candidate", candidate.key);
      for (const rawAttempt of list(candidate.value.producerAttempts, "candidate-producers")) {
        const attemptId = string(rawAttempt, "producer-id"); assert(attempts[attemptId], "producer-attempt-reachable"); add(target, sourceNode("attempt", attemptId), "produced-by");
      }
      for (const rawDelta of list(candidate.value.deltas, "candidate-deltas")) {
        const deltaId = string(rawDelta, "delta-id"), delta = object(deltas[deltaId], "delta-record"); await get(delta.artifactRef);
        const attemptId = string(delta.producerAttemptId, "delta-producer-id"); assert(attempts[attemptId], "delta-producer-reachable"); add(sourceNode("delta", deltaId), sourceNode("attempt", attemptId), "produced-by");
      }
    }
    for (const [assessmentId, raw] of Object.entries(object(state.assessments, "assessments"))) {
      const assessment = object(raw, "assessment"), target = sourceNode("assessment", assessmentId);
      for (const candidate of candidates) if (candidate.value.digest === assessment.candidateDigest) add(sourceNode("candidate", candidate.key), target, "assessed-by");
      list(assessment.checks, "assessment-checks").forEach((rawCheck, index) => {
        const check = object(rawCheck, "assessment-check"); add(target, sourceNode("check", [assessmentId, index, string(check.id, "check-id")]), "includes-check");
      });
    }
    if (state.gateRef) {
      const gate = await get(state.gateRef);
      for (const candidate of candidates) if (candidate.value.digest === gate.candidateDigest) add(sourceNode("candidate", candidate.key), sourceNode("gate", state.gateRef), "gated-by");
    }
    if (state.status === "applied" && state.receiptRef) {
      const intent = object(state.intent, "applied-intent"), receipt = await get(state.receiptRef), accepted = object(state.acceptedCandidate, "applied-candidate");
      assert(canonical(receipt.intent) === canonical(intent), "receipt-intent-binding");
      assert(receipt.digest === intent.expectedDigest || receipt.observed === true, "confirmed-receipt-content");
      if (receipt.observed === true) assert(history.some(source => source.version <= entry.version && source.type === "apply-reconciled" && source.state.status === "applied" && source.state.receiptRef === state.receiptRef), "reconciled-receipt-journal");
      assert(accepted.digest === intent.candidateDigest && candidates.some(candidate => candidate.key === accepted.candidateId && canonical(candidate.value) === canonical(accepted)), "accepted-candidate-binding");
      add(sourceNode("candidate", accepted.candidateId), sourceNode("apply", string(intent.id, "application-id")), "applied-as"); applyReceipts.add(reference(state.receiptRef)); verifiedApplyStates++;
    }
    const manifest = await get(state.traceBindingsRef); assert(manifest.schema === "forge.trace-manifest.v1", "manifest-schema");
    const currentKey = object(manifest.runKey, "manifest-run-key");
    assert(currentKey.runId === input.runId && (runKey === undefined || canonical(currentKey) === canonical(runKey)), "manifest-full-run-identity"); runKey = currentKey;
    const runNode = sourceNode("run", runKey), origins = list(manifest.originRefs, "manifest-origins").map(reference), annotations = list(manifest.annotationRefs, "manifest-annotations").map(reference);
    assert(origins.length > 0 && origins.length <= 8 && annotations.length <= 64, "metadata-reference-bounds");
    for (const ref of origins) {
      const origin = await get(ref); assert(origin.schema === "forge.trace-origin.v1", "origin-schema");
      for (const key of ["repositoryId", "checkoutId", "fabricStoreId", "runId"]) assert(origin[key] === runKey[key], "origin-full-run-identity");
      add(runNode, sourceNode("origin", ref), "requested-by"); if (!countedOrigins.has(ref)) { countedOrigins.add(ref); originCount++; }
      for (const rawBinding of (origin.confirmedSlices === undefined ? [] : list(origin.confirmedSlices, "confirmed-origin-events"))) {
        const binding = object(rawBinding, "confirmed-origin-event");
        assert(list(origin.agentMemoryRefs, "origin-event-refs").some(event => canonical(event) === canonical(binding.event)), "confirmed-event-listed");
        add(sourceNode("origin", ref), sourceNode("memory", confirmMemoryBinding(binding.event, binding.slice, origin.origin)), "recorded-as");
      }
    }
    for (const ref of annotations) {
      const annotation = await get(ref); assert(annotation.schema === "forge.trace-annotation.v1" && canonical(annotation.runKey) === canonical(runKey), "annotation-full-run-identity");
      if (!countedAnnotations.has(ref)) { countedAnnotations.add(ref); annotationCount++; }
      if (annotation.type === "origin-event-bound") {
        const originRef = reference(annotation.originRef); assert(origins.includes(originRef), "bound-origin-reachable");
        const origin = await get(originRef);
        add(sourceNode("origin", originRef), sourceNode("memory", confirmMemoryBinding(annotation.event, annotation.confirmedSlice, origin.origin)), "recorded-as");
      } else if (annotation.type === "git-observation") {
        const observation = object(annotation.observation, "git-observation"), commit = object(observation.commit, "git-commit"), candidate = object(observation.candidate, "git-candidate"), claims = list(observation.claims, "git-claims");
        for (const key of ["repositoryId", "checkoutId", "fabricStoreId"]) assert(observation[key] === runKey[key], "git-observation-identity");
        assert(candidate.baselineDigest === state.baselineDigest, "git-baseline-binding");
        if (commit.status === "observed") {
          const length = observation.objectFormat === "sha1" ? 40 : observation.objectFormat === "sha256" ? 64 : 0;
          assert(length > 0 && new RegExp(`^[a-f0-9]{${length}}$`).test(string(commit.oid, "commit-oid")), "git-full-oid-domain");
        }
        const matching = candidates.filter(item => item.value.digest === candidate.digest);
        if (claims.includes("contains-candidate-content")) {
          assert(commit.status === "observed" && observation.contentMatch === "matches" && matching.length > 0, "git-content-claim-binding"); commitOids.add(string(commit.oid, "commit-oid"));
          for (const item of matching) add(sourceNode("git", ref), sourceNode("candidate", item.key), "contains-candidate-content");
        }
        if (claims.includes("commit-linked-by-host")) {
          const apply = object(observation.apply, "git-apply-source"), applySource = committedJournals.get(reference(apply.sourceJournalRef));
          assert(observation.hostLink === "host-reported" && claims.includes("contains-candidate-content") && applySource?.state.status === "applied" && applySource.state.receiptRef === apply.receiptRef, "host-declaration-apply-source");
          const appliedCandidate = object(applySource.state.acceptedCandidate, "git-applied-candidate"); assert(appliedCandidate.digest === candidate.digest, "git-applied-candidate-binding"); await get(apply.receiptRef);
          for (const item of matching) add(sourceNode("git", ref), sourceNode("candidate", item.key), "commit-linked-by-host");
        }
      }
    }
  }
  const expectedEdges = [...edges.values()].sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
  const countsByPredicate = Object.fromEntries([...predicates].map(predicate => [predicate, expectedEdges.filter(edge => edge.predicate === predicate).length]));
  return { expectedEdges, coverage: { verifier: "independent atomic-envelope and raw-CAS canonical SHA256/ancestry/source joins; no production graph or hash helper used", versions: history.length,
    casObjectsVerified: cache.size, bytesRead, originsVerified: originCount, annotationsVerified: annotationCount, verifiedApplyStates, countsByPredicate,
    expectedEdgesDigest: sha(expectedEdges), gitCommitOids: [...commitOids].sort(), appliedReceiptRefs: [...applyReceipts].sort() } };
}
