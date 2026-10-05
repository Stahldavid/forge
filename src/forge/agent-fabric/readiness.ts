import type { AttachedSnapshot, AttachedTaskState } from "./attached-task-contract.ts";
import { nextWorkflow } from "./workflow-engine.ts";
import { workflowSourceProblems } from "./workflow-task-actions.ts";

export interface AttachedReadiness { ready: boolean; snapshotDigest: string; provenance: "agent_reported"; unmet: { code: string; detail: string }[] }
/** A gate over attributed reports; this service never claims to have run their commands. */
export function attachedReadiness(state: AttachedTaskState, snapshot: AttachedSnapshot): AttachedReadiness {
  const unmet: AttachedReadiness["unmet"] = [];
  const add = (code: string, detail: string) => unmet.push({ code, detail });
  if (!state.review) add("missing_review", "A distinct reviewer must report on this snapshot");
  else {
    if (state.review.snapshotDigest !== snapshot.digest) add("stale_review", "Working tree changed after review");
    if (state.review.verdict !== "approved") add("changes_requested", "Review requests changes");
    for (const finding of state.review.findings) if (!finding.resolved) add("unresolved_finding", finding.findingId);
  }
  for (const checkId of state.requiredChecks) {
    const check = state.verifications.find((item) => item.checkId === checkId && item.snapshotDigest === snapshot.digest);
    if (!check) add("missing_verification", checkId);
    else if (check.outcome !== "passed") add(`${check.outcome}_verification`, checkId);
  }
  for (const criterion of state.criteria) if (!state.coverage.some((item) => item.criterionId === criterion.criterionId && item.snapshotDigest === snapshot.digest)) add("uncovered_criterion", criterion.criterionId);
  for (const attempt of state.attempts) if (attempt.status === "running" || attempt.status === "uncertain") add(`${attempt.status}_attempt`, attempt.attemptId);
  if (state.workflow && !nextWorkflow(state.workflow).complete) add("incomplete_workflow", "Required workflow steps remain incomplete");
  for (const problem of workflowSourceProblems(state, snapshot.digest)) add("stale_workflow", String(problem));
  return { ready: unmet.length === 0, snapshotDigest: snapshot.digest, provenance: "agent_reported", unmet };
}
