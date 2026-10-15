import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { generateRegistryAuthorTypes, proposeWorkflowTemplate, validateProgramProposal } from "../../src/forge/agent-fabric/program-authoring.ts";
import { summarizeBenchmarkReport, compareBenchmarkReports, validateBenchmarkReport, type ProgramBenchmarkReport } from "../../src/forge/agent-fabric/program-benchmark.ts";
import { assertCriticalGateCoverage, assertCriticalGateResults } from "../../scripts/ci-test-policy.mjs";
import type { ProgramRegistry } from "../../src/forge/agent-fabric/program-contract.ts";

function fixture() {
  const registry: ProgramRegistry = JSON.parse(readFileSync("examples/agent-fabric-v2/registry.example.json", "utf8"));
  registry.schemas["input@v1"] = structuredClone(registry.schemas["discovery@v1"]!);
  const ref = (id: string) => ({ id, version: "v1" });
  return { registry, options: { inputSchema: ref("input"), outputSchema: ref("gate"), policy: ref("local"), acceptance: ref("migration"), implement: ref("migrate"), review: ref("review"), population: ref("files") } };
}
test("three owner-bound templates retain checks, read-only review, coverage and final gate", () => {
  const { registry, options } = fixture();
  for (const kind of ["review", "bugfix", "migration"] as const) {
    const proposal = proposeWorkflowTemplate(kind, options, registry);
    expect(proposal.diagnostics).toEqual([]);
    expect(proposal.valid).toBe(true);
    expect(proposal.summary?.requiredChecks).toEqual(["check@v1"]);
    expect(proposal.program?.steps.at(-1)?.kind).toBe("gate");
    if (kind === "review") expect(proposal.program?.steps[0]?.options.writeScope).toEqual([]);
    if (kind === "migration") {
      expect(proposal.program?.steps[0]?.options.completion).toBe("all-required");
      expect((proposal.program?.steps[0]?.options.body as { options: { entryMode: string } }).options.entryMode).toBe("assess-first");
    }
    const copy = structuredClone(proposal.program!);
    const assessment = copy.steps.find(step => step.id === "assessment")!;
    assessment.options.checks = [];
    expect(validateProgramProposal(copy, registry).valid).toBe(false);
  }
});
test("proposal reports missing owner refs and incompatible scoped bindings without dispatch", () => {
  const { registry, options } = fixture();
  expect(proposeWorkflowTemplate("migration", { ...options, population: undefined }, registry).valid).toBe(false);
  expect(proposeWorkflowTemplate("bugfix", { ...options, review: { id: "missing", version: "v1" } }, registry).valid).toBe(false);
  registry.acceptance["migration@v1"]!.requiredChecksByScope = { item: ["check@v1"], final: ["check@v1"] };
  expect(proposeWorkflowTemplate("bugfix", options, registry).valid).toBe(false);
});
test("registry author declarations preserve optionality and executor input/output schema identity", () => {
  const { registry } = fixture();
  registry.schemas["typed@v1"] = { type: "object", properties: { required: { type: "string" }, optional: { type: ["number", "null"] } }, required: ["required"], additionalProperties: false };
  const source = generateRegistryAuthorTypes(registry);
  expect(source).toContain('"required": string');
  expect(source).toContain('"optional"?: number | null');
  expect(source).toContain("OwnerExecutors");
  const file = ts.createSourceFile("registry.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  expect((file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.map(entry => entry.messageText)).toEqual([]);
});
test("benchmark distinguishes unknown consumption and independent success from owner approval", () => {
  const report: ProgramBenchmarkReport = { schemaVersion: 1, benchmarkId: "fixture", limitations: ["Not a provider benchmark"], observations: [{
    taskId: "bug-1", runtimeVersion: "fixture", model: "deterministic", toolsDigest: "tools", contextDigest: "context", contractDigest: "contract", category: "coding", budget: "fixture", timingMs: { execution: 1 }, usageStatus: "unknown", humanInterventions: 0, repeatedActivities: 0,
  }] };
  expect(summarizeBenchmarkReport(report).verifiedSuccessRate).toBeNull();
  expect(summarizeBenchmarkReport(report).comparisonEligible).toBe(false);
  report.observations[0]!.inputTokens = 0;
  expect(() => validateBenchmarkReport(report)).toThrow("Unknown consumption");
  delete report.observations[0]!.inputTokens;
  report.observations[0]!.externalEvaluation = { assessor: "independent-fixture", criteriaDigest: "criteria-before-change", independent: true, success: true, escapedDefects: 1, unnecessaryChanges: 0 };
  expect(summarizeBenchmarkReport(report).verifiedSuccessRate).toBe(0);
});
test("templates fail closed on approval/evidence gaps and carry owner-bound wait and evidence refs", () => {
  const { registry, options } = fixture();
  registry.acceptance["migration@v1"].requireHumanApproval = true;
  expect(proposeWorkflowTemplate("review", options, registry).diagnostics[0]?.message).toContain("approval schema");
  registry.schemas["approval@v1"] = { type: "object", properties: { approved: { const: true } }, required: ["approved"] };
  const approved = { ...options, approvalSchema: { id: "approval", version: "v1" } };
  const proposal = proposeWorkflowTemplate("review", approved, registry);
  expect(proposal.valid).toBe(true); expect(proposal.program?.steps.at(-2)?.kind).toBe("waitEvent"); expect(proposal.program?.steps.at(-1)?.options.authorization).toEqual({ $expr: "output", args: ["human-approval"] });
  registry.schemas["approval@v1"].properties!.approved.const = false;
  expect(proposeWorkflowTemplate("review", approved, registry).valid).toBe(false);
  registry.schemas["approval@v1"].properties!.approved.const = true;
  registry.acceptance["migration@v1"].obligations = [{ id: "visual", scope: "final", criteria: ["correct"], requiredEvidence: ["capture"] }];
  expect(proposeWorkflowTemplate("migration", approved, registry).valid).toBe(false);
  registry.executors["capture@v1"] = { ...registry.executors["check@v1"], id: "capture" };
  registry.policies["local@v1"].executors.push("capture@v1");
  expect(proposeWorkflowTemplate("migration", { ...approved, evidence: [{ id: "capture", version: "v1" }] }, registry).valid).toBe(true);
  expect(proposeWorkflowTemplate("review", { ...approved, evidence: [{ id: "capture", version: "v1" }] }, registry).valid).toBe(false);
  expect(proposeWorkflowTemplate("review", { ...approved, id: "x".repeat(41000) }, registry).valid).toBe(false);
  registry.executors["resolver@v1"] = { ...registry.executors["migrate@v1"], id: "resolver", writeScope: ["other"] };
  registry.policies["local@v1"].executors.push("resolver@v1");
  const resolve = { ...approved, evidence: [{ id: "capture", version: "v1" }], resolver: { id: "resolver", version: "v1" } };
  expect(proposeWorkflowTemplate("migration", resolve, registry).valid).toBe(false);
  registry.executors["resolver@v1"].writeScope = ["src/a.txt"];
  expect(proposeWorkflowTemplate("migration", resolve, registry).program?.steps[1].options.resolverWriteScope).toEqual(["src/a.txt"]);
});
test("paired benchmarks match identity and criteria, expose confounding and do not turn unknown totals into zero", () => {
  const entry: ProgramBenchmarkReport["observations"][number] = { taskId: "task", runtimeVersion: "left", model: "same", toolsDigest: "tools", contextDigest: "context", contractDigest: "contract", budget: "same", category: "coding", timingMs: { execution: 1 }, usageStatus: "unknown", humanInterventions: 0, repeatedActivities: 0, externalEvaluation: { assessor: "external", criteriaDigest: "criteria", independent: true, success: true, escapedDefects: 0, unnecessaryChanges: 0 } };
  const left: ProgramBenchmarkReport = { schemaVersion: 1, benchmarkId: "left", limitations: [], observations: [entry] }, right = structuredClone(left); right.benchmarkId = "right"; right.observations[0].runtimeVersion = "right";
  expect(compareBenchmarkReports(left, right).comparisonEligible).toBe(true); expect(compareBenchmarkReports(left, right).left.metrics.observedTokens).toBeNull();
  right.observations[0].model = "different"; expect(compareBenchmarkReports(left, right).comparisonEligible).toBe(false); expect(compareBenchmarkReports(left, right).differences[0].fields).toContain("model");
  right.observations[0].taskId = "another"; expect(compareBenchmarkReports(left, right).unmatchedTasks).toEqual(["another", "task"]);
  right.observations[0].usageStatus = "observed"; expect(() => validateBenchmarkReport(right)).toThrow("both token counters");
  expect(() => assertCriticalGateCoverage('test("unrelated", () => {});')).toThrow("Missing critical gate");
  const names = assertCriticalGateCoverage(readFileSync("tests/agent-fabric/program-v2.test.ts", "utf8"));
  expect(names).toHaveLength(4); expect(() => assertCriticalGateResults("0 pass")).toThrow("did not run"); expect(assertCriticalGateResults(names.map(name => `(pass) ${name}`).join("\n"))).toBe(4);
});
