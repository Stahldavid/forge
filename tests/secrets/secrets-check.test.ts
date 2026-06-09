import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { checkSecrets } from "../../src/forge/runtime/secrets/check.ts";
import { loadEnvFiles } from "../../src/forge/runtime/secrets/env-loader.ts";
import { buildSecretRegistry } from "../../src/forge/compiler/secret-registry/build.ts";
import { STRIPE_RECIPE } from "../../src/forge/compiler/recipes/definitions.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("secrets check", () => {
  test("reports missing and present secrets with redaction", async () => {
    const workspace = scaffoldGenerateWorkspace("secrets-check");
    writeFileSync(
      join(workspace, "package.json"),
      JSON.stringify({ name: "x", dependencies: { stripe: "17.0.0" } }),
      "utf8",
    );
    writeFileSync(join(workspace, ".env.local"), "STRIPE_SECRET_KEY=sk_test_1234567890\n", "utf8");

    try {
      await run(defaultGenerateOptions(workspace));
      const { store } = loadEnvFiles({ workspaceRoot: workspace });
      const registry = buildSecretRegistry([]);
      registry.secrets = [
        {
          name: "STRIPE_SECRET_KEY",
          required: true,
          source: "recipe",
          integration: "stripe",
          allowedContexts: ["action"],
        },
        {
          name: "STRIPE_WEBHOOK_SECRET",
          required: true,
          source: "recipe",
          integration: "stripe",
          allowedContexts: ["endpoint"],
        },
      ];

      const result = checkSecrets(store, registry);
      expect(result.ok).toBe(false);
      expect(result.missing).toContain("STRIPE_WEBHOOK_SECRET");
      expect(result.present[0]?.redacted).toMatch(/^sk_t/);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
