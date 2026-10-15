import { isAbsolute, posix, win32 } from "node:path";
import { redactAgentPayload } from "../agent-memory/redaction.ts";
import { programAssert, programDigest, ProgramError, type ProgramRunV2 } from "./program-contract.ts";
import { stableStringify } from "./canonical.ts";
import { isTraceGitObservation, isTraceGitBaselineObservation, type TraceGitObservation, type TraceGitBaselineObservation } from "./trace-git.ts";

export interface TraceIdentity { repositoryId: string; checkoutId: string; fabricStoreId: string }
export interface TraceRunKey extends TraceIdentity { runId: string }
export interface TraceProvenance { capture: string; claimKind: "declared" | "observed" | "inferred"; authority: "none" }
export interface TraceExternalOrigin { issuerNamespace: string; integration: string; externalSessionId: string; turnId?: string }
export interface TraceAgentMemoryRef { memoryStoreId: string; eventId: string; eventDigest: string; sourceNamespace: string }
export interface TraceAgentMemorySlice { sourceNamespace: string; integration: string; externalSessionId: string; turnId?: string; eventType: string; summary?: string }
export interface TraceConfirmedAgentMemoryEvent { committed: true; memoryStoreId: string; eventId: string; slice: TraceAgentMemorySlice }
export interface TraceOrigin extends TraceIdentity {
  schema: "forge.trace-origin.v1"; runId: string; origin: TraceExternalOrigin; agentMemoryRefs: TraceAgentMemoryRef[];
  confirmedSlices?: { event: TraceAgentMemoryRef; slice: TraceAgentMemorySlice }[];
  gitBaseline?: TraceGitBaselineObservation;
  provenance: TraceProvenance; privacyProfile: "trace-metadata-v1"; summary?: string; summaryProducer?: string;
}
export interface TraceManifest { schema: "forge.trace-manifest.v1"; runKey: TraceRunKey; originRefs: string[]; annotationRefs: string[] }
interface TraceAnnotationBase { schema: "forge.trace-annotation.v1"; runKey: TraceRunKey; provenance: TraceProvenance; annotationId?: string }
export type TraceAnnotation = TraceAnnotationBase & (
  { type: "origin-event-bound"; originRef: string; event: TraceAgentMemoryRef; confirmedSlice: TraceAgentMemorySlice }
  | { type: "git-observation"; observation: TraceGitObservation }
  | { type: "correction"; supersedesRef: string; reason: string; replacement: { summary: string; producer: string } }
);
/** These callbacks are supplied by the trusted owner, never from request JSON. */
export interface TraceRuntimeOptions {
  identity: TraceIdentity;
  capture?: string;
  resolveAgentMemoryEvent?: (reference: TraceAgentMemoryRef) => Promise<TraceConfirmedAgentMemoryEvent | undefined>;
  resolveGitObservation?: (requested: TraceGitObservation, run: ProgramRunV2) => Promise<TraceGitObservation | undefined>;
  observeGitBaseline?: () => Promise<TraceGitBaselineObservation>;
}
export const TRACE_LIMITS = { origins: 8, annotations: 64, manifestBytes: 64 * 1024, annotationBytes: 32 * 1024, depth: 8, refs: 256, bytes: 1024 * 1024 } as const;
const secretToken = /(?:\bsk[-_][A-Za-z0-9_.-]{8,}|\bnpm_[A-Za-z0-9]{16,}|\bgh[pousr]_[A-Za-z0-9_]{16,}|\bxox[baprs]-[A-Za-z0-9-]{16,})/;
export function traceObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  programAssert(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), "Invalid trace object", "TRACE_INVALID_REFERENCE");
  const object = value as Record<string, unknown>;
  programAssert(Object.keys(object).every(key => keys.includes(key)), "Unsupported trace field", "TRACE_INVALID_REFERENCE");
  return object;
}
export function traceOpaque(value: unknown): string {
  programAssert(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value) && !secretToken.test(value), "Invalid opaque trace identity", "TRACE_INVALID_REFERENCE"); return value;
}
export function traceRef(value: unknown): string {
  programAssert(typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value), "Invalid trace digest reference", "TRACE_INVALID_REFERENCE"); return value;
}
export function traceRelativePath(value: unknown): string {
  programAssert(typeof value === "string" && value.length > 0 && value.length <= 1024 && !isAbsolute(value) && !win32.isAbsolute(value) && !value.includes("\\") && !value.includes("\0") && !value.includes(":") && !value.split("/").some(part => part === ".." || part === "." || !part) && posix.normalize(value) === value && !secretToken.test(value), "Invalid trace relative path", "TRACE_INVALID_REFERENCE"); return value;
}
/** Reuses the existing scrubber, then removes paths, credentials and token values in free summaries. */
export function traceSummary(value: unknown): string {
  programAssert(typeof value === "string" && Buffer.byteLength(value) <= 2048, "Trace summary exceeds limit", "TRACE_LIMIT_EXCEEDED");
  const summary = String(redactAgentPayload({ summary: value }).value.summary ?? "");
  return summary.replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s]+/g, "[URL REDACTED]")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s]+|\/(?:[^\s/]+\/)*[^\s]+/g, "[PATH REDACTED]")
    .replace(/\b(?:sk[-_][A-Za-z0-9_.-]{8,}|npm_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g, "[REDACTED]")
    .replace(/\b(?:password|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*\S+/gi, "[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "[REDACTED]");
}
export function normalizeTraceIdentity(value: unknown): TraceIdentity {
  const object = traceObject(value, ["repositoryId", "checkoutId", "fabricStoreId"]);
  return { repositoryId: traceOpaque(object.repositoryId), checkoutId: traceOpaque(object.checkoutId), fabricStoreId: traceOpaque(object.fabricStoreId) };
}
export function normalizeTraceRunKey(value: unknown): TraceRunKey {
  const object = traceObject(value, ["repositoryId", "checkoutId", "fabricStoreId", "runId"]);
  return { repositoryId: traceOpaque(object.repositoryId), checkoutId: traceOpaque(object.checkoutId), fabricStoreId: traceOpaque(object.fabricStoreId), runId: traceOpaque(object.runId) };
}
export function assertTraceIdentity(actual: TraceIdentity, expected: TraceIdentity): void {
  programAssert(actual.repositoryId === expected.repositoryId && actual.checkoutId === expected.checkoutId && actual.fabricStoreId === expected.fabricStoreId, "Trace store identity mismatch", "TRACE_IDENTITY_MISMATCH");
}
export function assertTraceRunKey(actual: TraceRunKey, expected: TraceRunKey): void { assertTraceIdentity(actual, expected); programAssert(actual.runId === expected.runId, "Trace run identity mismatch", "TRACE_IDENTITY_MISMATCH"); }
export function normalizeTraceProvenance(value: unknown): TraceProvenance {
  const object = traceObject(value, ["capture", "claimKind", "authority"]);
  programAssert(["declared", "observed", "inferred"].includes(String(object.claimKind)) && object.authority === "none", "Trace metadata cannot confer authority", "TRACE_INVALID_REFERENCE");
  return { capture: traceOpaque(object.capture), claimKind: object.claimKind as TraceProvenance["claimKind"], authority: "none" };
}
export function normalizeTraceExternalOrigin(value: unknown): TraceExternalOrigin {
  const object = traceObject(value, ["issuerNamespace", "integration", "externalSessionId", "turnId"]);
  return { issuerNamespace: traceOpaque(object.issuerNamespace), integration: traceOpaque(object.integration), externalSessionId: traceOpaque(object.externalSessionId), ...(object.turnId === undefined ? {} : { turnId: traceOpaque(object.turnId) }) };
}
export function normalizeTraceAgentMemoryRef(value: unknown): TraceAgentMemoryRef {
  const object = traceObject(value, ["memoryStoreId", "eventId", "eventDigest", "sourceNamespace"]);
  return { memoryStoreId: traceOpaque(object.memoryStoreId), eventId: traceOpaque(object.eventId), eventDigest: traceRef(object.eventDigest), sourceNamespace: traceOpaque(object.sourceNamespace) };
}
export function normalizeTraceAgentMemorySlice(value: unknown): TraceAgentMemorySlice {
  const object = traceObject(value, ["sourceNamespace", "integration", "externalSessionId", "turnId", "eventType", "summary"]);
  return { sourceNamespace: traceOpaque(object.sourceNamespace), integration: traceOpaque(object.integration), externalSessionId: traceOpaque(object.externalSessionId), ...(object.turnId === undefined ? {} : { turnId: traceOpaque(object.turnId) }), eventType: traceOpaque(object.eventType), ...(object.summary === undefined ? {} : { summary: traceSummary(object.summary) }) };
}
export function normalizeTraceGitBaseline(value: unknown): TraceGitBaselineObservation {
  programAssert(isTraceGitBaselineObservation(value), "Invalid Git baseline observation", "TRACE_INVALID_REFERENCE");
  return structuredClone(value);
}
export function traceAgentMemorySliceDigest(value: unknown): string { return programDigest(normalizeTraceAgentMemorySlice(value)); }
export function assertTraceSliceOrigin(slice: TraceAgentMemorySlice, origin: TraceExternalOrigin): void {
  programAssert(slice.sourceNamespace === origin.issuerNamespace && slice.integration === origin.integration && slice.externalSessionId === origin.externalSessionId && slice.turnId === origin.turnId, "Agent Memory origin mismatch", "TRACE_IDENTITY_MISMATCH");
}
export async function resolveTraceAgentMemory(reference: TraceAgentMemoryRef, origin: TraceExternalOrigin, runtime: TraceRuntimeOptions): Promise<TraceAgentMemorySlice> {
  programAssert(runtime.resolveAgentMemoryEvent, "Confirmed Agent Memory source unavailable", "TRACE_SOURCE_UNAVAILABLE");
  let event: TraceConfirmedAgentMemoryEvent | undefined;
  try { event = await runtime.resolveAgentMemoryEvent(reference); }
  catch { throw new ProgramError("TRACE_SOURCE_UNAVAILABLE", "Confirmed Agent Memory source unavailable"); }
  programAssert(event?.committed === true, "Agent Memory event is not confirmed", "TRACE_SOURCE_UNAVAILABLE");
  programAssert(event.memoryStoreId === reference.memoryStoreId && event.eventId === reference.eventId, "Agent Memory source mismatch", "TRACE_IDENTITY_MISMATCH");
  const slice = normalizeTraceAgentMemorySlice(event.slice);
  programAssert(slice.sourceNamespace === reference.sourceNamespace && traceAgentMemorySliceDigest(slice) === reference.eventDigest, "Agent Memory source digest conflict", "TRACE_SOURCE_CONFLICT");
  assertTraceSliceOrigin(slice, origin); return slice;
}
export function normalizeTraceManifest(value: unknown, expected?: TraceRunKey): TraceManifest {
  const object = traceObject(value, ["schema", "runKey", "originRefs", "annotationRefs"]);
  programAssert(object.schema === "forge.trace-manifest.v1" && Array.isArray(object.originRefs) && object.originRefs.length > 0 && object.originRefs.length <= TRACE_LIMITS.origins && Array.isArray(object.annotationRefs) && object.annotationRefs.length <= TRACE_LIMITS.annotations, "Invalid trace manifest/limit", "TRACE_LIMIT_EXCEEDED");
  const manifest: TraceManifest = { schema: "forge.trace-manifest.v1", runKey: normalizeTraceRunKey(object.runKey), originRefs: object.originRefs.map(traceRef), annotationRefs: object.annotationRefs.map(traceRef) };
  programAssert(new Set(manifest.originRefs).size === manifest.originRefs.length && new Set(manifest.annotationRefs).size === manifest.annotationRefs.length, "Duplicate trace reference", "TRACE_INVALID_REFERENCE");
  programAssert(!manifest.annotationRefs.some(ref => manifest.originRefs.includes(ref)), "Trace artifact type confusion", "TRACE_INVALID_REFERENCE");
  if (expected) assertTraceRunKey(manifest.runKey, expected); traceBytes(manifest, TRACE_LIMITS.manifestBytes); return manifest;
}
export function normalizeTraceOrigin(value: unknown, expected?: TraceRunKey): TraceOrigin {
  const object = traceObject(value, ["schema", "repositoryId", "checkoutId", "fabricStoreId", "runId", "origin", "agentMemoryRefs", "confirmedSlices", "gitBaseline", "provenance", "privacyProfile", "summary", "summaryProducer"]);
  programAssert(object.schema === "forge.trace-origin.v1" && object.privacyProfile === "trace-metadata-v1" && Array.isArray(object.agentMemoryRefs) && object.agentMemoryRefs.length <= 8, "Invalid trace origin", "TRACE_INVALID_REFERENCE");
  const runKey = normalizeTraceRunKey({ repositoryId: object.repositoryId, checkoutId: object.checkoutId, fabricStoreId: object.fabricStoreId, runId: object.runId }); if (expected) assertTraceRunKey(runKey, expected);
  const result: TraceOrigin = { schema: "forge.trace-origin.v1", ...runKey, origin: normalizeTraceExternalOrigin(object.origin), agentMemoryRefs: object.agentMemoryRefs.map(normalizeTraceAgentMemoryRef), provenance: normalizeTraceProvenance(object.provenance), privacyProfile: "trace-metadata-v1" };
  if (object.gitBaseline !== undefined) { result.gitBaseline = normalizeTraceGitBaseline(object.gitBaseline); assertTraceIdentity(result.gitBaseline, runKey); }
  if (object.summary !== undefined) { result.summary = traceSummary(object.summary); result.summaryProducer = traceOpaque(object.summaryProducer); }
  if (object.confirmedSlices !== undefined) {
    programAssert(Array.isArray(object.confirmedSlices) && object.confirmedSlices.length <= 8, "Invalid confirmed slices", "TRACE_LIMIT_EXCEEDED");
    result.confirmedSlices = object.confirmedSlices.map(raw => { const entry = traceObject(raw, ["event", "slice"]), event = normalizeTraceAgentMemoryRef(entry.event), slice = normalizeTraceAgentMemorySlice(entry.slice); assertTraceSliceOrigin(slice, result.origin); programAssert(traceAgentMemorySliceDigest(slice) === event.eventDigest && result.agentMemoryRefs.some(ref => programDigest(ref) === programDigest(event)), "Invalid confirmed event digest", "TRACE_SOURCE_CONFLICT"); return { event, slice }; });
  }
  traceBytes(result, TRACE_LIMITS.annotationBytes); return result;
}
export function normalizeTraceAnnotation(value: unknown, expected?: TraceRunKey): TraceAnnotation {
  const object = traceObject(value, ["schema", "runKey", "provenance", "annotationId", "type", "originRef", "event", "confirmedSlice", "observation", "supersedesRef", "reason", "replacement"]);
  programAssert(object.schema === "forge.trace-annotation.v1", "Unsupported trace annotation", "TRACE_UNSUPPORTED");
  const base: TraceAnnotationBase = { schema: "forge.trace-annotation.v1", runKey: normalizeTraceRunKey(object.runKey), provenance: normalizeTraceProvenance(object.provenance), ...(object.annotationId === undefined ? {} : { annotationId: traceOpaque(object.annotationId) }) }; if (expected) assertTraceRunKey(base.runKey, expected);
  let result: TraceAnnotation;
  if (object.type === "origin-event-bound") {
    traceObject(value, ["schema", "runKey", "provenance", "annotationId", "type", "originRef", "event", "confirmedSlice"]);
    const event = normalizeTraceAgentMemoryRef(object.event), slice = normalizeTraceAgentMemorySlice(object.confirmedSlice);
    programAssert(traceAgentMemorySliceDigest(slice) === event.eventDigest && slice.sourceNamespace === event.sourceNamespace, "Confirmed event digest mismatch", "TRACE_SOURCE_CONFLICT");
    result = { ...base, type: "origin-event-bound", originRef: traceRef(object.originRef), event, confirmedSlice: slice };
  } else if (object.type === "git-observation") {
    traceObject(value, ["schema", "runKey", "provenance", "annotationId", "type", "observation"]);
    programAssert(isTraceGitObservation(object.observation), "Invalid Git trace observation", "TRACE_INVALID_REFERENCE");
    assertTraceIdentity(object.observation, base.runKey);
    result = { ...base, type: "git-observation", observation: structuredClone(object.observation) };
  } else {
    programAssert(object.type === "correction", "Unsupported trace annotation type", "TRACE_UNSUPPORTED");
    traceObject(value, ["schema", "runKey", "provenance", "annotationId", "type", "supersedesRef", "reason", "replacement"]);
    const replacement = traceObject(object.replacement, ["summary", "producer"]);
    result = { ...base, type: "correction", supersedesRef: traceRef(object.supersedesRef), reason: traceSummary(object.reason), replacement: { summary: traceSummary(replacement.summary), producer: traceOpaque(replacement.producer) } };
  }
  traceBytes(result, TRACE_LIMITS.annotationBytes); return result;
}
export function traceBytes(value: unknown, limit: number): void { programAssert(Buffer.byteLength(stableStringify(value)) <= limit, "Trace metadata exceeds byte limit", "TRACE_LIMIT_EXCEEDED"); }
