import { programAssert, programDigest, type ProgramRunV2, type ProgramAssessment } from "./program-contract.ts";
import { ProgramRunStore, type ProgramHistoryEntry, type TraceSourceArtifact } from "./program-store.ts";
import { assertTraceIdentity, traceRelativePath, traceSummary, type TraceIdentity, type TraceRunKey, type TraceProvenance } from "./trace-contract.ts";
import type { ManagedArtifact } from "./managed-workspace.ts";
import type { TraceEntityInput, TraceMetadata, TraceProjectionFact, TraceRelationInput } from "../delta/trace-projection.ts";

export const TRACE_EXTRACTOR_VERSION = "fabric-trace-v2";
const observed: TraceProvenance = { capture: "fabric-journal", claimKind: "observed", authority: "none" };
const node = (kind: string, value: unknown) => `${kind}:${programDigest(value).slice(7)}`;
const changed = (a: unknown, b: unknown) => programDigest(a ?? null) !== programDigest(b ?? null);
const relation = (from: string, to: string, predicate: string, provenance = observed, qualifier?: string): TraceRelationInput => ({ from, to, predicate, provenance, ...(qualifier ? { qualifier } : {}) });
export interface TraceExtractionContext { store: ProgramRunStore; identity: TraceIdentity; artifacts?: Map<string, ManagedArtifact> }

/** A source occurrence is a journal transition, not the time a projector happened to read it. */
export async function extractFabricTrace(context: TraceExtractionContext, entry: ProgramHistoryEntry, previous?: ProgramRunV2): Promise<TraceProjectionFact[]> {
  const { store, identity } = context, state = entry.state, runKey: TraceRunKey = { ...identity, runId: state.runId };
  const runNode = node("run", runKey), facts: TraceProjectionFact[] = [], cache = context.artifacts ?? new Map<string, ManagedArtifact>();
  const fact = (factKind: string, factIdentity: string, source: unknown, entities: TraceEntityInput[] = [], relations: TraceRelationInput[] = []) => {
    facts.push({ journalVersion: entry.version, journalRef: entry.journalRef, stateRef: entry.stateRef, factKind, factIdentity: node("fact", [factKind, factIdentity]),
      sourceDigest: programDigest({ extractor: TRACE_EXTRACTOR_VERSION, factKind, factIdentity, source }), entities, relations });
  };
  // Every committed version has a ledger occurrence, even when no semantic entity changed.
  fact("snapshot", "run", { status: state.status, semanticVersion: state.semanticVersion, traceRef: state.traceBindingsRef ?? null, gateRef: state.gateRef ?? null, receiptRef: state.receiptRef ?? null }, [
    { id: runNode, kind: "run", data: { observedStatus: state.status, semanticVersion: state.semanticVersion, baselineDigest: state.baselineDigest,
      ...(state.traceBindingsRef ? { bindingsRef: state.traceBindingsRef } : {}), ...(state.gateRef ? { gateRef: state.gateRef } : {}) } },
  ]);
  for (const [id, operation] of Object.entries(state.operations)) if (changed(operation, previous?.operations[id])) {
    const target = node("operation", id);
    fact("operation", id, operation, [{ id: target, kind: "operation", data: { operationId: target, status: operation.status, generation: operation.generation } }], [relation(target, runNode, "part-of")]);
  }
  for (const [id, attempt] of Object.entries(state.attempts)) if (changed(attempt, previous?.attempts[id])) {
    const target = node("attempt", id);
    fact("attempt", id, { operationId: attempt.operationId, generation: attempt.generation, outcome: attempt.outcome, inputDigest: attempt.inputDigest, executorDigest: attempt.executorDigest },
      [{ id: target, kind: "attempt", data: { attemptId: id, operationId: node("operation", attempt.operationId), generation: attempt.generation, status: attempt.outcome } }],
      [relation(target, runNode, "attempt-of"), relation(target, node("operation", attempt.operationId), "performs")]);
  }
  for (const [id, candidate] of Object.entries(state.candidates)) if (changed(candidate, previous?.candidates[id])) {
    const paths = new Set<string>(), entities: TraceEntityInput[] = [], relations: TraceRelationInput[] = [];
    const target = node("candidate", id);
    for (const deltaId of candidate.deltas) {
      const delta = state.deltas[deltaId]; programAssert(delta, "Trace candidate delta unavailable", "TRACE_SOURCE_UNAVAILABLE");
      let artifact = cache.get(delta.artifactRef);
      if (!artifact) { artifact = await store.get<ManagedArtifact>(delta.artifactRef); cache.set(delta.artifactRef, artifact); }
      programAssert(Array.isArray(artifact.files), "Trace artifact unavailable", "TRACE_SOURCE_UNAVAILABLE");
      const deltaPaths = artifact.files.map(file => traceRelativePath(file.path)); deltaPaths.forEach(path => paths.add(path));
      const deltaNode = node("delta", deltaId);
      entities.push({ id: deltaNode, kind: "delta", data: { artifactRef: delta.artifactRef, paths: deltaPaths } });
      relations.push(relation(target, deltaNode, "includes-delta"), relation(deltaNode, node("attempt", delta.producerAttemptId), "produced-by"));
    }
    programAssert(paths.size <= 128, "Trace path budget exceeded", "TRACE_LIMIT_EXCEEDED");
    entities.push({ id: target, kind: "candidate", data: { candidateId: id, candidateDigest: candidate.digest, baselineDigest: candidate.baselineDigest, paths: [...paths].sort() } });
    const baselineNode = node("baseline", candidate.baselineDigest);
    entities.push({ id: baselineNode, kind: "baseline", data: { baselineDigest: candidate.baselineDigest } });
    relations.push(relation(target, runNode, "candidate-of"), relation(target, baselineNode, "based-on"));
    candidate.parents.forEach(parent => relations.push(relation(target, node("candidate", parent), "derived-from")));
    candidate.producerAttempts.forEach(attempt => relations.push(relation(target, node("attempt", attempt), "produced-by")));
    fact("candidate", id, candidate, entities, relations);
  }
  type GateSource = { assessment?: ProgramAssessment | null; candidateDigest?: string; semanticVersion?: number; programDigest?: string; seals?: unknown; acceptanceDigest?: string; policyDigest?: string; populationDigest?: string };
  const gateReceipt = state.gateRef ? await store.get<GateSource>(state.gateRef) : undefined;
  const applicabilityContext = (run: ProgramRunV2 | undefined, id: string) => {
    const assessment = run?.assessments[id];
    return run && assessment ? { gateRef: run.gateRef ?? null, semanticVersion: run.semanticVersion, programDigest: run.programDigest, registryDigest: run.registryDigest,
      acceptedCandidate: run.acceptedCandidate?.digest ?? null, seals: run.seals, operation: (assessment.operationId ? run.operations[assessment.operationId] : null) ?? null,
      attempts: assessment.attemptIds.map(attempt => [attempt, run.attempts[attempt]?.outcome ?? null]) } : null;
  };
  const assessmentOwnerGated = (run: ProgramRunV2, assessment: ProgramAssessment, receipt: GateSource | undefined): boolean => {
    const operation = assessment.operationId ? run.operations[assessment.operationId] : undefined;
    const acceptance = run.registry.acceptance[`${run.program.acceptance.id}@${run.program.acceptance.version}`];
    const policy = run.registry.policies[`${run.program.policy.id}@${run.program.policy.version}`];
    const population = run.program.population ? run.registry.populations[`${run.program.population.id}@${run.program.population.version}`] : null;
    return !!receipt?.assessment && receipt.semanticVersion === run.semanticVersion && receipt.programDigest === run.programDigest
      && receipt.candidateDigest === assessment.candidateDigest && run.acceptedCandidate?.digest === assessment.candidateDigest
      && (!receipt.acceptanceDigest || programDigest(acceptance ?? null) === receipt.acceptanceDigest)
      && (!receipt.policyDigest || programDigest(policy ?? null) === receipt.policyDigest)
      && (!receipt.populationDigest || programDigest(population ?? null) === receipt.populationDigest)
      && programDigest(receipt.seals ?? null) === programDigest(run.seals) && programDigest(receipt.assessment) === programDigest(assessment)
      && !!operation && operation.status === "completed" && !operation.retired && operation.generation === assessment.generation
      && operation.semanticDigest === assessment.semanticDigest && operation.inputDigest === assessment.inputDigest
      && assessment.attemptIds.every(attempt => run.attempts[attempt]?.outcome === "completed");
  };
  const gateApplicabilityContext = (run: ProgramRunV2 | undefined) => run ? {
    gateRef: run.gateRef ?? null, semanticVersion: run.semanticVersion, programDigest: run.programDigest, registryDigest: run.registryDigest,
    acceptedCandidate: run.acceptedCandidate?.digest ?? null, seals: run.seals,
    assessments: Object.entries(run.assessments).map(([id, assessment]) => ({ id, assessment, applicability: applicabilityContext(run, id) })),
  } : null;
  for (const [id, assessment] of Object.entries(state.assessments)) if (changed(assessment, previous?.assessments[id]) || changed(applicabilityContext(state, id), applicabilityContext(previous, id))) {
    const target = node("assessment", id), candidates = Object.values(state.candidates).filter(candidate => candidate.digest === assessment.candidateDigest);
    const ownerGated = assessmentOwnerGated(state, assessment, gateReceipt);
    const entities: TraceEntityInput[] = [{ id: target, kind: "assessment", data: { candidateDigest: assessment.candidateDigest, result: assessment.verdict,
      current: ownerGated, validity: ownerGated ? "owner-gated-at-cut" : "historical-or-unverified",
      ...(assessment.generation === undefined ? {} : { generation: assessment.generation }), ...(assessment.operationId ? { operationId: node("operation", assessment.operationId) } : {}),
      ...(assessment.inputDigest ? { inputDigest: assessment.inputDigest } : {}), ...(assessment.semanticDigest ? { semanticDigest: assessment.semanticDigest } : {}),
      ...(assessment.environmentRef ? { environmentRef: assessment.environmentRef } : {}), ...(assessment.contractDigest ? { contractDigest: assessment.contractDigest } : {}) } }];
    const relations = candidates.map(candidate => relation(node("candidate", candidate.candidateId), target, "assessed-by"));
    assessment.attemptIds.forEach(attempt => relations.push(relation(target, node("attempt", attempt), "performed-by")));
    assessment.checks.forEach((check, index) => {
      const checkNode = node("check", [id, index, check.id]);
      entities.push({ id: checkNode, kind: "check", data: { candidateDigest: assessment.candidateDigest, result: check.passed ? "passed" : "failed", ...(assessment.environmentRef ? { environmentRef: assessment.environmentRef } : {}) } });
      relations.push(relation(target, checkNode, "includes-check"));
    });
    fact("assessment", id, assessment, entities, relations);
  }
  const gateRefChanged = changed(state.gateRef, previous?.gateRef);
  if (gateRefChanged && previous?.gateRef) fact("gate-state", previous.gateRef, { gateRef: previous.gateRef, current: false }, [{ id: node("gate", previous.gateRef), kind: "gate", data: { gateRef: previous.gateRef, current: false, validity: "historical-or-unverified" } }]);
  if (state.gateRef && gateReceipt && (gateRefChanged || changed(gateApplicabilityContext(state), gateApplicabilityContext(previous)))) {
    const target = node("gate", state.gateRef), current = Object.values(state.assessments).some(assessment => assessmentOwnerGated(state, assessment, gateReceipt));
    const data: TraceMetadata = { gateRef: state.gateRef, current, validity: current ? "owner-gated-at-cut" : "historical-or-unverified", ...(typeof gateReceipt.candidateDigest === "string" ? { candidateDigest: gateReceipt.candidateDigest } : {}) };
    // Context changes update validity while retaining the original historical gated-by evidence.
    fact(gateRefChanged ? "gate" : "gate-state", state.gateRef, { receipt: gateReceipt, applicability: gateApplicabilityContext(state), current }, [{ id: target, kind: "gate", data }],
      gateRefChanged ? Object.values(state.candidates).filter(candidate => candidate.digest === gateReceipt.candidateDigest).map(candidate => relation(node("candidate", candidate.candidateId), target, "gated-by")) : []);
  }
  if (state.intent && (changed(state.intent, previous?.intent) || state.status !== previous?.status || state.receiptRef !== previous?.receiptRef)) {
    const target = node("apply", state.intent.id), candidate = Object.values(state.candidates).find(item => item.digest === state.intent!.candidateDigest);
    if (state.receiptRef) await store.get(state.receiptRef);
    fact("apply", state.intent.id, { status: state.status, intentId: state.intent.id, candidateDigest: state.intent.candidateDigest, receiptRef: state.receiptRef ?? null },
      [{ id: target, kind: "apply", data: { status: state.status, candidateDigest: state.intent.candidateDigest, ...(state.receiptRef ? { receiptRef: state.receiptRef } : {}) } }],
      candidate ? [relation(node("candidate", candidate.candidateId), target, state.status === "applied" && state.receiptRef ? "applied-as" : "application-attempt")] : []);
  }
  if (state.traceBindingsRef && state.traceBindingsRef !== previous?.traceBindingsRef) {
    const closure = await store.traceArtifacts(state.runId, { journalRef: entry.journalRef }); assertTraceIdentity(closure.runKey, identity);
    let previousRefs = new Set<string>();
    if (previous?.traceBindingsRef) {
      const manifest = await store.get<{ originRefs: string[]; annotationRefs: string[] }>(previous.traceBindingsRef);
      previousRefs = new Set([...manifest.originRefs, ...manifest.annotationRefs]);
    }
    for (const artifact of closure.artifacts) if (artifact.type !== "manifest" && !previousRefs.has(artifact.ref)) addBindingFact(artifact);
  }
  function addBindingFact(artifact: Exclude<TraceSourceArtifact, { type: "manifest" }>): void {
    const target = node(artifact.type, artifact.ref), entities: TraceEntityInput[] = [], relations: TraceRelationInput[] = [];
    if (artifact.type === "origin") {
      const origin = artifact.value;
      entities.push({ id: target, kind: "origin", data: { originRef: artifact.ref, sourceNamespace: origin.origin.issuerNamespace, integration: origin.origin.integration,
        externalSessionId: origin.origin.externalSessionId, ...(origin.origin.turnId ? { turnId: origin.origin.turnId } : {}), transcriptStored: false, privacyProfile: origin.privacyProfile } });
      relations.push(relation(runNode, target, "requested-by", origin.provenance));
      for (const confirmed of origin.confirmedSlices ?? []) memory(confirmed.event, confirmed.slice, target, entities, relations, origin.provenance);
    } else {
      const annotation = artifact.value;
      entities.push({ id: target, kind: "annotation", data: { annotationRef: artifact.ref, result: annotation.type } });
      if (annotation.type === "origin-event-bound") {
        memory(annotation.event, annotation.confirmedSlice, node("origin", annotation.originRef), entities, relations, annotation.provenance);
        relations.push(relation(target, node("memory", [annotation.event.memoryStoreId, annotation.event.eventId]), "records", annotation.provenance));
      }
      else if (annotation.type === "git-observation") {
        const git = annotation.observation, gitNode = node("git", artifact.ref);
        const data: TraceMetadata = { annotationRef: artifact.ref, observation: git.commit.status, objectFormat: git.objectFormat, candidateDigest: git.candidate.digest, baselineDigest: git.candidate.baselineDigest,
          paths: git.candidate.scope, contentMatch: git.contentMatch, exactIntegration: git.exactIntegration,
          ...(git.commit.oid ? { commitOid: git.commit.oid } : {}), ...(git.commit.parents ? { parents: git.commit.parents } : {}) };
        entities.push({ id: gitNode, kind: "git-observation", data }); relations.push(relation(target, gitNode, "records", annotation.provenance));
        for (const candidate of Object.values(state.candidates).filter(item => item.digest === git.candidate.digest)) {
          if (git.claims.includes("contains-candidate-content")) relations.push(relation(gitNode, node("candidate", candidate.candidateId), "contains-candidate-content"));
          if (git.claims.includes("commit-linked-by-host")) relations.push(relation(gitNode, node("candidate", candidate.candidateId), "commit-linked-by-host", { capture: "host-reported", claimKind: "declared", authority: "none" }));
        }
      } else {
        entities.push({ id: target, kind: "correction", data: { annotationRef: artifact.ref, supersedesRef: annotation.supersedesRef, reason: traceSummary(annotation.reason).replace(/[\x00-\x1f\x7f]/gu, " "), replacementSummary: traceSummary(annotation.replacement.summary).replace(/[\x00-\x1f\x7f]/gu, " "), replacementProducer: annotation.replacement.producer } });
        relations.push(relation(target, node("annotation", annotation.supersedesRef), "supersedes", annotation.provenance));
      }
    }
    fact(artifact.type, artifact.ref, artifact.value, entities, relations);
  }
  function memory(event: { memoryStoreId: string; eventId: string; eventDigest: string; sourceNamespace: string }, slice: { integration: string; externalSessionId: string; turnId?: string }, originNode: string, entities: TraceEntityInput[], relations: TraceRelationInput[], provenance: TraceProvenance): void {
    const target = node("memory", [event.memoryStoreId, event.eventId]);
    entities.push({ id: target, kind: "agent-memory-event", data: { ...event, integration: slice.integration, externalSessionId: slice.externalSessionId,
      ...(slice.turnId ? { turnId: slice.turnId } : {}), availability: "historical-confirmed" } });
    relations.push(relation(originNode, target, "recorded-as", provenance));
  }
  return facts;
}
