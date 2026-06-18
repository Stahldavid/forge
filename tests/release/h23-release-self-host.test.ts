import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";
import { runReleaseCommand } from "../../src/forge/cli/release.ts";
import { runSelfHostCommand } from "../../src/forge/cli/self-host.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("H23 release self-host export", () => {
  test("self-host env includes release vars and provider export keeps tokens out", async () => {
    const workspace = scaffoldGenerateWorkspace("h23-self-host");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const selfHost = await runSelfHostCommand({
        subcommand: "env",
        workspaceRoot: workspace,
        json: false,
        withWeb: true,
        postgresVersion: "16",
        runtimePort: 3765,
        webPort: 3000,
      });
      expect(selfHost.exitCode).toBe(0);
      const env = readFileSync(join(workspace, "deploy", ".env.example"), "utf8");
      expect(env).toContain("FORGE_RELEASE_ID=");
      expect(env).toContain("NEXT_PUBLIC_FORGE_RELEASE_ID=");

      process.env.SENTRY_AUTH_TOKEN = "super-secret-token";
      const exported = await runReleaseCommand({
        area: "artifacts",
        action: "export",
        workspaceRoot: workspace,
        json: true,
        env: "production",
        target: "sentry",
        allowDirty: true,
        allowPublicSourcemaps: false,
      });
      expect(JSON.stringify(exported)).not.toContain("super-secret-token");
    } finally {
      delete process.env.SENTRY_AUTH_TOKEN;
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
