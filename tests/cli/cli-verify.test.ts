import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  runGenerateCommand,
  runVerifyCommand,
} from "../../src/forge/cli/commands.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

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
  });
});
