import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
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
  test("release check explains the missing prepared release gate", async () => {
    const workspace = scaffoldGenerateWorkspace("h23-missing-release");
    try {
      const checked = await runReleaseCommand({
        area: "release",
        action: "check",
        workspaceRoot: workspace,
        json: true,
        env: "production",
        allowDirty: true,
        allowPublicSourcemaps: false,
      });
      expect(checked.exitCode).toBe(1);
      expect(checked.failureKind).toBe("missing-prepared-release");
      expect(checked.nextActions).toContain("forge release prepare --env production");
      expect(checked.diagnostics[0]?.message).toContain("run forge release prepare");

      const allowed = await runReleaseCommand({
        area: "release",
        action: "check",
        workspaceRoot: workspace,
        json: true,
        env: "production",
        allowDirty: true,
        allowMissingLocalRelease: true,
        allowPublicSourcemaps: false,
      });
      expect(allowed.exitCode).toBe(0);
      expect(allowed.ok).toBe(true);
      expect(allowed.data).toMatchObject({ state: "missing-prepared-release" });
      expect(allowed.diagnostics[0]?.severity).toBe("warning");
      expect(allowed.nextActions).toContain("forge release prepare --env production");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("packed package smoke uses the installed global CLI and exercises hooks and Studio", () => {
    const script = readFileSync(join(process.cwd(), "scripts", "smoke-packed-package.mjs"), "utf8");
    expect(script).toContain("\"install\", \"--global\"");
    expect(script).toContain("\"check\", \"--json\"");
    expect(script).toContain("\"agent\", \"hooks\", \"smoke\"");
    expect(script).toContain("\"studio\"");
    expect(script).toContain("trustedNativeReady");
    expect(script).toContain("readinessLevel");
    expect(script).toContain("SMOKE_PACKED_PACKAGE_DRY_RUN");
    expect(script).toContain("release-smoke-latest.json");
    expect(script).toContain("plannedCommands");
    expect(script).not.toContain("join(repoRoot, \"bin\", \"forge.mjs\")");
  });

  test("packed package smoke dry-run writes machine-readable evidence", () => {
    const temp = mkdtempSync(join(tmpdir(), "forge-release-smoke-dry-run-"));
    try {
      const report = join(temp, "smoke-report.json");
      const result = spawnSync("node", ["scripts/smoke-packed-package.mjs", "--dry-run"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SMOKE_PACKED_PACKAGE_REPORT: report,
        },
        encoding: "utf8",
        windowsHide: true,
      });
      expect(result.status).toBe(0);
      const evidence = JSON.parse(readFileSync(report, "utf8"));
      expect(evidence).toMatchObject({
        schemaVersion: "0.1.0",
        kind: "release-packed-package-smoke",
        ok: true,
        dryRun: true,
      });
      expect(evidence.artifacts.plannedCommands).toContain("npm pack --json");
      expect(evidence.steps).toEqual([]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

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
