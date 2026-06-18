import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runVerifyCommand } from "../../src/forge/cli/commands.ts";
import {
  cleanupWorkspace,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

describe("Forge CLI verify --changed", () => {
  test("verify --changed propagates impact command resolution diagnostics", async () => {
    const workspace = tempWorkspace("cli-verify-changed-resolution");
    const previous = process.env.FORGE_BUN;
    try {
      mkdirSync(join(workspace, "bin"), { recursive: true });
      writeFileSync(join(workspace, "bin", "forge.mjs"), "#!/usr/bin/env node\nprocess.exit(0);\n", "utf8");
      mkdirSync(join(workspace, "tests"), { recursive: true });
      writeFileSync(
        join(workspace, "tests", "changed.test.ts"),
        `import { test, expect } from "bun:test"; test("changed", () => expect(1).toBe(1));`,
        "utf8",
      );
      mkdirSync(join(workspace, "src", "forge", "_generated"), { recursive: true });
      writeFileSync(
        join(workspace, "src", "forge", "_generated", "testGraph.json"),
        JSON.stringify({
          schemaVersion: "0.1.0",
          generatorVersion: "test",
          analyzerVersion: "test",
          inputHash: "test",
          diagnostics: [],
          tests: [{
            file: "tests/changed.test.ts",
            kind: "unit",
            covers: {
              commands: [],
              queries: [],
              liveQueries: [],
              actions: [],
              workflows: [],
              tables: [],
              policies: [],
              packages: [],
              components: [],
            },
            cost: "fast",
            confidence: "confirmed",
            reasons: ["changed test file"],
          }],
        }),
        "utf8",
      );
      spawnSync("git", ["init"], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["config", "user.email", "forge@example.test"], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["config", "user.name", "Forge Test"], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["add", "."], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["commit", "-m", "baseline"], { cwd: workspace, windowsHide: true });
      writeFileSync(
        join(workspace, "tests", "changed.test.ts"),
        `import { test, expect } from "bun:test"; test("changed", () => expect(2).toBe(2));`,
        "utf8",
      );

      process.env.FORGE_BUN = join(workspace, "missing-bun.exe");
      const result = await runVerifyCommand({
        workspaceRoot: workspace,
        json: true,
        skipTests: false,
        skipTypecheck: true,
        skipEslint: true,
        strict: false,
        changed: true,
        scriptTimeoutMs: 120000,
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_TEST_COMMAND_RESOLUTION_FAILED")).toBe(true);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_VERIFY_CHANGED_INCOMPLETE")).toBe(true);
      expect(result.steps.find((step) => step.command?.startsWith("bun test tests/changed.test.ts"))?.failureKind)
        .toBe("command-resolution-error");
    } finally {
      if (previous === undefined) {
        delete process.env.FORGE_BUN;
      } else {
        process.env.FORGE_BUN = previous;
      }
      cleanupWorkspace(workspace);
    }
  }, 60_000);
});
