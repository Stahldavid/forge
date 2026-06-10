import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkDirectProcessEnvUsage } from "../../src/forge/compiler/guards/check-process-env.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { FORGE_SECRET_DIRECT_PROCESS_ENV } from "../../src/forge/compiler/diagnostics/codes.ts";

describe("process.env check", () => {
  test("warns on direct process.env secret access in app source", async () => {
    const workspace = scaffoldGenerateWorkspace("process-env-check");
    writeFileSync(
      join(workspace, "package.json"),
      JSON.stringify({ name: "x", dependencies: { stripe: "17.0.0" } }),
      "utf8",
    );

    const srcDir = join(workspace, "src", "actions");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "bad.ts"),
      'const key = process.env.STRIPE_SECRET_KEY;\nexport const bad = () => key;\n',
      "utf8",
    );

    try {
      await run(defaultGenerateOptions(workspace));
      const registry = { secrets: [{ name: "STRIPE_SECRET_KEY", required: true, source: "recipe" as const, allowedContexts: ["action"] as const }] };
      const warnings = checkDirectProcessEnvUsage(workspace, registry as never, false);
      expect(warnings.some((d) => d.code === FORGE_SECRET_DIRECT_PROCESS_ENV)).toBe(true);

      const errors = checkDirectProcessEnvUsage(workspace, registry as never, true);
      expect(errors[0]?.severity).toBe("error");
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
