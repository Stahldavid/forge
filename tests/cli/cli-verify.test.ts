import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  runGenerateCommand,
  runVerifyCommand,
} from "../../src/forge/cli/commands.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";
import { buildVerifyJson } from "../../src/forge/cli/output.ts";

describe("Forge CLI verify", () => {
  // These cases share one scaffolded workspace (the fixture copy is the heavy
  // part); each test fully rewrites package.json before generating, so they stay
  // order-independent.
  let workspace: string;

  beforeAll(() => {
    workspace = scaffoldGenerateWorkspace("cli-verify");
  });

  afterAll(() => {
    cleanupWorkspace(workspace);
  });

  function writePackageJson(pkg: Record<string, unknown>): void {
    writeFileSync(join(workspace, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
  }

  test("verify runs generate-check and forge-check in scaffold workspace", async () => {
    writePackageJson({
      name: "forge-orchestrator-test",
      private: true,
      type: "module",
      dependencies: { zod: "^3.24.0" },
    });
    await runGenerateCommand(defaultGenerateOptions(workspace));
    const result = await runVerifyCommand({
      workspaceRoot: workspace,
      json: false,
      skipTests: true,
      skipTypecheck: true,
      skipEslint: true,
      strict: false,
    });
    expect(result.ok).toBe(true);
    expect(result.steps.some((step) => step.name === "generate-check")).toBe(
      true,
    );
    expect(result.steps.some((step) => step.name === "forge-check")).toBe(
      true,
    );
  });

  test("default verify is app-scoped and uses the app test script", async () => {
    writePackageJson({
      name: "forge-verify-app-default-test",
      private: true,
      type: "module",
      packageManager: "npm@10.9.0",
      scripts: {
        test: "node -e \"console.error('app test executed'); process.exit(7)\"",
      },
      dependencies: { zod: "^3.24.0" },
    });
    await runGenerateCommand(defaultGenerateOptions(workspace));
    const result = await runVerifyCommand({
      workspaceRoot: workspace,
      json: true,
      skipTests: false,
      skipTypecheck: true,
      skipEslint: true,
      strict: false,
    });

    expect(result.ok).toBe(false);
    expect(result.profile).toBe("default");
    expect(result.steps.find((step) => step.name === "tests")?.failureKind).toBe("script-failure");
    expect(result.steps.some((step) => step.name === "tests:testgraph-strict")).toBe(false);
    expect(result.steps.some((step) => step.name === "tests:framework-testgraph")).toBe(false);
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === "FORGE_VERIFY_TESTS")?.fixHint).toContain(
      "app test executed",
    );
  });

  test("verify reports package script timeouts", async () => {
    writePackageJson({
      name: "forge-verify-timeout-test",
      private: true,
      type: "module",
      packageManager: "npm@10.9.0",
      scripts: {
        typecheck: "node -e \"setTimeout(() => {}, 5000)\"",
      },
      dependencies: { zod: "^3.24.0" },
    });
    await runGenerateCommand(defaultGenerateOptions(workspace));
    const result = await runVerifyCommand({
      workspaceRoot: workspace,
      json: true,
      skipTests: true,
      skipTypecheck: false,
      skipEslint: true,
      strict: false,
      scriptTimeoutMs: 50,
    });

    expect(result.ok).toBe(false);
    expect(result.steps.find((step) => step.name === "typecheck")?.timedOut).toBe(true);
    expect(result.steps.find((step) => step.name === "typecheck")?.failureKind).toBe("timeout");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_VERIFY_SCRIPT_TIMEOUT")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_VERIFY_TYPECHECK")).toBe(false);
  });

  test("verify reports package script failure output", async () => {
    writePackageJson({
      name: "forge-verify-script-failure-test",
      private: true,
      type: "module",
      packageManager: "npm@10.9.0",
      scripts: {
        typecheck: "node -e \"console.error('typecheck exploded'); process.exit(7)\"",
      },
      dependencies: { zod: "^3.24.0" },
    });
    await runGenerateCommand(defaultGenerateOptions(workspace));
    const result = await runVerifyCommand({
      workspaceRoot: workspace,
      json: true,
      skipTests: true,
      skipTypecheck: false,
      skipEslint: true,
      strict: false,
      scriptTimeoutMs: 120000,
    });

    const typecheck = result.steps.find((step) => step.name === "typecheck");
    const diagnostic = result.diagnostics.find((item) => item.code === "FORGE_VERIFY_TYPECHECK");
    expect(result.ok).toBe(false);
    expect(typecheck?.failureKind).toBe("script-failure");
    expect(diagnostic?.message).toContain("exit code 7");
    expect(diagnostic?.fixHint).toContain("typecheck exploded");
  });

  test("verify --standard uses impact tests instead of the full test script", async () => {
    writePackageJson({
      name: "forge-verify-standard-test",
      private: true,
      type: "module",
      packageManager: "npm@10.9.0",
      scripts: {
        test: "node -e \"process.exit(99)\"",
      },
      dependencies: { zod: "^3.24.0" },
    });
    await runGenerateCommand(defaultGenerateOptions(workspace));
    const result = await runVerifyCommand({
      workspaceRoot: workspace,
      json: true,
      skipTests: false,
      skipTypecheck: true,
      skipEslint: true,
      strict: false,
      standard: true,
    });

    expect(result.ok).toBe(true);
    expect(result.profile).toBe("standard");
    expect(result.steps.some((step) => step.name === "impact-tests")).toBe(true);
    expect(result.steps.find((step) => step.name === "tests")?.skipped).toBe(true);
    const json = buildVerifyJson(result) as {
      summary?: {
        testCoverage?: {
          mode?: string;
          fullSuiteRun?: boolean;
          impactTestsRun?: boolean;
          skippedImpactTests?: boolean;
          skippedFullSuite?: boolean;
        };
      };
    };
    expect(json.summary?.testCoverage).toEqual({
      mode: "checks-only",
      fullSuiteRun: false,
      impactTestsRun: false,
      skippedImpactTests: true,
      skippedFullSuite: true,
    });
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_VERIFY_NO_TESTS_SELECTED")).toBe(true);
  });

  test("verify --strict writes actionable TestGraph failure report", async () => {
    const strictWorkspace = scaffoldGenerateWorkspace("cli-verify-strict-report");
    try {
      writeFileSync(
        join(strictWorkspace, "package.json"),
        JSON.stringify(
          {
            name: "forge-verify-strict-report-test",
            private: true,
            type: "module",
            packageManager: "npm@10.9.0",
            dependencies: { zod: "^3.24.0" },
          },
          null,
          2,
        ),
        "utf8",
      );
      mkdirSync(join(strictWorkspace, "tests"), { recursive: true });
      writeFileSync(
        join(strictWorkspace, "tests", "strict-failure.test.ts"),
        [
          'import { describe, expect, test } from "bun:test";',
          'describe("strict report", () => {',
          '  test("fails with useful output", () => {',
          '    console.error("strict chunk exploded");',
          '    expect(1).toBe(2);',
          "  });",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );

      await runGenerateCommand(defaultGenerateOptions(strictWorkspace));
      const result = await runVerifyCommand({
        workspaceRoot: strictWorkspace,
        json: true,
        skipTests: false,
        skipTypecheck: true,
        skipEslint: true,
        strict: true,
        testJobs: 1,
      });

      const reportPath = join(strictWorkspace, ".forge", "test-runs", "last.json");
      const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
        failed?: string[];
        results?: Array<{ files?: string[]; reproduceCommand?: string; stderr?: string }>;
      };
      const diagnostic = result.diagnostics.find((item) => item.code === "FORGE_VERIFY_TESTS");
      const json = buildVerifyJson(result) as {
        testGraphPlan?: {
          chunkCount?: number;
          chunksIncluded?: boolean;
          chunks?: unknown[];
        } | null;
      };

      expect(result.ok).toBe(false);
      expect(existsSync(reportPath)).toBe(true);
      expect(report.failed?.[0]).toContain("TestGraph chunk");
      expect(report.results?.[0]?.files).toContain("tests/strict-failure.test.ts");
      expect(report.results?.[0]?.reproduceCommand).toContain("tests/strict-failure.test.ts");
      expect(report.results?.[0]?.stderr).toContain("strict chunk exploded");
      expect(diagnostic?.message).toContain("tests/strict-failure.test.ts");
      expect(diagnostic?.fixHint).toContain(".forge/test-runs");
      expect(json.testGraphPlan?.chunkCount).toBeGreaterThan(0);
      expect(json.testGraphPlan?.chunksIncluded).toBe(false);
      expect(json.testGraphPlan?.chunks).toBeUndefined();
    } finally {
      cleanupWorkspace(strictWorkspace);
    }
  });

  test("verify --strict skips ForgeOS framework tests unless internal mode is explicit", async () => {
    const frameworkWorkspace = scaffoldGenerateWorkspace("cli-verify-framework-skip");
    try {
      writeFileSync(
        join(frameworkWorkspace, "package.json"),
        JSON.stringify(
          {
            name: "forgeos",
            private: true,
            type: "module",
            packageManager: "npm@10.9.0",
            dependencies: { zod: "^3.24.0" },
          },
          null,
          2,
        ),
        "utf8",
      );
      mkdirSync(join(frameworkWorkspace, "bin"), { recursive: true });
      mkdirSync(join(frameworkWorkspace, "src", "forge", "cli"), { recursive: true });
      mkdirSync(join(frameworkWorkspace, "tests"), { recursive: true });
      writeFileSync(join(frameworkWorkspace, "bin", "forge.mjs"), "", "utf8");
      writeFileSync(join(frameworkWorkspace, "src", "forge", "cli", "verify.ts"), "", "utf8");
      writeFileSync(
        join(frameworkWorkspace, "tests", "framework-internal.test.ts"),
        [
          'import { describe, expect, test } from "bun:test";',
          'describe("framework internal", () => {',
          '  test("is not part of app-level verify", () => {',
          '    console.error("framework internal test executed");',
          '    expect(1).toBe(2);',
          "  });",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );

      await runGenerateCommand(defaultGenerateOptions(frameworkWorkspace));
      const appLevel = await runVerifyCommand({
        workspaceRoot: frameworkWorkspace,
        json: true,
        skipTests: false,
        skipTypecheck: true,
        skipEslint: true,
        strict: true,
      });
      const internal = await runVerifyCommand({
        workspaceRoot: frameworkWorkspace,
        json: true,
        skipTests: false,
        skipTypecheck: true,
        skipEslint: true,
        strict: true,
        internal: true,
        testJobs: 1,
      });

      expect(appLevel.ok).toBe(true);
      expect(appLevel.steps.find((step) => step.name === "tests:framework-testgraph")?.skipped).toBe(true);
      expect(appLevel.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_VERIFY_INTERNAL_TESTS_SKIPPED")).toBe(true);
      expect(internal.ok).toBe(false);
      expect(internal.steps.some((step) => step.name === "tests:testgraph-strict")).toBe(true);
      expect(internal.diagnostics.find((diagnostic) => diagnostic.code === "FORGE_VERIFY_TESTS")?.message).toContain(
        "tests/framework-internal.test.ts",
      );
    } finally {
      cleanupWorkspace(frameworkWorkspace);
    }
  });
});
