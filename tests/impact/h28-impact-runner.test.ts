import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import {
  formatImpactHuman,
  runImpactTestPlan,
  runTestCommand,
} from "../../src/forge/impact/index.ts";

function workspace(): string {
  const root = join(tmpdir(), `forge-h28-runner-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function write(root: string, file: string, content: string): void {
  const absolute = join(root, file);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

describe("H28 impact test runner", () => {
  test("targeted runner records successful test run", async () => {
    const root = workspace();
    write(root, "tests/pass.test.ts", `import { test, expect } from "bun:test"; test("pass", () => expect(1).toBe(1));`);
    const record = await runImpactTestPlan(root, {
      schemaVersion: "0.1.0",
      source: { mode: "changed", base: "HEAD" },
      changedFiles: ["tests/pass.test.ts"],
      impacted: { data: { tables: [], fields: [] }, runtime: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [] }, frontend: { components: [], pages: [] }, policies: [], packages: [], generatedArtifacts: [], deploy: [] },
      risk: { level: "low", reasons: [] },
      requiredChecks: [],
      tests: [{ file: "tests/pass.test.ts", command: "bun test tests/pass.test.ts", reason: "changed test file", cost: "fast", confidence: "confirmed" }],
      optionalChecks: [],
      finalVerification: ["forge verify --strict"],
    }, { bail: false });
    expect(record.failed).toEqual([]);
    expect(record.results[0].ok).toBe(true);
  });

  test("targeted runner times out hanging commands", async () => {
    const root = workspace();
    write(root, "scripts/hang.mjs", `setTimeout(() => {}, 5000);`);
    const record = await runImpactTestPlan(root, {
      schemaVersion: "0.1.0",
      source: { mode: "changed", base: "HEAD" },
      changedFiles: ["scripts/hang.mjs"],
      impacted: { data: { tables: [], fields: [] }, runtime: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [] }, frontend: { components: [], pages: [] }, policies: [], packages: [], generatedArtifacts: [], deploy: [] },
      risk: { level: "low", reasons: [] },
      requiredChecks: [{ kind: "script", command: "node scripts/hang.mjs", cost: "fast", reason: "timeout test" }],
      tests: [],
      optionalChecks: [],
      finalVerification: ["forge verify --strict"],
    }, { bail: false, timeoutMs: 50 });

    expect(record.failed).toEqual(["node scripts/hang.mjs"]);
    expect(record.timeoutMs).toBe(50);
    expect(record.results[0].timedOut).toBe(true);
    expect(record.results[0].failureKind).toBe("timeout");
    expect(formatImpactHuman({ ok: false, diagnostics: [], exitCode: 1, run: record })).toContain("timed out after 50ms");
  });

  test("forge test run surfaces timeout diagnostics", async () => {
    const root = workspace();
    write(root, "scripts/hang.mjs", `setTimeout(() => {}, 5000);`);
    write(root, ".forge/test-plans/timeout/plan.json", JSON.stringify({
      schemaVersion: "0.1.0",
      source: { mode: "changed", base: "HEAD" },
      changedFiles: ["scripts/hang.mjs"],
      impacted: { data: { tables: [], fields: [] }, runtime: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [] }, frontend: { components: [], pages: [] }, policies: [], packages: [], generatedArtifacts: [], deploy: [] },
      risk: { level: "low", reasons: [] },
      requiredChecks: [{ kind: "script", command: "node scripts/hang.mjs", cost: "fast", reason: "timeout test" }],
      tests: [],
      optionalChecks: [],
      finalVerification: ["forge verify --strict"],
    }));

    const result = await runTestCommand({
      subcommand: "run",
      workspaceRoot: root,
      json: true,
      write: false,
      changed: false,
      staged: false,
      planPath: ".forge/test-plans/timeout/plan.json",
      maxCost: "standard",
      includeDocker: false,
      includeBrowser: false,
      bail: false,
      timeoutMs: 50,
    });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics[0]?.code).toBe("FORGE_TEST_RUN_TIMEOUT");
  });

});
