import { defineWorkflow, schemaRef, policyRef, acceptanceRef, programRef, map, subworkflow, item, field, output } from "forgeos/agent-fabric/workflows";

export default defineWorkflow({
  id: "inspect-files", version: 2, mode: "data", inputSchema: schemaRef("any", "v2"), outputSchema: schemaRef("any", "v2"),
  policy: policyRef("local", "v2"), acceptance: acceptanceRef("data", "v2"),
  steps: [map("files", {
    items: [{ path: "src/a.ts" }, { path: "src/b.ts" }], key: field(item(), "path"), concurrency: 1, completion: "all-required",
    body: subworkflow("inspect", { program: programRef<{ path: string }, { ok: boolean }>("inspect-item", "v2"), input: item<{ path: string }>() })
  })], result: output("files")
});
