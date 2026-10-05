import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AttachedTaskService } from "../../src/forge/agent-fabric/attached-task-service.ts";
import type { WorkflowState, WorkflowPacket } from "../../src/forge/agent-fabric/workflow-engine.ts";

interface Response {
  taskId: string; version: number;
  state: { workflow?: WorkflowState };
  readiness: { ready: boolean; unmet: { code: string }[] };
  workflowResult?: { complete: boolean; packets: WorkflowPacket[] };
}
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-workflow-task-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "ignore" });
  git("init", "-q"); git("config", "user.email", "fixture@example.invalid"); git("config", "user.name", "Fixture");
  writeFileSync(join(root, "answer.txt"), "alpha\n"); git("add", "answer.txt"); git("commit", "-qm", "base");
  return root;
}
const digest = (char: string) => `sha256:${char.repeat(64)}`;
const result = { status: "succeeded", outputDigest: digest("a"), evidenceRefs: ["test:observed"], evidenceKinds: ["test"] };

test("workflow task persists a partial run, reconciles interruption, and preserves independent evidence", async () => {
  const root = fixture(); let service = await AttachedTaskService.open(root); let response: Response;
  let sequence = 0;
  const mutate = async (action: string, body: Record<string, unknown>) => {
    if ((action === "workflow-result" || action === "workflow-reconcile") && (body.result as { status: string })?.status === "succeeded") {
      body = { ...body, observedSnapshotDigest: (await service.execute("attached-status", { taskId: response.taskId }) as Response & { readiness: { snapshotDigest: string } }).readiness.snapshotDigest };
    }
    response = await service.execute(action, { taskId: response.taskId, requestId: `request-${++sequence}`,
      expectedVersion: response.version, ...body }) as Response;
    return response;
  };
  try {
    response = await service.execute("attached-propose", { requestId: "create", goal: "Recover a composed change",
      criteria: [{ criterionId: "verified", description: "Task remains honest after interruption" }],
      scope: ["answer.txt"], requiredChecks: ["tests"] }) as Response;
    const nodes = [
      { nodeId: "first", kind: "activity", dependsOn: [], inputDigest: digest("1"), required: true },
      { nodeId: "second", kind: "verification", dependsOn: ["first"], inputDigest: digest("2"), required: true },
      { nodeId: "independent", kind: "activity", dependsOn: [], inputDigest: digest("3"), required: true },
    ];
    await mutate("workflow-plan", { workflow: { workflowId: "recovery", nodes } });
    await mutate("workflow-claim", { nodeId: "first", attemptId: "first-1", executorId: "agent-1", expectedRevision: 1 });
    await mutate("workflow-result", { attemptId: "first-1", result });
    await mutate("workflow-claim", { nodeId: "independent", attemptId: "independent-1", executorId: "agent-2", expectedRevision: 1 });
    await mutate("workflow-result", { attemptId: "independent-1", result });
    await mutate("workflow-claim", { nodeId: "second", attemptId: "second-1", executorId: "agent-3", expectedRevision: 1 });
    const before = (await service.execute("attached-status", { taskId: response.taskId }) as Response).state.workflow;
    await service.close(); service = await AttachedTaskService.open(root);
    response = await service.execute("attached-context", { taskId: response.taskId }) as Response;
    expect(response.state.workflow).toEqual(before);
    await mutate("workflow-recover", { reason: "Host restarted before result was recorded" });
    expect((await service.execute("attached-status", { taskId: response.taskId }) as Response).state.workflow!
      .runs.find(run => run.attemptId === "second-1")!.status).toBe("uncertain");
    await expect(mutate("workflow-claim", { nodeId: "second", attemptId: "second-2", executorId: "agent-3", expectedRevision: 1 })).rejects.toThrow();
    await mutate("workflow-reconcile", { attemptId: "second-1", result });
    expect(response.workflowResult!.complete).toBe(true);
    expect(response.readiness.ready).toBe(false);
    expect(response.readiness.unmet.some(item => item.code === "missing_review")).toBe(true);
    await mutate("workflow-replan", { expectedRevision: 1, nodes: nodes.map(node => node.nodeId === "first"
      ? { ...node, inputDigest: digest("4") } : node), reason: "Source input changed", evidenceRefs: ["source:answer"] });
    const next = await service.execute("workflow-next", { taskId: response.taskId }) as Response;
    expect(next.workflowResult!.packets.map(packet => packet.nodeId)).toEqual(["first"]);
    expect(next.state.workflow!.runs.find(run => run.attemptId === "independent-1")!.status).toBe("succeeded");
    expect(next.workflowResult!.complete).toBe(false);
    const invalidBody = { taskId: response.taskId, requestId: "invalid", expectedVersion: response.version,
      reason: "Recovery", surprise: true };
    await expect(service.execute("workflow-recover", invalidBody)).rejects.toThrow("Unknown field");
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
}, 60_000);

test("a completed persisted workflow cannot reuse evidence after its source files change", async () => {
  const root = fixture(); const service = await AttachedTaskService.open(root); let response: Response;
  let sequence = 0;
  const mutate = async (action: string, body: Record<string, unknown>) => {
    if ((action === "workflow-result" || action === "workflow-reconcile") && (body.result as { status: string })?.status === "succeeded") {
      body = { ...body, observedSnapshotDigest: (await service.execute("attached-status", { taskId: response.taskId }) as Response & { readiness: { snapshotDigest: string } }).readiness.snapshotDigest };
    }
    response = await service.execute(action, { taskId: response.taskId, requestId: `request-${++sequence}`,
      expectedVersion: response.version, ...body }) as Response;
  };
  try {
    response = await service.execute("attached-propose", { requestId: "source", goal: "Do not trust obsolete source evidence",
      criteria: [{ criterionId: "current", description: "Evidence applies to current files" }],
      scope: ["answer.txt"], requiredChecks: [] }) as Response;
    const nodes = [{ nodeId: "inspect", kind: "activity", dependsOn: [], inputDigest: digest("1"), required: true }];
    await mutate("workflow-plan", { workflow: { workflowId: "source-binding", nodes } });
    await mutate("workflow-claim", { nodeId: "inspect", attemptId: "inspect-1", executorId: "agent", expectedRevision: 1 });
    await mutate("workflow-result", { attemptId: "inspect-1", result });
    expect(response.workflowResult!.complete).toBe(true);
    writeFileSync(join(root, "answer.txt"), "beta\n");
    const next = await service.execute("workflow-next", { taskId: response.taskId }) as Response;
    expect(next.workflowResult!.complete).toBe(false);
    expect(next.readiness.unmet.some(item => item.code === "stale_workflow")).toBe(true);
    await mutate("workflow-replan", { nodes, expectedRevision: 1, reason: "Actual source changed",
      evidenceRefs: ["source:answer.txt"] });
    expect(response.workflowResult!.packets.map(packet => packet.nodeId)).toEqual(["inspect"]);
    await mutate("workflow-claim", { nodeId: "inspect", attemptId: "inspect-2", executorId: "agent", expectedRevision: 2 });
    const observed = (await service.execute("attached-status", { taskId: response.taskId }) as Response & { readiness: { snapshotDigest: string } }).readiness.snapshotDigest;
    writeFileSync(join(root, "answer.txt"), "gamma\n");
    await expect(service.execute("workflow-result", { taskId: response.taskId, requestId: "late-result",
      expectedVersion: response.version, attemptId: "inspect-2", result, observedSnapshotDigest: observed })).rejects.toThrow("actually observed");
    await mutate("workflow-recover", { reason: "Host restarted" });
    await expect(service.execute("workflow-reconcile", { taskId: response.taskId, requestId: "late-reconcile",
      expectedVersion: response.version, attemptId: "inspect-2", result, observedSnapshotDigest: observed })).rejects.toThrow("actually observed");
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
}, 60_000);
