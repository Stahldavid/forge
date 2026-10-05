import { randomUUID } from "node:crypto";
import { AttachedTaskStore } from "./attached-task-store.ts";
import { attachedDigest, attachedHead, captureAttachedSnapshot } from "./attached-snapshot.ts";
import { attachedReadiness } from "./readiness.ts";
import { stableStringify } from "./canonical.ts";
import { attachedFail, attachedObject, attachedText, attachedId, attachedList, attachedUnique, attachedScope, type AttachedTaskState } from "./attached-task-contract.ts";
import { applyWorkflowTaskAction, readWorkflowTaskAction } from "./workflow-task-actions.ts";

const mutationFields = ["taskId", "requestId", "expectedVersion"];
const fields: Record<string, string[]> = {
  "attached-propose": ["requestId", "goal", "criteria", "scope", "requiredChecks"],
  "attached-status": ["taskId"], "attached-context": ["taskId"],
  "attached-attach": [...mutationFields, "sessionId", "agentId"],
  "attached-assign": [...mutationFields, "assignmentId", "role", "sessionId", "agentId"],
  "attached-attempt": [...mutationFields, "attemptId", "assignmentId", "status"],
  "attached-prepare-review": [...mutationFields, "reviewerAttemptId", "implementationAttemptId"],
  "attached-submit-review": [...mutationFields, "reviewToken", "snapshotDigest", "reviewerAttemptId", "implementationAttemptId", "verdict", "findings"],
  "attached-record-verification": [...mutationFields, "checkId", "snapshotDigest", "outcome", "command", "summary"],
  "attached-cover": [...mutationFields, "criterionId", "snapshotDigest", "evidence"],
};
function oneOf<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) attachedFail("AF_ATTACHED_INPUT", `Invalid ${label}`);
  return value as T;
}
function digest(value: unknown): string { const text = attachedText(value, "snapshotDigest", 64); if (!/^[0-9a-f]{64}$/u.test(text)) attachedFail("AF_ATTACHED_INPUT", "Invalid snapshotDigest"); return text; }

/** Native Codex reports are attributed evidence, never execution proof. */
export class AttachedTaskService {
  private closed = false;
  private constructor(readonly root: string, private readonly store: AttachedTaskStore) {}
  static async open(root: string): Promise<AttachedTaskService> { const store = await AttachedTaskStore.open(root); await attachedHead(store.root); return new AttachedTaskService(store.root, store); }
  async close(): Promise<void> { this.closed = true; }
  private async response(state: AttachedTaskState, extra: Record<string, unknown> = {}, fullState = true): Promise<Record<string, unknown>> {
    const snapshot = await captureAttachedSnapshot(this.root, state.scope, state.baseHead);
    if (extra.resume) (extra.resume as Record<string, unknown>).next = state.workflow ? readWorkflowTaskAction(state, "workflow-next", snapshot.digest) : null;
    if (extra.workflowNext) { delete extra.workflowNext; extra.workflowResult = readWorkflowTaskAction(state, "workflow-next", snapshot.digest); }
    return { taskId: state.taskId, version: state.version, ...(fullState ? { state } : {}), readiness: attachedReadiness(state, snapshot), ...extra };
  }
  async execute(action: string, input: unknown): Promise<unknown> {
    if (this.closed) attachedFail("AF_ATTACHED_CLOSED", "Service is closed");
    const workflow = action.startsWith("workflow-");
    if (!fields[action] && !workflow) attachedFail("AF_ATTACHED_ACTION", `Unknown attached action: ${action}`);
    if (!input || typeof input !== "object") attachedFail("AF_ATTACHED_INPUT", "Expected an object");
    const body = attachedObject(input, workflow ? Object.keys(input) : fields[action]!);
    if (action === "attached-status" || action === "attached-context" || action === "workflow-next") {
      if (action === "workflow-next") attachedObject(body, ["taskId"]);
      const state = await this.store.read(attachedId(body.taskId, "taskId"));
      return this.response(state, action === "attached-context" ? { resume: { goal: state.goal, criteria: state.criteria, assignments: state.assignments, attempts: state.attempts } } : action === "workflow-next" ? { workflowNext: true } : {});
    }
    const requestId = attachedId(body.requestId, "requestId");
    const proposal = action === "attached-propose";
    const taskId = proposal ? `attached-${attachedDigest(requestId).slice(0, 32)}` : attachedId(body.taskId, "taskId");
    const expectedVersion = proposal ? undefined : body.expectedVersion;
    if (!proposal && (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1)) attachedFail("AF_ATTACHED_INPUT", "expectedVersion must be a positive integer");
    const fingerprint = attachedDigest(stableStringify({ action, body }));
    return this.store.mutate(taskId, requestId, fingerprint, expectedVersion as number | undefined, async (old) => {
      if (proposal) {
        if (old) attachedFail("AF_ATTACHED_EXISTS", "Task already exists");
        const criteria = attachedList(body.criteria, "criteria").map((item) => { const criterion = attachedObject(item, ["criterionId", "description"]); return { criterionId: attachedId(criterion.criterionId, "criterionId"), description: attachedText(criterion.description, "description") }; });
        if (!criteria.length) attachedFail("AF_ATTACHED_INPUT", "At least one acceptance criterion is required");
        attachedUnique(criteria.map((item) => item.criterionId), "criteria");
        const requiredChecks = attachedList(body.requiredChecks, "requiredChecks").map((item) => attachedId(item, "checkId")); attachedUnique(requiredChecks, "checks");
        const state: AttachedTaskState = { schemaVersion: 1, taskId, version: 1, goal: attachedText(body.goal, "goal"), criteria, scope: attachedScope(body.scope), baseHead: await attachedHead(this.root), requiredChecks, sessions: [], assignments: [], attempts: [], preparedReviews: [], verifications: [], coverage: [] };
        return { state, response: await this.response(state, {}, false) };
      }
      if (!old) attachedFail("AF_ATTACHED_NOT_FOUND", "Task does not exist");
      let state = structuredClone(old);
      let extra: Record<string, unknown> = {};
      if (workflow) { const snapshot = await captureAttachedSnapshot(this.root, state.scope, state.baseHead); const result = applyWorkflowTaskAction(state, action, body, snapshot.digest); state = result.state; if (result.result !== undefined) { const { state: _workflowState, ...schedule } = result.result as Record<string, unknown>; extra = { workflowResult: schedule }; } }
      else extra = await this.apply(state, action, body);
      state.version = old.version + 1;
      return { state, response: await this.response(state, extra, false) };
    });
  }
  private async apply(state: AttachedTaskState, action: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (action === "attached-attach") {
      const session = { sessionId: attachedId(body.sessionId, "sessionId"), agentId: attachedId(body.agentId, "agentId") };
      if (!state.sessions.some((item) => item.sessionId === session.sessionId && item.agentId === session.agentId)) state.sessions.push(session);
    } else if (action === "attached-assign") {
      const assignment = { assignmentId: attachedId(body.assignmentId, "assignmentId"), role: oneOf(body.role, ["implementer", "reviewer"] as const, "role"), sessionId: attachedId(body.sessionId, "sessionId"), agentId: attachedId(body.agentId, "agentId") };
      if (!state.sessions.some((item) => item.sessionId === assignment.sessionId && item.agentId === assignment.agentId)) attachedFail("AF_ATTACHED_SESSION", "Attach the agent session before assigning work");
      if (state.assignments.some((item) => item.assignmentId === assignment.assignmentId)) attachedFail("AF_ATTACHED_ASSIGNMENT", "assignmentId already exists");
      state.assignments.push(assignment);
    } else if (action === "attached-attempt") {
      const attemptId = attachedId(body.attemptId, "attemptId"), assignmentId = attachedId(body.assignmentId, "assignmentId");
      const status = oneOf(body.status, ["running", "succeeded", "failed", "uncertain"] as const, "status");
      if (!state.assignments.some((item) => item.assignmentId === assignmentId)) attachedFail("AF_ATTACHED_ASSIGNMENT", "Unknown assignment");
      const attempt = state.attempts.find((item) => item.attemptId === attemptId);
      if (attempt) {
        if (attempt.assignmentId !== assignmentId || attempt.status === "succeeded" || attempt.status === "failed") attachedFail("AF_ATTACHED_ATTEMPT", "Terminal attempts are immutable; create a new attempt");
        attempt.status = status;
      } else { if (status !== "running") attachedFail("AF_ATTACHED_ATTEMPT", "New attempts must start running"); state.attempts.push({ attemptId, assignmentId, status }); }
    } else if (action === "attached-prepare-review" || action === "attached-submit-review") {
      const reviewerAttemptId = attachedId(body.reviewerAttemptId, "reviewerAttemptId"), implementationAttemptId = attachedId(body.implementationAttemptId, "implementationAttemptId");
      const implementation = state.attempts.find((item) => item.attemptId === implementationAttemptId), reviewer = state.attempts.find((item) => item.attemptId === reviewerAttemptId);
      const implementerAssignment = state.assignments.find((item) => item.assignmentId === implementation?.assignmentId), reviewerAssignment = state.assignments.find((item) => item.assignmentId === reviewer?.assignmentId);
      if (!implementation || implementation.status !== "succeeded" || !reviewer || reviewer.status !== "running" || implementerAssignment?.role !== "implementer" || reviewerAssignment?.role !== "reviewer") attachedFail("AF_ATTACHED_REVIEW", "Review requires a succeeded implementation and running reviewer attempt");
      if (implementerAssignment.agentId === reviewerAssignment.agentId) attachedFail("AF_ATTACHED_SELF_REVIEW", "Reviewer must be a distinct agent");
      const snapshot = await captureAttachedSnapshot(this.root, state.scope, state.baseHead);
      if (action === "attached-prepare-review") {
        const prepared = { reviewToken: randomUUID(), snapshot, reviewerAttemptId, implementationAttemptId }; state.preparedReviews.push(prepared); return prepared;
      }
      const reviewToken = attachedText(body.reviewToken, "reviewToken", 128);
      const prepared = state.preparedReviews.find((item) => item.reviewToken === reviewToken);
      if (!prepared || prepared.reviewerAttemptId !== reviewerAttemptId || prepared.implementationAttemptId !== implementationAttemptId || prepared.snapshot.digest !== digest(body.snapshotDigest) || snapshot.digest !== body.snapshotDigest) attachedFail("AF_ATTACHED_STALE_REVIEW", "Review token or snapshot is no longer current");
      const findings = attachedList(body.findings, "findings").map((item) => { const finding = attachedObject(item, ["findingId", "description", "resolved"]); if (typeof finding.resolved !== "boolean") attachedFail("AF_ATTACHED_INPUT", "resolved must be boolean"); return { findingId: attachedId(finding.findingId, "findingId"), description: attachedText(finding.description, "description"), resolved: finding.resolved }; });
      attachedUnique(findings.map((item) => item.findingId), "findings");
      state.review = { reviewToken, snapshotDigest: snapshot.digest, reviewerAttemptId, implementationAttemptId, verdict: oneOf(body.verdict, ["approved", "changes_requested"] as const, "verdict"), findings, provenance: "agent_reported" };
      reviewer.status = "succeeded";
    } else if (action === "attached-record-verification" || action === "attached-cover") {
      const snapshot = await captureAttachedSnapshot(this.root, state.scope, state.baseHead);
      if (digest(body.snapshotDigest) !== snapshot.digest) attachedFail("AF_ATTACHED_STALE_EVIDENCE", "Evidence applies to an obsolete snapshot");
      if (action === "attached-record-verification") {
        const checkId = attachedId(body.checkId, "checkId");
        if (!state.requiredChecks.includes(checkId)) attachedFail("AF_ATTACHED_CHECK", "Unknown required check");
        state.verifications = state.verifications.filter((item) => item.checkId !== checkId || item.snapshotDigest !== snapshot.digest);
        state.verifications.push({ checkId, snapshotDigest: snapshot.digest, outcome: oneOf(body.outcome, ["passed", "failed", "inconclusive"] as const, "outcome"), command: attachedText(body.command, "command"), summary: attachedText(body.summary, "summary"), provenance: "agent_reported" });
      } else {
        const criterionId = attachedId(body.criterionId, "criterionId");
        if (!state.criteria.some((item) => item.criterionId === criterionId)) attachedFail("AF_ATTACHED_CRITERION", "Unknown criterion");
        state.coverage = state.coverage.filter((item) => item.criterionId !== criterionId || item.snapshotDigest !== snapshot.digest);
        state.coverage.push({ criterionId, snapshotDigest: snapshot.digest, evidence: attachedText(body.evidence, "evidence"), provenance: "agent_reported" });
      }
    } else attachedFail("AF_ATTACHED_ACTION", "Unsupported action");
    return {};
  }
}
