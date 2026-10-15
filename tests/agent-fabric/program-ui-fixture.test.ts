import { expect, test } from "bun:test";
import { runUiFixture } from "../../examples/agent-fabric-v2/run-ui-fixture.ts";
import authored from "../../examples/agent-fabric-v2/ui-audit.workflow.ts";
import { readFile } from "node:fs/promises";
import { lowerWorkflowSource, policyRef, agent } from "../../src/forge/agent-fabric/program-dsl.ts";
import { programDigest } from "../../src/forge/agent-fabric/program-contract.ts";

test("finite typed authoring and lowerer produce identical UI IR", async () => {
  const source = await readFile(new URL("../../examples/agent-fabric-v2/ui-audit.workflow.ts", import.meta.url), "utf8");
  expect(programDigest(lowerWorkflowSource(source))).toBe(programDigest(authored));
});
function nominalTypeProof() {
  // @ts-expect-error A policy cannot be used as an executor reference.
  return agent("bad", { executor: policyRef("local", "v2") });
}
void nominalTypeProof;

test("P2 actual local commands repair only 3/20 pages and recapture all final obligations", async () => {
  const report = await runUiFixture();
  expect(report.implementations).toBe(3); expect(report.finalObligations).toBe(21); expect(report.finalCaptures).toBe(20);
  expect(report.captures).toBe(43); expect(report.destinationPreserved).toBe(true); expect(report.llmCalls).toBe(0);
}, 240000);
