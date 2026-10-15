import { defineWorkflow, schemaRef, policyRef, acceptanceRef, executorRef, workflowInput, agent, output } from "forgeos/agent-fabric/workflows";

// Register this IR as inspect-item@v2. Owner schemas/executor remain authoritative.
const inspect = agent("inspect", {
  executor: executorRef<{ path: string }, { ok: boolean }>("inspect", "v2"),
  input: workflowInput<{ path: string }>()
});
export default defineWorkflow({
  id: "inspect-item", version: 2, mode: "data", inputSchema: schemaRef("path", "v2"), outputSchema: schemaRef("inspection", "v2"),
  policy: policyRef("local", "v2"), acceptance: acceptanceRef("data", "v2"), steps: [inspect], result: output(inspect)
});
