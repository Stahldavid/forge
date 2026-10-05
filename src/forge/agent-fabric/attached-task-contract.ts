import { stableStringify } from "./canonical.ts";
import { validateWorkflowState, type WorkflowState } from "./workflow-engine.ts";

export interface AttachedSnapshot {
  digest: string;
  baseHead: string;
  currentHead: string;
  scope: string[];
  files: { path: string; digest: string | null; mode: number | null }[];
}
export interface AttachedAssignment { assignmentId: string; role: "implementer" | "reviewer"; sessionId: string; agentId: string }
export interface AttachedAttempt { attemptId: string; assignmentId: string; status: "running" | "succeeded" | "failed" | "uncertain" }
export interface AttachedReview {
  reviewToken: string; snapshotDigest: string; reviewerAttemptId: string; implementationAttemptId: string;
  verdict: "approved" | "changes_requested";
  findings: { findingId: string; description: string; resolved: boolean }[];
  provenance: "agent_reported";
}
export interface AttachedTaskState {
  schemaVersion: 1; taskId: string; version: number; goal: string;
  criteria: { criterionId: string; description: string }[];
  scope: string[]; baseHead: string; requiredChecks: string[];
  sessions: { sessionId: string; agentId: string }[];
  assignments: AttachedAssignment[]; attempts: AttachedAttempt[];
  preparedReviews: { reviewToken: string; snapshot: AttachedSnapshot; reviewerAttemptId: string; implementationAttemptId: string }[];
  review?: AttachedReview;
  verifications: { checkId: string; snapshotDigest: string; outcome: "passed" | "failed" | "inconclusive"; command: string; summary: string; provenance: "agent_reported" }[];
  coverage: { criterionId: string; snapshotDigest: string; evidence: string; provenance: "agent_reported" }[];
  workflow?: import("./workflow-task-actions.ts").WorkflowState;
  workflowSnapshots?: { nodeId: string; attemptId: string; snapshotDigest: string }[];
}
export class AttachedTaskError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "AttachedTaskError"; }
}
export function attachedFail(code: string, message: string): never { throw new AttachedTaskError(code, message); }
export function attachedObject(value: unknown, keys: string[], maxBytes = 128 * 1024): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) attachedFail("AF_ATTACHED_INPUT", "Expected a plain object");
  const body = value as Record<string, unknown>;
  stableStringify(body);
  if (Buffer.byteLength(stableStringify(body)) > maxBytes) attachedFail("AF_ATTACHED_INPUT", "Payload exceeds size limit");
  for (const key of Object.keys(body)) if (!keys.includes(key)) attachedFail("AF_ATTACHED_INPUT", `Unknown field: ${key}`);
  return body;
}
export function attachedText(value: unknown, label: string, max = 4096): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) attachedFail("AF_ATTACHED_INPUT", `Invalid ${label}`);
  return value;
}
export function attachedId(value: unknown, label: string): string {
  const text = attachedText(value, label, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(text) || ["__proto__", "constructor", "prototype"].includes(text)) attachedFail("AF_ATTACHED_INPUT", `Invalid ${label}`);
  return text;
}
export function attachedList(value: unknown, label: string, max = 128): unknown[] {
  if (!Array.isArray(value) || value.length > max) attachedFail("AF_ATTACHED_INPUT", `Invalid ${label}`);
  return value;
}
export function attachedUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) attachedFail("AF_ATTACHED_INPUT", `Duplicate ${label}`);
}
export function attachedScope(value: unknown): string[] {
  const scope = attachedList(value, "scope").map((item) => {
    const path = attachedText(item, "scope path", 512).replace(/\\/gu, "/");
    if (path !== "." && (path.startsWith("/") || path.split("/").some((part) => !part || part === ".." || part === "." || part === ".git") || path.includes(":"))) attachedFail("AF_ATTACHED_INPUT", "Scope must contain repository relative paths");
    if (path.startsWith(".forge/local")) attachedFail("AF_ATTACHED_INPUT", "Runtime store cannot be task scope");
    return path;
  });
  if (!scope.length) attachedFail("AF_ATTACHED_INPUT", "Scope cannot be empty");
  attachedUnique(scope, "scope"); return scope.sort();
}

/** Validate persisted JSON before it participates in transitions. */
export function validateAttachedTaskState(value: unknown): AttachedTaskState {
  const state = attachedObject(value, ["schemaVersion", "taskId", "version", "goal", "criteria", "scope", "baseHead", "requiredChecks", "sessions", "assignments", "attempts", "preparedReviews", "review", "verifications", "coverage", "workflow", "workflowSnapshots"], 16 * 1024 * 1024);
  if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.version) || (state.version as number) < 1) attachedFail("AF_ATTACHED_STORE", "Invalid task version");
  attachedId(state.taskId, "taskId"); attachedText(state.goal, "goal"); attachedScope(state.scope);
  if (!/^[0-9a-f]{40,64}$/u.test(attachedText(state.baseHead, "baseHead", 64))) attachedFail("AF_ATTACHED_STORE", "Invalid baseHead");
  const criteria = attachedList(state.criteria, "criteria"); if (!criteria.length) attachedFail("AF_ATTACHED_STORE", "Missing criteria");
  const criterionIds = criteria.map((item) => { const c = attachedObject(item, ["criterionId", "description"]); attachedText(c.description, "description"); return attachedId(c.criterionId, "criterionId"); }); attachedUnique(criterionIds, "criteria");
  const checks = attachedList(state.requiredChecks, "checks").map((item) => attachedId(item, "checkId")); attachedUnique(checks, "checks");
  const sessions = attachedList(state.sessions, "sessions", 2048).map((item) => { const s = attachedObject(item, ["sessionId", "agentId"]); return { sessionId: attachedId(s.sessionId, "sessionId"), agentId: attachedId(s.agentId, "agentId") }; });
  const assignments = attachedList(state.assignments, "assignments", 2048).map((item) => { const a = attachedObject(item, ["assignmentId", "role", "sessionId", "agentId"]); attachedId(a.sessionId, "sessionId"); attachedId(a.agentId, "agentId"); if (!["implementer", "reviewer"].includes(a.role as string) || !sessions.some((s) => s.sessionId === a.sessionId && s.agentId === a.agentId)) attachedFail("AF_ATTACHED_STORE", "Invalid assignment"); return attachedId(a.assignmentId, "assignmentId"); }); attachedUnique(assignments, "assignments");
  const attempts = attachedList(state.attempts, "attempts", 4096).map((item) => { const a = attachedObject(item, ["attemptId", "assignmentId", "status"]); if (!assignments.includes(attachedId(a.assignmentId, "assignmentId")) || !["running", "succeeded", "failed", "uncertain"].includes(a.status as string)) attachedFail("AF_ATTACHED_STORE", "Invalid attempt"); return attachedId(a.attemptId, "attemptId"); }); attachedUnique(attempts, "attempts");
  const digest = (value: unknown) => { if (!/^[0-9a-f]{64}$/u.test(attachedText(value, "digest", 64))) attachedFail("AF_ATTACHED_STORE", "Invalid digest"); };
  for (const item of attachedList(state.preparedReviews, "preparedReviews", 4096)) {
    const r = attachedObject(item, ["reviewToken", "snapshot", "reviewerAttemptId", "implementationAttemptId"], 4 * 1024 * 1024);
    attachedText(r.reviewToken, "reviewToken", 128);
    if (!attempts.includes(attachedId(r.reviewerAttemptId, "reviewerAttemptId")) || !attempts.includes(attachedId(r.implementationAttemptId, "implementationAttemptId"))) attachedFail("AF_ATTACHED_STORE", "Unknown review attempt");
    const s = attachedObject(r.snapshot, ["digest", "baseHead", "currentHead", "scope", "files"], 4 * 1024 * 1024);
    digest(s.digest); attachedText(s.baseHead, "baseHead", 64); attachedText(s.currentHead, "currentHead", 64); attachedScope(s.scope);
    const paths = attachedList(s.files, "snapshot files", 4000).map((item) => {
      const f = attachedObject(item, ["path", "digest", "mode"]);
      const path = attachedScope([f.path])[0]!;
      if (f.digest !== null) digest(f.digest);
      if ((f.digest === null) !== (f.mode === null) || (f.mode !== null && (!Number.isInteger(f.mode) || (f.mode as number) < 0 || (f.mode as number) > 0o111))) attachedFail("AF_ATTACHED_STORE", "Invalid snapshot file mode");
      return path;
    });
    attachedUnique(paths, "snapshot paths");
  }
  if (state.review !== undefined) { const r = attachedObject(state.review, ["reviewToken", "snapshotDigest", "reviewerAttemptId", "implementationAttemptId", "verdict", "findings", "provenance"]); digest(r.snapshotDigest); attachedText(r.reviewToken, "reviewToken", 128); if (!attempts.includes(attachedId(r.reviewerAttemptId, "reviewerAttemptId")) || !attempts.includes(attachedId(r.implementationAttemptId, "implementationAttemptId")) || !["approved", "changes_requested"].includes(r.verdict as string) || r.provenance !== "agent_reported") attachedFail("AF_ATTACHED_STORE", "Invalid review"); for (const item of attachedList(r.findings, "findings")) { const f = attachedObject(item, ["findingId", "description", "resolved"]); attachedId(f.findingId, "findingId"); attachedText(f.description, "description"); if (typeof f.resolved !== "boolean") attachedFail("AF_ATTACHED_STORE", "Invalid finding"); } }
  for (const item of attachedList(state.verifications, "verifications", 4096)) { const v = attachedObject(item, ["checkId", "snapshotDigest", "outcome", "command", "summary", "provenance"]); if (!checks.includes(attachedId(v.checkId, "checkId")) || !["passed", "failed", "inconclusive"].includes(v.outcome as string) || v.provenance !== "agent_reported") attachedFail("AF_ATTACHED_STORE", "Invalid verification"); digest(v.snapshotDigest); attachedText(v.command, "command"); attachedText(v.summary, "summary"); }
  for (const item of attachedList(state.coverage, "coverage", 4096)) { const c = attachedObject(item, ["criterionId", "snapshotDigest", "evidence", "provenance"]); if (!criterionIds.includes(attachedId(c.criterionId, "criterionId")) || c.provenance !== "agent_reported") attachedFail("AF_ATTACHED_STORE", "Invalid coverage"); digest(c.snapshotDigest); attachedText(c.evidence, "evidence"); }
  if (state.workflow !== undefined) validateWorkflowState(state.workflow as WorkflowState);
  if (state.workflowSnapshots !== undefined) for (const item of attachedList(state.workflowSnapshots, "workflowSnapshots", 4096)) { const entry = attachedObject(item, ["nodeId", "attemptId", "snapshotDigest"]); attachedId(entry.nodeId, "nodeId"); attachedId(entry.attemptId, "attemptId"); digest(entry.snapshotDigest); }
  return state as unknown as AttachedTaskState;
}
