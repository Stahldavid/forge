import { describe, expect, test } from "bun:test";
import { claimWorkflow, completeWorkflow, createWorkflow, nextWorkflow, reconcileWorkflow, recoverWorkflow, replanWorkflow, validateWorkflowState, type WorkflowNode, type WorkflowState } from "../../src/forge/agent-fabric/workflow-engine.js";
import { createChangeReviewWorkflow } from "../../src/forge/agent-fabric/workflow-templates.js";

const node = (nodeId: string, dependsOn: string[] = [], required = true): WorkflowNode => ({ nodeId, dependsOn, required, kind: "activity", inputDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
const finish = (state: WorkflowState, nodeId: string, selectedNodeIds?: string[]) => completeWorkflow(claimWorkflow(state, { nodeId, executorId: "codex", attemptId: `${nodeId}-${state.runs.length}` }), { attemptId: `${nodeId}-${state.runs.length}`, result: { status: "succeeded", outputDigest: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", evidenceRefs: ["ref"], evidenceKinds: ["proof"], ...(selectedNodeIds ? { selectedNodeIds } : {}) } });
const replan = (state: WorkflowState, nodes: WorkflowNode[]) => replanWorkflow(state, { nodes, expectedRevision: state.revision, reason: "changed input", evidenceRefs: ["snapshot:2"] });
describe("immutable workflow DAG", () => {
  test("dependencies, packets and concurrency", () => {
    const original = createWorkflow({ workflowId: "work", nodes: [node("a"), node("b"), node("c", ["a", "b"])] });
    expect(nextWorkflow(original).packets.map(packet => packet.nodeId)).toEqual(["a", "b"]);
    let state = finish(original, "a"); state = finish(state, "b");
    expect(nextWorkflow(state).packets[0].depOutputs.map(output => output.nodeId)).toEqual(["a", "b"]);
    state = finish(state, "c"); expect(nextWorkflow(state).complete).toBe(true); expect(original.runs).toEqual([]);
  });
  test("rejects cycles, missing dependencies, duplicate ids and malformed budgets", () => {
    for (const nodes of [[node("a", ["b"]), node("b", ["a"])], [node("a", ["missing"])], [node("a"), node("a")]]) expect(() => createWorkflow({ workflowId: "x", nodes })).toThrow();
    expect(() => createWorkflow({ workflowId: "x", nodes: [node("a")], limits: { maxAttempts: 0 } })).toThrow();
  });
  test("recovery reconciles uncertain effects before retry", () => {
    let state = claimWorkflow(createWorkflow({ workflowId: "x", nodes: [node("a")] }), { nodeId: "a", attemptId: "attempt", executorId: "codex" });
    state = recoverWorkflow(state); expect(nextWorkflow(state).packets).toEqual([]);
    expect(() => completeWorkflow(state, { attemptId: "attempt", result: { status: "failed", reason: "lost" } })).toThrow();
    expect(() => replan(state, [node("a")])).toThrow();
    state = reconcileWorkflow(state, { attemptId: "attempt", result: { status: "failed", reason: "no effects" } });
    expect(nextWorkflow(state).packets).toHaveLength(1);
  });
  test("replan invalidates changed descendants, preserves independent evidence, never revives history", () => {
    let state = createWorkflow({ workflowId: "x", nodes: [node("a"), node("b", ["a"]), node("c")] });
    state = finish(finish(finish(state, "a"), "b"), "c");
    state = replan(state, [{ ...node("a"), inputDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, node("b", ["a"]), node("c")]);
    expect(state.revisions[1].invalidatedNodeIds).toEqual(["a", "b"]);
    expect(nextWorkflow(state).packets.map(packet => packet.nodeId)).toEqual(["a"]);
    state = replan(state, [node("a"), node("b", ["a"]), node("c")]);
    expect(nextWorkflow(state).complete).toBe(false); expect(nextWorkflow(state).packets.map(packet => packet.nodeId)).toEqual(["a"]);
  });
  test("replan cannot weaken required obligations", () => {
    const state = createWorkflow({ workflowId: "x", nodes: [node("a"), { ...node("b", ["a"]), outputContract: { requiredEvidenceKinds: ["proof"] } }] });
    for (const nodes of [[node("a")], [node("a"), node("b", [], false)], [node("a"), node("b", ["a"])]]) expect(() => replan(state, nodes)).toThrow();
    expect(() => replanWorkflow(state, { nodes: state.nodes, expectedRevision: 0, reason: "stale", evidenceRefs: ["ref"] })).toThrow();
  });
  test("attempt budgets persist across revisions and identifiers cannot collide", () => {
    let state = createWorkflow({ workflowId: "x", nodes: [node("__proto__")], limits: { maxAttempts: 1 } });
    state = finish(state, "__proto__"); state = replan(state, [{ ...node("__proto__"), inputDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }]);
    expect(nextWorkflow(state).packets).toEqual([]); expect(nextWorkflow(state).blockedReasons).toContain("attempt budget exhausted for __proto__");
    const invalid = structuredClone(state); invalid.runs.push(invalid.runs[0]); expect(() => validateWorkflowState(invalid)).toThrow();
  });
  test("decisions skip optional branches and joins wait for selected results", () => {
    let state = createWorkflow({ workflowId: "x", nodes: [{ ...node("choose"), kind: "decision" }, node("left", ["choose"], false), node("right", ["choose"], false), { ...node("join", ["left", "right"]), kind: "join" }] });
    state = finish(state, "choose", ["left"]); expect(state.skipped.map(item => item.nodeId)).toEqual(["right"]);
    expect(nextWorkflow(state).packets.map(packet => packet.nodeId)).toEqual(["left"]);
    state = finish(state, "left"); state = finish(state, "join"); expect(nextWorkflow(state).complete).toBe(true);
    state = replan(state, state.nodes.map(item => item.nodeId === "choose" ? { ...item, inputDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" } : item)); expect(state.skipped).toEqual([]);
  });
  test("required evidence and decision obligations validated", () => {
    let state = createWorkflow({ workflowId: "x", nodes: [{ ...node("choose"), kind: "decision" }, node("required", ["choose"])] });
    state = claimWorkflow(state, { nodeId: "choose", attemptId: "r", executorId: "codex" });
    expect(() => completeWorkflow(state, { attemptId: "r", result: { status: "succeeded", outputDigest: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", evidenceRefs: [], evidenceKinds: [], selectedNodeIds: [] } })).toThrow();
    const template = createChangeReviewWorkflow({ workflowId: "t", inputDigest: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" });
    expect(() => finish(template, "implement")).toThrow("required evidence");
  });
  test("failed prerequisites never unlock downstream and total/revision budgets enforce limits", () => {
    let state = createWorkflow({ workflowId: "x", nodes: [node("a"), node("b", ["a"])], limits: { maxTotalAttempts: 1, maxRevisions: 1 } });
    state = completeWorkflow(claimWorkflow(state, { nodeId: "a", attemptId: "r", executorId: "codex" }), { attemptId: "r", result: { status: "failed", reason: "failure" } });
    expect(nextWorkflow(state).packets).toEqual([]); expect(nextWorkflow(state).complete).toBe(false);
    expect(() => replan(state, state.nodes)).toThrow();
  });
  test("rejects unknown keys, orphan runs and invented dependency evidence", () => {
    const state = createWorkflow({ workflowId: "strict", nodes: [node("a"), node("b", ["a"])] });
    expect(() => createWorkflow({ workflowId: "strict", nodes: [{ ...node("a"), code: "eval()" } as WorkflowNode] })).toThrow();
    expect(() => validateWorkflowState({ ...state, surprise: true } as WorkflowState)).toThrow();
    const completed = finish(finish(state, "a"), "b");
    completed.runs.shift(); expect(() => validateWorkflowState(completed)).toThrow("dependency evidence");
    const orphan = structuredClone(state); orphan.runs.push({ attemptId: "invented", nodeId: "missing", executorId: "agent", revision: 1, generation: 1, status: "running" });
    expect(() => validateWorkflowState(orphan)).toThrow("orphan");
    expect(() => createWorkflow({ workflowId: "strict", nodes: [{ ...node("a"), decisionId: "missing" }] })).toThrow("decisionId");
  });
  test("late results and empty or unknown evidence are rejected", () => {
    let state = claimWorkflow(createWorkflow({ workflowId: "strict", nodes: [node("a")] }), { nodeId: "a", attemptId: "one", executorId: "agent" });
    expect(() => completeWorkflow(state, { attemptId: "one", result: { status: "succeeded", outputDigest: "a".repeat(64), evidenceRefs: [], evidenceKinds: [] } })).toThrow();
    expect(() => completeWorkflow(state, { attemptId: "one", result: { status: "failed", reason: "failed", arbitrary: "data" } as never })).toThrow();
    state = completeWorkflow(state, { attemptId: "one", result: { status: "failed", reason: "failed" } });
    state = replan(state, [{ ...node("a"), inputDigest: "b".repeat(64) }]);
    expect(() => completeWorkflow(state, { attemptId: "one", result: { status: "succeeded", outputDigest: "a".repeat(64), evidenceRefs: ["ref"], evidenceKinds: [] } })).toThrow();
  });
  test("uncertain attempts consume concurrency until reconciled", () => {
    let state = createWorkflow({ workflowId: "strict", nodes: [node("a"), node("b")], limits: { maxConcurrency: 1 } });
    state = claimWorkflow(state, { nodeId: "a", attemptId: "one", executorId: "agent" });
    state = recoverWorkflow(state); expect(nextWorkflow(state).packets).toEqual([]);
  });
  test("branch roster changes invalidate the decision instead of silently skipping new work", () => {
    let state = createWorkflow({ workflowId: "branch", nodes: [{ ...node("choose"), kind: "decision" }, node("left", ["choose"], false)] });
    state = finish(state, "choose", ["left"]); state = finish(state, "left");
    state = replan(state, [...state.nodes, node("right", ["choose"], false)]);
    expect(nextWorkflow(state).packets.map(packet => packet.nodeId)).toEqual(["choose"]);
    expect(state.skipped).toEqual([]);
  });
});
