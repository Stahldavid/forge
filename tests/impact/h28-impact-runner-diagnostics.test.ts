import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  diagnosticsForImpactTestRun,
  formatImpactHuman,
  formatImpactJson,
  runImpactTestPlan,
  runTestCommand,
} from "../../src/forge/impact/index.ts";

function workspace(): string {
  const root = join(tmpdir(), `forge-h28-runner-diagnostics-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function write(root: string, file: string, content: string): void {
  const absolute = join(root, file);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

describe("H28 impact runner diagnostics", () => {
  test("targeted runner records command resolution failures", async () => {
    const root = workspace();
    const previous = process.env.FORGE_BUN;
    process.env.FORGE_BUN = join(root, "missing-bun.exe");
    try {
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
      }, { bail: false, timeoutMs: 50 });

      expect(record.failed).toEqual(["bun test tests/pass.test.ts --timeout 50"]);
      expect(record.results[0].failureKind).toBe("command-resolution-error");
      expect(record.results[0].stderr).toContain("FORGE_BUN does not point to a safe Bun executable");
      expect(formatImpactHuman({ ok: false, diagnostics: [], exitCode: 1, run: record })).toContain("command resolution failed");
    } finally {
      if (previous === undefined) {
        delete process.env.FORGE_BUN;
      } else {
        process.env.FORGE_BUN = previous;
      }
    }
  });

  test("targeted runner classifies generated drift without a generated workspace", async () => {
    const root = workspace();
    write(root, "bin/forge.mjs", "#!/usr/bin/env node\nconsole.error('FORGE_DRIFT generated artifacts are stale');\nprocess.exit(1);\n");
    const record = await runImpactTestPlan(root, {
      schemaVersion: "0.1.0",
      source: { mode: "changed", base: "HEAD" },
      changedFiles: ["src/forge/schema.ts"],
      impacted: { data: { tables: [], fields: [] }, runtime: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [] }, frontend: { components: [], pages: [] }, policies: [], packages: [], generatedArtifacts: [], deploy: [] },
      risk: { level: "low", reasons: [] },
      requiredChecks: [{ kind: "forge", command: "forge generate --check", cost: "fast", reason: "generated drift test" }],
      tests: [],
      optionalChecks: [],
      finalVerification: ["forge verify --strict"],
    }, { bail: false, timeoutMs: 120000 });

    expect(record.failed).toEqual(["forge generate --check"]);
    expect(record.results[0].failureKind).toBe("generated-drift");
    expect(diagnosticsForImpactTestRun(record)[0]?.code).toBe("FORGE_IMPACT_GENERATED_DRIFT");
    expect(diagnosticsForImpactTestRun(record)[0]?.fixHint).toContain("forge generate");
    expect(diagnosticsForImpactTestRun(record)[0]?.suggestedCommands).toContain("forge verify --changed --json");
  });

  test("forge test run surfaces command resolution diagnostics", async () => {
    const root = workspace();
    const previous = process.env.FORGE_BUN;
    process.env.FORGE_BUN = join(root, "missing-bun.exe");
    write(root, ".forge/test-plans/command-resolution/plan.json", JSON.stringify({
      schemaVersion: "0.1.0",
      source: { mode: "changed", base: "HEAD" },
      changedFiles: ["tests/pass.test.ts"],
      impacted: { data: { tables: [], fields: [] }, runtime: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [] }, frontend: { components: [], pages: [] }, policies: [], packages: [], generatedArtifacts: [], deploy: [] },
      risk: { level: "low", reasons: [] },
      requiredChecks: [],
      tests: [{ file: "tests/pass.test.ts", command: "bun test tests/pass.test.ts", reason: "changed test file", cost: "fast", confidence: "confirmed" }],
      optionalChecks: [],
      finalVerification: ["forge verify --strict"],
    }));

    try {
      const result = await runTestCommand({
        subcommand: "run",
        workspaceRoot: root,
        json: true,
        write: false,
        changed: false,
        staged: false,
        planPath: ".forge/test-plans/command-resolution/plan.json",
        maxCost: "standard",
        includeDocker: false,
        includeBrowser: false,
        bail: false,
        timeoutMs: 50,
      });

      expect(result.exitCode).toBe(1);
      expect(result.diagnostics[0]?.code).toBe("FORGE_TEST_COMMAND_RESOLUTION_FAILED");
      expect(result.diagnostics[0]?.fixHint).toContain("FORGE_BUN");
      const json = JSON.parse(formatImpactJson(result));
      expect(json.ok).toBe(false);
      expect(json.run.failed).toEqual(["bun test tests/pass.test.ts --timeout 50"]);
      expect(json.diagnostics[0]?.code).toBe("FORGE_TEST_COMMAND_RESOLUTION_FAILED");
    } finally {
      if (previous === undefined) {
        delete process.env.FORGE_BUN;
      } else {
        process.env.FORGE_BUN = previous;
      }
    }
  });
});
