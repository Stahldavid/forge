import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runVerifyCommand } from "../../src/forge/cli/verify.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";

describe("verify strict", () => {
  test("parseCli accepts --strict on verify", () => {
    const parsed = parseCli(["verify", "--strict", "--skip-tests", "--skip-typecheck", "--skip-eslint"]);
    expect(parsed.errors).toEqual([]);
    if (parsed.command?.kind === "verify") {
      expect(parsed.command.options.strict).toBe(true);
    }
  });

  test("verify --strict includes policy-check-strict step", async () => {
    const workspace = scaffoldGenerateWorkspace("verify-strict");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runVerifyCommand({
        workspaceRoot: workspace,
        json: false,
        skipTests: true,
        skipTypecheck: true,
        skipEslint: true,
        strict: true,
      });

      expect(result.steps.some((step) => step.name === "policy-check-strict")).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
