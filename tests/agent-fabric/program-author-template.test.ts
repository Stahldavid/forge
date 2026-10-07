import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { lowerWorkflowSource } from "../../src/forge/agent-fabric/program-dsl.ts";
import { programDigest, validateWorkflowProgram, type ProgramRegistry } from "../../src/forge/agent-fabric/program-contract.ts";
import { validateVisualCapture, validateVisualPopulation } from "../../src/forge/agent-fabric/program-evidence.ts";

test("typed map/subworkflow templates share IR and owner schema preflight", async () => {
  const child = lowerWorkflowSource(await readFile(new URL("../../examples/agent-fabric-v2/item-child.workflow.ts", import.meta.url), "utf8"));
  const root = lowerWorkflowSource(await readFile(new URL("../../examples/agent-fabric-v2/map-child.workflow.ts", import.meta.url), "utf8"));
  const registry: ProgramRegistry = {
    schemas: { "any@v2": {}, "path@v2": { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false }, "inspection@v2": { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } },
    executors: { "inspect@v2": { id: "inspect", version: "v2", kind: "command", argv: ["unused"], effect: "read", isolation: "cooperative", network: "host", timeoutMs: 1000, writeScope: [], inputSchema: { id: "path", version: "v2" }, schema: { id: "inspection", version: "v2" } } },
    policies: { "local@v2": { id: "local", version: "v2", concurrency: 1, maxItems: 10, maxAttempts: 10, maxOperations: 50, maxDepth: 8, deadlineMs: 10000, maxOutputBytes: 65536, writeScope: [], executors: ["inspect@v2"], allowCooperativeCommands: true, allowNetwork: true } },
    acceptance: { "data@v2": { id: "data", version: "v2", criteria: ["inspection"], writeScope: [], requiredChecks: [], requireReview: false, allowNoWork: false } }, populations: {}, programs: { "inspect-item@v2": child },
  };
  expect(() => validateWorkflowProgram(root, registry)).not.toThrow();
  child.population = { id: "different", version: "v2" };
  expect(() => validateWorkflowProgram(root, registry)).toThrow("replace inherited population");
});

test("visual template closes catalog and rejects every mismatched dimension", async () => {
  const population = JSON.parse(await readFile(new URL("../../examples/agent-fabric-v2/visual-population.json", import.meta.url), "utf8"));
  population.baselineDigest = programDigest("owner fixture baseline");
  expect(() => validateVisualPopulation(population)).not.toThrow();
  const capture = population.visualCases[0];
  expect(() => validateVisualCapture(capture, population.visualCases)).not.toThrow();
  for (const key of ["route", "viewport", "state", "width", "height"] as const) {
    expect(() => validateVisualCapture({ ...capture, [key]: typeof capture[key] === "string" ? "wrong" : 1 }, population.visualCases)).toThrow("owner visual case");
  }
  population.visualCases[1] = { ...capture, itemKey: population.members[1] };
  expect(() => validateVisualPopulation(population)).toThrow("Duplicate visual");
});
