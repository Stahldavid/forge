import { defineWorkflow, schemaRef, executorRef, policyRef, acceptanceRef, populationRef, recipeRef, agent, map, repair, compose, gate, field, item, output, population, coverageFor, candidateFromBaseline, acceptedCandidates, outputCandidate, acceptedCandidate, coverageReceipt, type WorkflowOptions } from "forgeos/agent-fabric/workflows";

const repairPolicy = {
  recipe: recipeRef("repair", "v2"), implement: executorRef("implement", "v2"), review: executorRef("review", "v2"), evidence: [executorRef("capture", "v2")],
  entryMode: "assess-first", maxRepairRounds: 3, maxAssessmentAttempts: 6, maxInfrastructureAttempts: 2,
  progressPolicy: { unchangedCandidateRounds: 2, repeatedFindingsRounds: 2 }
} as const;
const itemRepair = {
  ...repairPolicy, evidence: [executorRef("capture", "v2")], assessmentScope: "item", checks: ["local-check@v2"], initialCandidate: candidateFromBaseline(item()), writeScope: field(item(), "allowedPaths")
} satisfies WorkflowOptions["repair"];

export default defineWorkflow({
  id: "ui-audit", version: 1, operatorVersion: 2, mode: "candidate", inputSchema: schemaRef("any", "v2"), outputSchema: schemaRef("any", "v2"),
  policy: policyRef("local", "v2"), acceptance: acceptanceRef("ui", "v2"), population: populationRef("pages", "v2"),
  steps: [
    agent("discover", { executor: executorRef("discover", "v2"), input: {} }),
    map("pages", {
      items: field(output("discover"), "items"), key: field(item(), "id"), coverage: coverageFor(population(), output("discover")), completion: "all-required", concurrency: 4,
      body: repair("page", itemRepair)
    }),
    compose("integrated", { candidates: acceptedCandidates("pages"), onConflict: "needs-resolution" }),
    repair("final", {
      ...repairPolicy, evidence: [executorRef("capture", "v2")], assessmentScope: "final", checks: ["global-check@v2"],
      initialCandidate: outputCandidate("integrated"), writeScope: ["src"]
    }),
    gate("ready", { candidate: acceptedCandidate("final"), coverage: coverageReceipt("pages") })
  ], result: output("ready")
});
