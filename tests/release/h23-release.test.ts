import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runReleaseCommand } from "../../src/forge/cli/release.ts";
import { createTelemetryContext } from "../../src/forge/runtime/telemetry/context.ts";
import type { DbAdapter } from "../../src/forge/runtime/db/adapter.ts";
import {
  cleanupWorkspace,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

describe("H23 release artifact and symbolication bridge", () => {
  test("production prepare blocks dirty git worktree unless allowed", async () => {
    const workspace = tempWorkspace("h23-dirty");
    try {
      writeFileSync(
        join(workspace, "package.json"),
        JSON.stringify({ name: "h23-dirty", version: "1.0.0" }),
        "utf8",
      );
      writeFileSync(join(workspace, "forge.lock"), "lock\n", "utf8");
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

});
