import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachedTaskService } from "../../src/forge/agent-fabric/attached-task-service.ts";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-attached-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true });
  git("init", "-q"); git("config", "user.name", "Forge Test"); git("config", "user.email", "test@example.invalid");
  writeFileSync(join(root, "source.txt"), "original"); git("add", "source.txt"); git("commit", "-qm", "fixture");
  return root;
}
const proposal = { requestId: "proposal", goal: "Change source", criteria: [{ criterionId: "c1", description: "Source works" }], scope: ["source.txt"], requiredChecks: ["unit"] };

describe("native attached task service", () => {
  test("durable review, verification and coverage; restart replay; changed source invalidates readiness", async () => {
    const root = fixture();
    try {
      let service = await AttachedTaskService.open(root);
      let response = await service.execute("attached-propose", proposal) as any;
      const taskId = response.taskId;
      const mutate = async (action: string, fields: Record<string, unknown>) => { response = await service.execute(action, { taskId, expectedVersion: response.version, requestId: `request-${response.version}`, ...fields }); return response; };
      await mutate("attached-attach", { sessionId: "conversation", agentId: "implementer" });
      await mutate("attached-attach", { sessionId: "conversation", agentId: "reviewer" });
      await mutate("attached-assign", { assignmentId: "implementation", role: "implementer", sessionId: "conversation", agentId: "implementer" });
      await mutate("attached-assign", { assignmentId: "review", role: "reviewer", sessionId: "conversation", agentId: "reviewer" });
      await mutate("attached-attempt", { attemptId: "implementation1", assignmentId: "implementation", status: "running" });
      writeFileSync(join(root, "source.txt"), "implemented");
      await mutate("attached-attempt", { attemptId: "implementation1", assignmentId: "implementation", status: "succeeded" });
      await mutate("attached-attempt", { attemptId: "review1", assignmentId: "review", status: "running" });
      const prepared = await mutate("attached-prepare-review", { reviewerAttemptId: "review1", implementationAttemptId: "implementation1" });
      await mutate("attached-submit-review", { reviewToken: prepared.reviewToken, snapshotDigest: prepared.snapshot.digest, reviewerAttemptId: "review1", implementationAttemptId: "implementation1", verdict: "approved", findings: [] });
      expect(response.readiness.ready).toBe(false);
      await mutate("attached-record-verification", { checkId: "unit", snapshotDigest: prepared.snapshot.digest, outcome: "passed", command: "test unit", summary: "Passed reported unit checks" });
      await mutate("attached-cover", { criterionId: "c1", snapshotDigest: prepared.snapshot.digest, evidence: "Source and unit report" });
      expect(response.readiness.ready).toBe(true);
      expect(response.readiness.provenance).toBe("agent_reported");
      await service.close(); service = await AttachedTaskService.open(root);
      expect((await service.execute("attached-status", { taskId }) as any).readiness.ready).toBe(true);
      expect((await service.execute("attached-propose", proposal) as any).version).toBe(1);
      await expect(service.execute("attached-propose", { ...proposal, goal: "different" })).rejects.toMatchObject({ code: "AF_ATTACHED_REQUEST_CONFLICT" });
      writeFileSync(join(root, "source.txt"), "changed after review");
      response = await service.execute("attached-status", { taskId });
      expect(response.readiness.ready).toBe(false);
      expect(response.readiness.unmet.some((item: any) => item.code === "stale_review")).toBe(true);
      await expect(mutate("attached-cover", { criterionId: "c1", snapshotDigest: prepared.snapshot.digest, evidence: "obsolete" })).rejects.toMatchObject({ code: "AF_ATTACHED_STALE_EVIDENCE" });
      await service.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("independent owners serialize CAS and rejected mutations are atomic", async () => {
    const root = fixture();
    try {
      const first = await AttachedTaskService.open(root), second = await AttachedTaskService.open(root);
      const response = await first.execute("attached-propose", proposal) as any;
      const taskId = response.taskId;
      const results = await Promise.allSettled([first.execute("attached-attach", { taskId, expectedVersion: 1, requestId: "first", sessionId: "s1", agentId: "a1" }), second.execute("attached-attach", { taskId, expectedVersion: 1, requestId: "second", sessionId: "s2", agentId: "a2" })]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason.code).toBe("AF_ATTACHED_VERSION_CONFLICT");
      await expect(first.execute("attached-assign", { taskId, expectedVersion: 2, requestId: "invalid", assignmentId: "a", role: "reviewer", sessionId: "missing", agentId: "missing" })).rejects.toMatchObject({ code: "AF_ATTACHED_SESSION" });
      expect((await first.execute("attached-status", { taskId }) as any).version).toBe(2);
      await first.close(); await second.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("rejects self-review despite different session IDs", async () => {
    const root = fixture();
    try {
      const service = await AttachedTaskService.open(root); let response = await service.execute("attached-propose", proposal) as any;
      const taskId = response.taskId;
      const mutate = async (action: string, fields: Record<string, unknown>) => { response = await service.execute(action, { taskId, expectedVersion: response.version, requestId: `r${response.version}`, ...fields }); };
      for (const sessionId of ["s1", "s2"]) await mutate("attached-attach", { sessionId, agentId: "same-agent" });
      await mutate("attached-assign", { assignmentId: "i", role: "implementer", sessionId: "s1", agentId: "same-agent" });
      await mutate("attached-assign", { assignmentId: "r", role: "reviewer", sessionId: "s2", agentId: "same-agent" });
      await mutate("attached-attempt", { attemptId: "i1", assignmentId: "i", status: "running" });
      await mutate("attached-attempt", { attemptId: "i1", assignmentId: "i", status: "succeeded" });
      await mutate("attached-attempt", { attemptId: "r1", assignmentId: "r", status: "running" });
      await expect(mutate("attached-prepare-review", { implementationAttemptId: "i1", reviewerAttemptId: "r1" })).rejects.toMatchObject({ code: "AF_ATTACHED_SELF_REVIEW" });
      await service.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("corrupt store fails closed and dead owner lock is reclaimed", async () => {
    const root = fixture();
    try {
      const service = await AttachedTaskService.open(root); const response = await service.execute("attached-propose", proposal) as any;
      const path = join(root, ".forge", "local", "agent-fabric", "attached-tasks", `${response.taskId}.json`);
      writeFileSync(`${path}.lock`, JSON.stringify({ pid: 2147483647, token: "dead" }));
      writeFileSync(`${path}.lock.reclaim`, JSON.stringify({ pid: 2147483647, token: "dead-reclaimer" }));
      await service.execute("attached-attach", { taskId: response.taskId, expectedVersion: 1, requestId: "recover", sessionId: "s", agentId: "a" });
      const envelope = JSON.parse(readFileSync(path, "utf8")); envelope.record.state.goal = "corrupted"; writeFileSync(path, JSON.stringify(envelope));
      await expect(service.execute("attached-status", { taskId: response.taskId })).rejects.toMatchObject({ code: "AF_ATTACHED_STORE" });
      await service.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
