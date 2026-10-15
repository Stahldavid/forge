/** A small explicit critical suite for Fabric-only PRs; mixed/main runs retain breadth. */
export const criticalFabricTests = [
  "tests/agent-fabric/program-runtime-competitive.test.ts",
  "tests/agent-fabric/program-adapters.test.ts",
  "tests/agent-fabric/codex-sdk-worker.test.ts",
  "tests/agent-fabric/program-authoring.test.ts",
  "tests/agent-fabric/program-author-template.test.ts",
  "tests/agent-fabric/program-public-integration.test.ts",
  "tests/agent-fabric/program-template-execution.test.ts",
];
export const criticalGateTestPattern = "literal coverage and fabricated review|assess-first approves|post-dispatch exception|invalid reviewer and check";
/** Bun exits successfully when a name filter selects zero tests; reject drift first. */
export function assertCriticalGateCoverage(source) {
  const names = [...source.matchAll(/\btest\(\s*["']([^"']+)["']/g)].map(match => match[1]);
  for (const pattern of criticalGateTestPattern.split("|")) if (!names.some(name => new RegExp(pattern).test(name))) throw new Error(`Missing critical gate test matching: ${pattern}`);
  return names.filter(name => new RegExp(criticalGateTestPattern).test(name));
}
export function assertCriticalGateResults(output) {
  const passes = output.replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter(line => line.includes("(pass)"));
  for (const pattern of criticalGateTestPattern.split("|")) if (!passes.some(line => new RegExp(pattern).test(line))) throw new Error(`Critical gate test did not run successfully: ${pattern}`);
  return passes.length;
}
export function fabricTestSelection(eventName, fabricOnly) {
  return eventName === "pull_request" && fabricOnly === "true" ? criticalFabricTests : ["tests/agent-fabric"];
}
