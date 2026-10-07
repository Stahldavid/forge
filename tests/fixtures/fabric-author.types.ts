import { agent, command, executorRef, field, literal, map, object, output, programRef, subworkflow, value, type WorkflowExpression } from "../../src/forge/agent-fabric/program-dsl.ts";

/** Compile-only contracts: never executed, no workers/providers. */
export function authorTypeContracts() {
  const reader = executorRef<{ path: string }, { files: string[] }>("reader", "v2");
  const discovery = agent("discover", { executor: reader, input: { path: literal("src") } });
  const files: WorkflowExpression<string[]> = field(output(discovery), "files");
  const runner = executorRef<{ files: string[] }, { count: number }>("runner", "v2");
  const checked = command("check", { executor: runner, input: object({ files }) });
  const count: WorkflowExpression<number> = field(output(checked), "count");
  const constant = value("constant", { value: object({ count }) });
  const child = programRef<{ count: number }, { approved: boolean }>("child", "v2");
  subworkflow("child", { program: child, input: output(constant) });
  // @ts-expect-error executor input path is a string
  agent("bad-input", { executor: reader, input: { path: 123 } });
  // @ts-expect-error files must stay an array across operation connections
  command("bad-connection", { executor: runner, input: object({ files: count }) });
  // @ts-expect-error typed outputs reject nonexistent fields
  field(output(discovery), "missing");
  // @ts-expect-error typed expression cannot become a different primitive
  const wrong: WorkflowExpression<string> = count;
  // @ts-expect-error child requires count number
  subworkflow("bad-child", { program: child, input: { count: "wrong" } });
  const collection = map("collection", { items: [{ path: "src" }], key: "src", completion: "all-required", body: discovery });
  const rows: WorkflowExpression<{ files: string[] }[]> = field(output(collection), "results");
  // @ts-expect-error collection result item type is retained
  const badRows: WorkflowExpression<number[]> = rows;
  void badRows; void wrong;
}
