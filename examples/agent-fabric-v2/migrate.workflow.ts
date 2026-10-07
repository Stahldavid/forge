import { defineWorkflow, schemaRef, policyRef, acceptanceRef, populationRef, executorRef, recipeRef, agent, map, field, item, output, population, coverageFor, repair, candidateFromBaseline, compose, acceptedCandidates, outputCandidate, acceptedCandidate, gate, coverageReceipt } from "forgeos/agent-fabric/workflows";

const recipe = {
  recipe: recipeRef("repair", "v2"),
  implement: executorRef("migrate", "v1"), review: executorRef("review", "v1"),
  checks: ["check@v1"], maxRepairRounds: 3, maxAssessmentAttempts: 6,
  maxInfrastructureAttempts: 2,
  progressPolicy: { unchangedCandidateRounds: 2, repeatedFindingsRounds: 2 },
};

// Only spreads of previously lowered finite const data are accepted by the lowerer.
export default defineWorkflow({
  id: "migrate-files", version: 1,
  inputSchema: schemaRef("input", "v1"), outputSchema: schemaRef("gate", "v1"),
  acceptance: acceptanceRef("migration", "v1"), population: populationRef("files", "v1"),
  policy: policyRef("local", "v1"),
  steps: [
    agent("discover", { executor: executorRef("discover", "v1"), input: {} }),
    map("migrate", {
      items: field(output("discover"), "items"), key: field(item(), "id"),
      coverage: coverageFor(population(), output("discover")), completion: "all-required", concurrency: 4,
      body: repair("component", {
        ...recipe, entryMode: "implement-first",
        initialCandidate: candidateFromBaseline(item()), writeScope: field(item(), "allowedPaths"),
      }),
    }),
    compose("integrate", { candidates: acceptedCandidates("migrate"), onConflict: "needs-resolution" }),
    repair("integration", {
      ...recipe, entryMode: "assess-first",
      initialCandidate: outputCandidate("integrate"), writeScope: ["src"],
    }),
    gate("final", { candidate: acceptedCandidate("integration"), coverage: coverageReceipt("migrate") }),
  ],
  result: output("final"),
});
