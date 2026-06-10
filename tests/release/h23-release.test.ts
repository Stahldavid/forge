import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";
import { runReleaseCommand } from "../../src/forge/cli/release.ts";
import { createTelemetryContext } from "../../src/forge/runtime/telemetry/context.ts";
import type { DbAdapter } from "../../src/forge/runtime/db/adapter.ts";
import { runSelfHostCommand } from "../../src/forge/cli/self-host.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

function writeSourcemapFixture(workspace: string): string {
  const dist = join(workspace, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "app.js"), "function min(){throw new Error('x')}\n", "utf8");
  writeFileSync(
    join(dist, "app.js.map"),
    JSON.stringify({
      version: 3,
      file: "dist/app.js",
      sources: ["src/app.ts"],
      names: ["TicketsPage"],
      mappings: "AAAAA",
    }),
    "utf8",
  );
  const input = join(workspace, "stacktrace.json");
  writeFileSync(
    input,
    JSON.stringify({ frames: [{ file: "dist/app.js", line: 1, column: 0 }] }),
    "utf8",
  );
  return input;
}

describe("H23 release artifact and symbolication bridge", () => {
  test("generates release manifests deterministically", async () => {
    const workspace = scaffoldGenerateWorkspace("h23-generated");
    try {
      const result = await runGenerateCommand(defaultGenerateOptions(workspace));
      expect(result.exitCode).toBe(0);

      for (const file of [
        "releaseManifest.json",
        "deployManifest.json",
        "artifactManifest.json",
        "sourceMapManifest.json",
        "symbolicationManifest.json",
        "buildInfo.json",
      ]) {
        expect(existsSync(join(workspace, "src", "forge", "_generated", file))).toBe(true);
      }

      const release = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, "src", "forge", "_generated", "releaseManifest.json"), "utf8"),
        ),
      ) as { defaultProvider: string; optionalProviders: string[] };
      expect(release.defaultProvider).toBe("local");
      expect(release.optionalProviders).toContain("sentry");
      expect(release.optionalProviders).toContain("bugsink");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("prepare stores local release artifacts and symbolicates stacktrace", async () => {
    const workspace = scaffoldGenerateWorkspace("h23-symbolicate");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const input = writeSourcemapFixture(workspace);

      const prepared = await runReleaseCommand({
        area: "release",
        action: "prepare",
        workspaceRoot: workspace,
        json: true,
        env: "production",
        allowDirty: true,
        allowPublicSourcemaps: false,
      });
      expect(prepared.exitCode).toBe(0);

      const symbolicated = await runReleaseCommand({
        area: "sourcemaps",
        action: "symbolicate",
        workspaceRoot: workspace,
        json: true,
        env: "production",
        input,
        allowDirty: true,
        allowPublicSourcemaps: false,
      });
      expect(symbolicated.exitCode).toBe(0);
      const frame = (symbolicated.data as { frames: Array<{ original?: { source: string; name?: string } }> }).frames[0];
      expect(frame.original?.source).toBe("src/app.ts");
      expect(frame.original?.name).toBe("TicketsPage");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("production prepare blocks dirty git worktree unless allowed", async () => {
    const workspace = scaffoldGenerateWorkspace("h23-dirty");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      Bun.spawnSync(["git", "init"], { cwd: workspace });
      Bun.spawnSync(["git", "config", "user.email", "test@example.com"], { cwd: workspace });
      Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: workspace });
      Bun.spawnSync(["git", "add", "."], { cwd: workspace });
      Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: workspace });
      writeFileSync(join(workspace, "dirty.txt"), "dirty\n", "utf8");

      const blocked = await runReleaseCommand({
        area: "release",
        action: "prepare",
        workspaceRoot: workspace,
        json: true,
        env: "production",
        allowDirty: false,
        allowPublicSourcemaps: false,
      });
      expect(blocked.exitCode).toBe(1);
      expect(blocked.diagnostics[0]?.code).toBe("FORGE_RELEASE_DIRTY_WORKTREE");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("telemetry envelopes include release metadata", async () => {
    const previousRelease = process.env.FORGE_RELEASE_ID;
    const previousDeploy = process.env.FORGE_DEPLOY_ID;
    process.env.FORGE_RELEASE_ID = "app@1.0.0+abc";
    process.env.FORGE_DEPLOY_ID = "production-app@1.0.0+abc";
    const payloads: unknown[] = [];
    const adapter: DbAdapter = {
      kind: "memory",
      query: async (_sql, params) => {
        if (params?.[2]) {
          payloads.push(params[2]);
        }
        return { rows: [{ id: 1 }], rowCount: 1 };
      },
      begin: async () => ({
        query: async () => ({ rows: [], rowCount: 0 }),
        commit: async () => {},
        rollback: async () => {},
      }),
      close: async () => {},
    };
    try {
      const telemetry = createTelemetryContext({
        adapter,
        traceId: "trace-1",
        runtime: { kind: "command", name: "test" },
      });
      await telemetry.capture("test.event");
      expect(JSON.stringify(payloads)).toContain("app@1.0.0+abc");
    } finally {
      if (previousRelease === undefined) {
        delete process.env.FORGE_RELEASE_ID;
      } else {
        process.env.FORGE_RELEASE_ID = previousRelease;
      }
      if (previousDeploy === undefined) {
        delete process.env.FORGE_DEPLOY_ID;
      } else {
        process.env.FORGE_DEPLOY_ID = previousDeploy;
      }
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
