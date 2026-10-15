import { createHash } from "node:crypto";
import type { DbAdapter, DbTransaction } from "../runtime/db/adapter.ts";
import { traceSummary, type TraceRunKey } from "../agent-fabric/trace-contract.ts";

export interface TraceCut { version: number; journalRef: string; stateRef: string }
export type TraceMetadata = Record<string, string | number | boolean | string[] | undefined>;
export interface TraceEntityInput { id: string; kind: string; data?: TraceMetadata }
export interface TraceRelationInput {
  from: string; to: string; predicate: string; qualifier?: string;
  provenance: { capture: string; claimKind: "declared" | "observed" | "inferred"; authority: string };
  data?: TraceMetadata;
}
export interface TraceProjectionFact {
  journalVersion: number; journalRef: string; stateRef: string; factKind: string; factIdentity: string;
  sourceDigest: string; entities?: TraceEntityInput[]; relations?: TraceRelationInput[];
}
export interface TraceProjectionBatch {
  generationId: string; runKey: TraceRunKey; previous?: TraceCut; cut: TraceCut;
  facts: TraceProjectionFact[];
  /** Deterministic crash seam; rejected unless the fixture flag is explicit. */
  faultBeforeCommit?: boolean;
}
export interface TraceExplanationFilter {
  runKey: TraceRunKey; generationId?: string; candidateId?: string; path?: string;
  atVersion?: number; limit?: number; offset?: number;
}
export class TraceProjectionError extends Error {
  constructor(readonly code: string) { super(code); this.name = "TraceProjectionError"; }
}
function fail(code: string): never { throw new TraceProjectionError(code); }
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
export function traceCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(traceCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => compareText(a,b)).map(([k, v]) => `${JSON.stringify(k)}:${traceCanonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function traceProjectionDigest(value: unknown): string { return createHash("sha256").update(traceCanonicalJson(value)).digest("hex"); }
const metadataFields = new Set([
  "status", "observedStatus", "candidateId", "candidateDigest", "baselineDigest", "artifactRef", "bindingsRef", "annotationRef",
  "operationId", "attemptId", "environmentRef", "contractDigest", "generation", "semanticVersion", "current", "valid", "result",
  "observation", "contentMatch", "exactIntegration", "commitOid", "objectFormat", "parents", "path", "paths", "eventId", "eventDigest",
  "memoryStoreId", "sourceNamespace", "sourceName", "integration", "externalSessionId", "turnId", "availability", "transcriptStored",
  "reason", "replacementSummary", "replacementProducer", "privacyProfile", "originRef", "supersedesRef", "eventType", "authorityRef", "gateRef", "receiptRef", "reasonCode", "inputDigest", "semanticDigest", "validity",
]);
function fields(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((k) => !allowed.includes(k))) fail("TRACE_INVALID_REFERENCE");
}
function secretLike(value: string): boolean {
  return /(?:^|[^A-Za-z0-9])(?:sk[-_](?:proj[-_])?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]+|npm_[A-Za-z0-9_]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/u.test(value);
}
function opaque(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:@+~-]{1,256}$/u.test(value) || secretLike(value)) fail("TRACE_INVALID_REFERENCE");
}
export function traceRunKeyString(key: TraceRunKey): string {
  if (!key || Object.keys(key).sort().join(",") !== "checkoutId,fabricStoreId,repositoryId,runId") fail("TRACE_IDENTITY_MISMATCH");
  for (const value of Object.values(key)) opaque(value);
  return traceCanonicalJson(key);
}
function relativePath(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 1024 || /[\\\x00-\x1f:?#]/u.test(value) || value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..") || secretLike(value)) fail("TRACE_INVALID_REFERENCE");
}
function metadata(value: TraceMetadata | undefined): void {
  if (!value) return;
  if (Array.isArray(value) || typeof value !== "object") fail("TRACE_INVALID_REFERENCE");
  for (const [key, item] of Object.entries(value)) {
    if (!metadataFields.has(key)) fail("TRACE_INVALID_REFERENCE");
    if (item === undefined) continue;
    if (key === "reason" || key === "replacementSummary") {
      if (typeof item !== "string" || Buffer.byteLength(item) > 2048 || secretLike(item) || traceSummary(item) !== item || /[\x00-\x1f\x7f]/u.test(item)) fail("TRACE_INVALID_REFERENCE");
      continue;
    }
    if (key === "path") { relativePath(item); continue; }
    if (key === "paths") { if (!Array.isArray(item) || item.length > 128) fail("TRACE_LIMIT_EXCEEDED"); item.forEach(relativePath); continue; }
    if (Array.isArray(item)) { if (item.length > 128) fail("TRACE_LIMIT_EXCEEDED"); item.forEach(opaque); }
    else if (typeof item === "string") opaque(item);
    else if (typeof item !== "boolean" && !(typeof item === "number" && Number.isFinite(item))) fail("TRACE_INVALID_REFERENCE");
  }
}
function cut(value: TraceCut): void {
  fields(value, ["version", "journalRef", "stateRef"]);
  if (!value || !Number.isSafeInteger(value.version) || value.version < 1) fail("TRACE_INVALID_REFERENCE");
  if (!/^sha256:[a-f0-9]{64}$/u.test(value.journalRef) || !/^sha256:[a-f0-9]{64}$/u.test(value.stateRef)) fail("TRACE_INVALID_REFERENCE");
}
function sameCut(a: TraceCut | undefined, b: TraceCut | undefined): boolean { return traceCanonicalJson(a) === traceCanonicalJson(b); }
function parse<T>(value: unknown): T { return JSON.parse(String(value)) as T; }
async function checkpoint(tx: Pick<DbAdapter, "query"> | DbTransaction, generationId: string, runKey: string): Promise<TraceCut | undefined> {
  const row = (await tx.query("SELECT version,journal_ref,state_ref FROM trace_projection_checkpoints WHERE generation_id=$1 AND run_key=$2", [generationId, runKey])).rows[0];
  return row ? { version: Number(row.version), journalRef: String(row.journal_ref), stateRef: String(row.state_ref) } : undefined;
}
export async function createTraceGeneration(db: DbAdapter, input: { generationId: string; extractorVersion: string }): Promise<void> {
  opaque(input.generationId); opaque(input.extractorVersion);
  const tx = await db.begin();
  try {
    const row = (await tx.query("SELECT extractor_version FROM trace_projection_generations WHERE id=$1", [input.generationId])).rows[0];
    if (row && row.extractor_version !== input.extractorVersion) fail("TRACE_SOURCE_CONFLICT");
    if (!row) await tx.query("INSERT INTO trace_projection_generations (id,extractor_version,status,created_at) VALUES ($1,$2,'building',$3)", [input.generationId, input.extractorVersion, new Date().toISOString()]);
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
}
export async function activateTraceGeneration(db: DbAdapter, input: { generationId: string; cuts: { runKey: TraceRunKey; cut: TraceCut }[] }): Promise<void> {
  opaque(input.generationId);
  if (!Array.isArray(input.cuts) || !input.cuts.length || input.cuts.length > 1024) fail("TRACE_INVALID_REFERENCE");
  const tx = await db.begin();
  try {
    const generation = (await tx.query("SELECT id FROM trace_projection_generations WHERE id=$1", [input.generationId])).rows[0];
    if (!generation) fail("TRACE_SOURCE_UNAVAILABLE");
    const keys = new Set<string>();
    for (const item of input.cuts) {
      fields(item, ["runKey", "cut"]); cut(item.cut); const key = traceRunKeyString(item.runKey);
      if (keys.has(key)) fail("TRACE_IDENTITY_MISMATCH"); keys.add(key);
      if (!sameCut(await checkpoint(tx, input.generationId, key), item.cut)) fail("TRACE_VERSION_CONFLICT");
    }
    const all = await tx.query("SELECT run_key FROM trace_projection_checkpoints WHERE generation_id=$1", [input.generationId]);
    if (all.rows.length !== keys.size || all.rows.some((r) => !keys.has(String(r.run_key)))) fail("TRACE_VERSION_CONFLICT");
    const issues = await tx.query("SELECT id FROM trace_projection_issues WHERE generation_id=$1 LIMIT 1", [input.generationId]);
    if (issues.rows.length) fail("TRACE_SOURCE_CONFLICT");
    await tx.query("UPDATE trace_projection_generations SET status='retired' WHERE status='active' AND id<>$1", [input.generationId]);
    await tx.query("UPDATE trace_projection_generations SET status='active',cut_json=$2 WHERE id=$1", [input.generationId, traceCanonicalJson(input.cuts)]);
    await tx.query("INSERT INTO delta_meta (key,value,updated_at) VALUES ('trace.activeGenerationId',$1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at", [input.generationId, new Date().toISOString()]);
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
}
export async function projectTraceBatch(db: DbAdapter, input: TraceProjectionBatch): Promise<{ inserted: number; replayed: number; checkpoint: TraceCut }> {
  opaque(input.generationId); const key = traceRunKeyString(input.runKey); cut(input.cut); if (input.previous) cut(input.previous);
  if (!Array.isArray(input.facts) || !input.facts.length || input.facts.length > 256 || Buffer.byteLength(traceCanonicalJson(input)) > 1024 * 1024) fail("TRACE_LIMIT_EXCEEDED");
  if (input.faultBeforeCommit && process.env.FORGE_FABRIC_TEST_MODE !== "1") fail("TRACE_UNSUPPORTED");
  for (const fact of input.facts) {
    fields(fact,["journalVersion","journalRef","stateRef","factKind","factIdentity","sourceDigest","entities","relations"]);
    cut({ version: fact.journalVersion, journalRef: fact.journalRef, stateRef: fact.stateRef }); opaque(fact.factKind); opaque(fact.factIdentity);
    if (!/^(?:sha256:)?[a-f0-9]{64}$/u.test(fact.sourceDigest)) fail("TRACE_INVALID_REFERENCE");
    if ((fact.entities?.length ?? 0) > 256 || (fact.relations?.length ?? 0) > 256) fail("TRACE_LIMIT_EXCEEDED");
    for (const entity of fact.entities ?? []) { fields(entity,["id","kind","data"]); opaque(entity.id); opaque(entity.kind); metadata(entity.data); }
    for (const relation of fact.relations ?? []) {
      fields(relation,["from","to","predicate","qualifier","provenance","data"]);
      fields(relation.provenance,["capture","claimKind","authority"]);
      opaque(relation.from); opaque(relation.to); opaque(relation.predicate); if (relation.qualifier) opaque(relation.qualifier);
      opaque(relation.provenance.capture); opaque(relation.provenance.authority);
      if (!["observed", "declared", "inferred"].includes(relation.provenance.claimKind)) fail("TRACE_INVALID_REFERENCE");
      metadata(relation.data);
    }
  }
  const tx = await db.begin();
  try {
    const generation = (await tx.query("SELECT status FROM trace_projection_generations WHERE id=$1", [input.generationId])).rows[0];
    if (!generation || generation.status === "retired") fail("TRACE_UNSUPPORTED");
    const current = await checkpoint(tx, input.generationId, key);
    const replay = !!current && input.cut.version <= current.version;
    if (!replay && !sameCut(current, input.previous)) fail("TRACE_VERSION_CONFLICT");
    if (replay && input.cut.version === current!.version && !sameCut(current, input.cut)) fail("TRACE_SOURCE_CONFLICT");
    const versions = new Map<number, TraceCut>();
    for (const fact of input.facts) {
      if (fact.journalVersion > input.cut.version || (!replay && fact.journalVersion <= (current?.version ?? 0))) fail("TRACE_VERSION_CONFLICT");
      const v = { version: fact.journalVersion, journalRef: fact.journalRef, stateRef: fact.stateRef };
      if (versions.has(v.version) && !sameCut(versions.get(v.version), v)) fail("TRACE_SOURCE_CONFLICT");
      versions.set(v.version, v);
    }
    if (!sameCut(versions.get(input.cut.version), input.cut)) fail("TRACE_SOURCE_CONFLICT");
    if (!replay) for (let version = (current?.version ?? 0) + 1; version <= input.cut.version; version++) if (!versions.has(version)) fail("TRACE_VERSION_CONFLICT");
    let inserted = 0; let replayed = 0;
    for (const fact of [...input.facts].sort((a,b)=>a.journalVersion-b.journalVersion || compareText(a.factKind,b.factKind) || compareText(a.factIdentity,b.factIdentity))) {
      const sourceKey = traceProjectionDigest([key, fact.journalVersion, fact.factKind, fact.factIdentity]);
      const normalized = traceCanonicalJson(fact);
      const existing = (await tx.query("SELECT source_digest,fact_json FROM trace_projection_sources WHERE generation_id=$1 AND source_key=$2", [input.generationId, sourceKey])).rows[0];
      if (existing) {
        if (existing.source_digest !== fact.sourceDigest || existing.fact_json !== normalized) fail("TRACE_SOURCE_CONFLICT");
        replayed++; continue;
      }
      if (replay) fail("TRACE_SOURCE_CONFLICT");
      await tx.query("INSERT INTO trace_projection_sources (generation_id,source_key,run_key,journal_version,journal_ref,state_ref,fact_kind,fact_identity,source_digest,fact_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [input.generationId, sourceKey, key, fact.journalVersion, fact.journalRef, fact.stateRef, fact.factKind, fact.factIdentity, fact.sourceDigest, normalized]);
      for (const entity of fact.entities ?? []) await tx.query("INSERT INTO trace_projection_entities (generation_id,run_key,entity_id,kind,data_json,journal_version,source_key) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (generation_id,run_key,entity_id) DO UPDATE SET kind=EXCLUDED.kind,data_json=EXCLUDED.data_json,journal_version=EXCLUDED.journal_version,source_key=EXCLUDED.source_key", [input.generationId,key,entity.id,entity.kind,traceCanonicalJson(entity.data ?? {}),fact.journalVersion,sourceKey]);
      for (const relation of fact.relations ?? []) {
        const semanticKey = traceProjectionDigest([key,relation.from,relation.to,relation.predicate,relation.qualifier ?? ""]);
        await tx.query("INSERT INTO trace_projection_relations (generation_id,run_key,semantic_key,source_key,relation_json) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [input.generationId,key,semanticKey,sourceKey,traceCanonicalJson(relation)]);
      }
      inserted++;
    }
    if (!replay) await tx.query("INSERT INTO trace_projection_checkpoints (generation_id,run_key,version,journal_ref,state_ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (generation_id,run_key) DO UPDATE SET version=EXCLUDED.version,journal_ref=EXCLUDED.journal_ref,state_ref=EXCLUDED.state_ref", [input.generationId,key,input.cut.version,input.cut.journalRef,input.cut.stateRef]);
    if (input.faultBeforeCommit) fail("TRACE_FIXTURE_INTERRUPTED");
    await tx.commit(); return { inserted, replayed, checkpoint: current && replay ? current : input.cut };
  } catch (error) {
    await tx.rollback();
    if (error instanceof TraceProjectionError && ["TRACE_SOURCE_CONFLICT", "TRACE_VERSION_CONFLICT"].includes(error.code)) {
      const id = traceProjectionDigest([input.generationId,key,input.cut.version,error.code]);
      await db.query("INSERT INTO trace_projection_issues (id,generation_id,run_key,code,journal_version,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [id,input.generationId,key,error.code,input.cut.version,new Date().toISOString()]);
    }
    throw error;
  }
}
export interface TraceProjectionStatus {
  generationId: string | null; extractorVersion?: string; status: string;
  counts: Record<string, number>; cuts: { runKey: TraceRunKey; cut: TraceCut }[];
}
export async function readTraceProjectionStatus(db: DbAdapter, generationId?: string): Promise<TraceProjectionStatus> {
  if (generationId) opaque(generationId);
  const selected = generationId ?? (await db.query("SELECT value FROM delta_meta WHERE key='trace.activeGenerationId'")).rows[0]?.value as string | undefined;
  if (!selected) return { generationId: null, status: "unavailable", counts: {}, cuts: [] };
  const row = (await db.query("SELECT id,extractor_version,status,cut_json FROM trace_projection_generations WHERE id=$1", [selected])).rows[0];
  if (!row) return { generationId: selected, status: "unavailable", counts: {}, cuts: [] };
  const counts: Record<string, number> = {};
  for (const table of ["sources","entities","relations","issues"]) counts[table] = Number((await db.query(`SELECT COUNT(*)::int AS count FROM trace_projection_${table} WHERE generation_id=$1`, [selected])).rows[0]?.count ?? 0);
  counts.logicalRelations = Number((await db.query("SELECT COUNT(DISTINCT semantic_key)::int AS count FROM trace_projection_relations WHERE generation_id=$1", [selected])).rows[0]?.count ?? 0);
  const cuts = (await db.query("SELECT run_key,version,journal_ref,state_ref FROM trace_projection_checkpoints WHERE generation_id=$1 ORDER BY run_key", [selected])).rows.map((r) => ({ runKey: parse<TraceRunKey>(r.run_key), cut: {version:Number(r.version),journalRef:String(r.journal_ref),stateRef:String(r.state_ref)} }));
  return { generationId: selected, extractorVersion: String(row.extractor_version), status: String(row.status), counts, cuts };
}
/** Validate a requested target before any broker lookup or unavailable-store fallback. */
export function validateTraceExplanationTarget(filter: TraceExplanationFilter): void {
  traceRunKeyString(filter.runKey);
  if (filter.path !== undefined) relativePath(filter.path);
  if (filter.candidateId !== undefined) opaque(filter.candidateId);
}
export async function explainTraceProjection(db: DbAdapter, filter: TraceExplanationFilter) {
  validateTraceExplanationTarget(filter);
  const key = traceRunKeyString(filter.runKey);
  const status = await readTraceProjectionStatus(db, filter.generationId);
  if (!status.generationId || status.status === "unavailable") return {schema:"forge.trace-explanation.v1",runKey:filter.runKey,projection:status,gaps:["projection-unavailable"]};
  const head = await checkpoint(db,status.generationId,key);
  if (!head) return {schema:"forge.trace-explanation.v1",runKey:filter.runKey,projection:{generationId:status.generationId,status:"unavailable"},gaps:["run-not-projected"]};
  const version = filter.atVersion ?? head.version;
  if (!Number.isSafeInteger(version) || version < 1 || version > head.version) fail("TRACE_VERSION_CONFLICT");
  const limit = Math.max(1,Math.min(filter.limit ?? 256,256)); const offset = filter.offset ?? 0;
  if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset) || offset < 0) fail("TRACE_INVALID_REFERENCE");
  const sourceCut = (await db.query("SELECT journal_ref,state_ref FROM trace_projection_sources WHERE generation_id=$1 AND run_key=$2 AND journal_version=$3 LIMIT 1", [status.generationId,key,version])).rows[0];
  if (!sourceCut) fail("TRACE_SOURCE_UNAVAILABLE");
  const rows = (await db.query("SELECT source_key,source_digest,fact_json FROM trace_projection_sources WHERE generation_id=$1 AND run_key=$2 AND journal_version<=$3 ORDER BY journal_version,fact_kind,fact_identity LIMIT $4 OFFSET $5", [status.generationId,key,version,limit+1,offset])).rows;
  const truncated = rows.length > limit; const entities = new Map<string,TraceEntityInput>();
  const entitySources = new Map<string, string>();
  const relations = new Map<string,{relation:TraceRelationInput;evidence:{sourceKey:string;provenance:TraceRelationInput["provenance"];data?:TraceMetadata}[]}>();
  const sources: {sourceKey:string;digest:string;version:number;journalRef:string;stateRef:string;factKind:string;factIdentity:string}[] = [];
  let size = 0; let processed = 0;
  for (const row of rows.slice(0,limit)) {
    const factBytes = Buffer.byteLength(String(row.fact_json));
    if (factBytes > 384*1024) fail("TRACE_LIMIT_EXCEEDED");
    size += factBytes; if (size > 384*1024) break;
    const fact = parse<TraceProjectionFact>(row.fact_json); processed++;
    sources.push({sourceKey:String(row.source_key),digest:String(row.source_digest),version:fact.journalVersion,journalRef:fact.journalRef,stateRef:fact.stateRef,factKind:fact.factKind,factIdentity:fact.factIdentity});
    for (const entity of fact.entities ?? []) { entities.set(entity.id,entity); entitySources.set(entity.id,String(row.source_key)); }
    for (const relation of fact.relations ?? []) {
      const semantic = traceProjectionDigest([relation.from,relation.to,relation.predicate,relation.qualifier??""]);
      const existing = relations.get(semantic);
      const occurrence = {sourceKey:String(row.source_key),provenance:relation.provenance,...(relation.data?{data:relation.data}:{})};
      if (existing) { if (!existing.evidence.some((item)=>item.sourceKey===occurrence.sourceKey)) existing.evidence.push(occurrence); } else relations.set(semantic,{relation,evidence:[occurrence]});
    }
  }
  const issues = (await db.query("SELECT code,journal_version FROM trace_projection_issues WHERE generation_id=$1 AND run_key=$2 AND journal_version<=$3 ORDER BY journal_version LIMIT 256",[status.generationId,key,version])).rows.map((r)=>({code:String(r.code),version:Number(r.journal_version)}));
  const allEntities = [...entities.values()];
  const limited = truncated || processed < Math.min(rows.length,limit);
  const partial = limited || offset > 0;
  const filtered = !!(filter.candidateId || filter.path);
  const matchesPath = (entity: TraceEntityInput) => !filter.path || entity.data?.path === filter.path || (Array.isArray(entity.data?.paths) && entity.data.paths.includes(filter.path));
  const matchesGitScope = (entity: TraceEntityInput) => !filter.path || entity.data?.path === filter.path || (Array.isArray(entity.data?.paths) && entity.data.paths.some(path => filter.path === path || filter.path!.startsWith(`${path}/`)));
  const candidates = allEntities.filter(entity => entity.kind === "candidate" && (!filter.candidateId || entity.id === filter.candidateId || entity.data?.candidateId === filter.candidateId) && matchesPath(entity));
  const candidateDigests = new Set(candidates.map(entity => entity.data?.candidateDigest).filter((digest): digest is string => typeof digest === "string"));
  const selectedIds = new Set<string>();
  if (!filtered) allEntities.forEach(entity => selectedIds.add(entity.id));
  else {
    candidates.forEach(entity => selectedIds.add(entity.id));
    // A digest is the candidate identity; a shared run or baseline is never a join to siblings.
    for (const entity of allEntities) if ((entity.kind !== "candidate" && candidateDigests.has(String(entity.data?.candidateDigest)) && ((entity.kind !== "git-observation" && entity.kind !== "commit") || matchesGitScope(entity))) || (!filter.candidateId && entity.kind !== "git-observation" && entity.kind !== "commit" && matchesPath(entity) && (entity.data?.path || entity.data?.paths))) selectedIds.add(entity.id);
    const forward = new Set(["candidate-of", "based-on", "includes-delta", "produced-by", "assessed-by", "includes-check", "performed-by", "gated-by", "applied-as", "application-attempt", "part-of", "attempt-of", "performs", "requested-by", "recorded-as"]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const { relation: edge } of relations.values()) {
        const add = (id: string) => { if (entities.has(id) && !selectedIds.has(id)) { selectedIds.add(id); expanded = true; } };
        if (selectedIds.has(edge.from) && forward.has(edge.predicate)) {
          const target = entities.get(edge.to);
          // A file query never pulls in a sibling delta from the same candidate.
          if (target?.kind !== "delta" || matchesPath(target)) add(edge.to);
        }
        if (edge.predicate === "records" && selectedIds.has(edge.to)) add(edge.from);
        if (edge.predicate === "supersedes") {
          if (selectedIds.has(edge.to)) add(edge.from);
          if (selectedIds.has(edge.from)) add(edge.to);
        }
      }
    }
  }
  const selected = allEntities.filter(entity => selectedIds.has(entity.id));
  // Unfiltered pages retain occurrences whose endpoint was declared on an earlier page.
  // Their union is the run graph; target pages instead promise a closed local subgraph.
  const selectedRelations = [...relations.values()].filter(({relation}) => !filtered || (selectedIds.has(relation.from) && selectedIds.has(relation.to)));
  const sourceKeys = new Set(selected.map(entity => entitySources.get(entity.id)));
  selectedRelations.forEach(item => item.evidence.forEach(occurrence => sourceKeys.add(occurrence.sourceKey)));
  const selectedSources = filtered ? sources.filter(source => sourceKeys.has(source.sourceKey)) : sources;
  const corrections = selected.filter(entity => entity.kind === "correction");
  const superseded = new Map<string, string[]>();
  for (const correction of corrections) {
    if (typeof correction.data?.supersedesRef !== "string" || typeof correction.data.annotationRef !== "string") continue;
    const prior = superseded.get(correction.data.supersedesRef) ?? []; prior.push(correction.data.annotationRef); superseded.set(correction.data.supersedesRef, prior);
  }
  // Enrichment describes append-only evidence. It never changes gates, execution or claim authority.
  const selectedEntities = selected.map(entity => {
    const recordingAnnotation = entity.kind === "git-observation" || entity.kind === "commit"
      ? selectedRelations.find(({relation}) => relation.predicate === "records" && relation.to === entity.id)?.relation.from : undefined;
    const annotationRef = entity.data?.annotationRef ?? (recordingAnnotation ? entities.get(recordingAnnotation)?.data?.annotationRef : undefined);
    const refs = typeof annotationRef === "string" ? superseded.get(annotationRef) : undefined;
    return refs ? { ...entity, data: { ...entity.data, superseded: true, supersededBy: [...refs].sort() } } : entity;
  });
  const memoryBindings = selectedEntities.filter(entity => entity.data?.eventId).map(entity => ({eventId:entity.data!.eventId,eventDigest:entity.data!.eventDigest,memoryStoreId:entity.data!.memoryStoreId,sourceNamespace:entity.data!.sourceNamespace,historicalBinding:"preserved",primaryAvailability:"unverified"}));
  const run = selectedEntities.filter(entity => entity.kind === "run").at(-1);
  const origin = selectedEntities.some(entity => entity.kind === "origin") ? "declared" : "origin-unavailable";
  const gitEntities = selectedEntities.filter(entity => entity.kind === "git-observation" || entity.kind === "commit");
  const git = gitEntities.map(entity => entity.data ?? {});
  const latestGit = gitEntities.filter(entity => !entity.data?.superseded).at(-1)?.data;
  const hasSupersededGit = gitEntities.some(entity => entity.data?.superseded);
  const gitObservation = !latestGit && hasSupersededGit ? "unknown" : latestGit?.observation === "observed" && latestGit.commitOid ? "observed" : latestGit?.observation === "unknown" ? "unknown" : "not-observed";
  const targetFound = filtered && (filter.candidateId ? candidates.length > 0 : allEntities.some(entity => entity.kind !== "git-observation" && entity.kind !== "commit" && matchesPath(entity) && !!(entity.data?.path || entity.data?.paths)));
  const correctionDetailsUnavailable = corrections.some(entity => typeof entity.data?.replacementSummary !== "string" || typeof entity.data?.reason !== "string" || typeof entity.data?.replacementProducer !== "string");
  return {
    schema:"forge.trace-explanation.v1", runKey:filter.runKey,
    projection:{generationId:status.generationId,extractorVersion:status.extractorVersion,status:issues.length?"conflict":partial?"partial":"fabric-current-at-cut",graphScope:partial?"page":filtered?"target-at-cut":"run-at-cut",sourceCut:{version,journalRef:String(sourceCut.journal_ref),stateRef:String(sourceCut.state_ref)}},
    ...(filtered ? {target:{...(filter.candidateId?{candidateId:filter.candidateId}:{}),...(filter.path?{path:filter.path}:{}),match:targetFound?(partial?"found-in-page":"found-at-cut"):partial?"unknown-in-partial-result":"not-found"}} : {}),
    origin:{status:partial&&origin==="origin-unavailable"?"unknown-in-partial-result":origin,transcriptStored:false},
    execution:{observedStatus:run?.data?.observedStatus??run?.data?.status??"unknown"},
    agentMemory:{mode:"pinned-bindings",bindings:memoryBindings,availability:memoryBindings.length?"primary-source-unverified":partial?"unknown-in-partial-result":"pending"},
    git:{observation:partial?"unknown":gitObservation,contentMatch:partial?"not-evaluated":latestGit?.contentMatch??"not-evaluated",summaryScope:partial?"page":filtered?"target-at-cut":"run-at-cut",evidence:git},
    corrections:selectedEntities.filter(entity => entity.kind === "correction").map(entity => ({annotationRef:entity.data?.annotationRef,supersedesRef:entity.data?.supersedesRef,reason:entity.data?.reason,replacement:{summary:entity.data?.replacementSummary,producer:entity.data?.replacementProducer},claimKind:"declared",authority:"none",...(entity.data?.superseded?{superseded:true,supersededBy:entity.data.supersededBy}:{}),details:typeof entity.data?.replacementSummary === "string"?"available":"unavailable-in-generation"})),
    entities:selectedEntities, relations:selectedRelations, sources:selectedSources, issues,
    gaps:[...(filtered&&!targetFound?[partial?"target-not-in-page":"target-not-found"]:[]),...(gitObservation!=="observed"?[partial?"git-not-in-page":"git-not-observed"]:partial?["git-summary-incomplete-page"]:[]),...(!memoryBindings.length?[partial?"agent-memory-not-in-page":"agent-memory-pending"]:[]),...(correctionDetailsUnavailable?["correction-details-unavailable"]:[]),...(gitEntities.some(entity=>entity.data?.superseded)?["git-observation-superseded"]:[]),...(limited?["query-limit-exceeded"]:[])],
    truncated:limited, ...(limited?{nextOffset:offset+processed}:{})
  };
}
/** Querying an absent/inactive store never creates a database, owner or queue drain. */
export async function explainDeltaTrace(workspaceRoot: string, filter: TraceExplanationFilter): Promise<unknown> {
  validateTraceExplanationTarget(filter);
  const { requestExistingDeltaBroker } = await import("./broker.ts");
  try { return await requestExistingDeltaBroker(workspaceRoot,"traceExplain",[filter]); }
  catch (error) {
    if (error instanceof TraceProjectionError || (error && typeof error === "object" && "code" in error && error.code !== "TRACE_SOURCE_UNAVAILABLE")) throw error;
    return {schema:"forge.trace-explanation.v1",runKey:filter.runKey,projection:{status:"unavailable"},gaps:["projection-unavailable"]};
  }
}
