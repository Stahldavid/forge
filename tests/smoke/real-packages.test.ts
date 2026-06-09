import { describe, expect, test } from "bun:test";
import { forgeAdd } from "../../src/forge/compiler/integration/add.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { runCheckCommand } from "../../src/forge/cli/commands.ts";
import {
  cleanupWorkspace,
  createFixturePmAdapter,
  scaffoldAddWorkspace,
} from "../integration/helpers.ts";
import { defaultGenerateOptions } from "../orchestrator/helpers.ts";

const RUN_REAL_SMOKE = process.env.FORGE_SMOKE_REAL === "1";

describe.skipIf(!RUN_REAL_SMOKE)("real package smoke (FORGE_SMOKE_REAL=1)", () => {
  test(
    "forge add + generate --check + forge check with fixture-backed installs",
    async () => {
      const workspace = scaffoldAddWorkspace("smoke-real");

      try {
        for (const alias of ["zod", "stripe", "posthog", "sentry", "ai"]) {
          const added = await forgeAdd(alias, {
            workspaceRoot: workspace,
            json: false,
            dryRun: false,
            runtimeInspect: false,
            sandboxBackend: "none",
            allowScripts: false,
            pmAdapter: createFixturePmAdapter(),
          });
          expect(added.exitCode).toBe(0);
        }

        const generated = await run(defaultGenerateOptions(workspace));
        expect(generated.exitCode).toBe(0);

        const drift = await run({
          ...defaultGenerateOptions(workspace),
          check: true,
        });
        expect(drift.exitCode).toBe(0);
        expect(drift.changed).toEqual([]);

        const checked = await runCheckCommand(workspace);
        expect(checked.exitCode).toBe(0);
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    { timeout: 120_000 },
  );
});
