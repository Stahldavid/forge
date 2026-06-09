import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { forgeAdd } from "../../src/forge/compiler/integration/add.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import {
  cleanupWorkspace,
  createFixturePmAdapter,
  scaffoldAddWorkspace,
} from "../integration/helpers.ts";
import { defaultGenerateOptions } from "../orchestrator/helpers.ts";

describe("runtime mock mode", () => {
  test("applies mock env vars from forge.lock when --mock is set", async () => {
    const workspace = scaffoldAddWorkspace("runtime-mock");
    try {
      const addResult = await forgeAdd("stripe", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        pmAdapter: createFixturePmAdapter(),
      });
      expect(addResult.exitCode).toBe(0);

      writeFileSync(
        join(workspace, "src", "forge", "stripe-action.ts"),
        [
          'import { action } from "forge/server";',
          "",
          "export const stripeAction = action(async () => {",
          "  return {",
          "    mockEnv:",
          '      process.env.STRIPE_SECRET_KEY?.startsWith("sk_forge_mock_") === true,',
          "  };",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );

      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);
      expect(
        existsSync(join(workspace, "src", "forge", "_generated", "mockMap.json")),
      ).toBe(true);

      const executed = await runEntry(workspace, "stripeAction", {
        json: false,
        mock: true,
      });

      expect(executed.exitCode).toBe(0);
      expect(executed.ok).toBe(true);
      expect(executed.result).toEqual({ mockEnv: true });
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
