import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runGenerateCommand, runInspectCommand } from "../../src/forge/cli/commands.ts";
import { runNewCommand } from "../../src/forge/cli/new.ts";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import type { TableMapEntry } from "../../src/forge/compiler/data-graph/sql/serialize.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import { runLiveQuery } from "../../src/forge/runtime/live/live-query-runner.ts";
import type { AuthContext } from "../../src/forge/runtime/auth/types.ts";
import {
  cleanupWorkspace,
  REPO_ROOT,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

function read(project: string, relativePath: string): string {
  return readFileSync(join(project, relativePath), "utf8");
}

function readGeneratedJson<T>(project: string, relativePath: string): T {
  return JSON.parse(
    stripDeterministicHeader(read(project, join(GENERATED_DIR, relativePath))),
  ) as T;
}

function installForgeFixture(project: string): void {
  const target = join(project, "node_modules", "forge");
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(REPO_ROOT, "tests", "fixtures", "packages", "forge"), target, {
    recursive: true,
    force: true,
  });
}

describe("agent-workroom template", () => {
  test("parseCli accepts agent-workroom", () => {
    const parsed = parseCli([
      "new",
      "agent-room",
      "--template",
      "agent-workroom",
      "--package-manager",
      "bun",
      "--no-install",
      "--no-git",
    ]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "new",
      name: "agent-room",
      template: "agent-workroom",
      packageManager: "bun",
      install: false,
      git: false,
    });
  });

  test("forge new creates an agent-native workroom app", async () => {
    const workspace = tempWorkspace("new-agent-workroom");
    try {
      const result = await runNewCommand({
        name: "agent-room",
        template: "agent-workroom",
        packageManager: "bun",
        install: false,
        git: false,
        workspaceRoot: workspace,
      });

      expect(result.exitCode).toBe(0);
      expect(result.gitHygiene).toMatchObject({
        ok: true,
        missingPaths: [],
      });
      expect(result.message).toBe("Created agent-room from template agent-workroom.");

      const project = join(workspace, "agent-room");
      expect(existsSync(join(project, "AGENTS.md"))).toBe(true);
      expect(existsSync(join(project, "web", "src", "App.tsx"))).toBe(true);
      expect(existsSync(join(project, "src", "commands", "recordAgentSignal.ts"))).toBe(true);
      expect(existsSync(join(project, "src", "queries", "liveWorkroom.ts"))).toBe(true);

      expect(read(project, "package.json")).toContain('"template": "agent-workroom"');
      expect(read(project, "package.json")).toContain('"verify": "forge verify agent"');
      expect(read(project, "AGENTS.md")).toContain("forge studio attach . --target codex --preview-port 5174");
      expect(read(project, "src/forge/schema.ts")).toContain("agentSessions");
      expect(read(project, "src/forge/schema.ts")).toContain("generatedState");
      expect(read(project, "src/forge/schema.ts")).toContain("authoredDiffCommand");
      expect(read(project, "src/commands/openWorkroom.ts")).toContain("workroom.opened");
      expect(read(project, "src/commands/recordAgentSignal.ts")).toContain("agent.signal.recorded");
      expect(read(project, "web/src/App.tsx")).toContain("http://127.0.0.1:5174");
      expect(read(project, "web/src/App.tsx")).toContain("api.liveQueries.liveWorkroom");
      expect(read(project, "web/src/App.tsx")).toContain("api.commands.recordAgentSignal");
      expect(read(project, "web/src/App.tsx")).toContain("authoredDiffCommand");
      expect(read(project, "web/src/App.tsx")).toContain("generatedState");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("template generates and exposes workroom bindings", async () => {
    const workspace = tempWorkspace("new-agent-workroom-generate");
    try {
      const created = await runNewCommand({
        name: "agent-room",
        template: "agent-workroom",
        packageManager: "bun",
        install: false,
        git: false,
        workspaceRoot: workspace,
      });
      expect(created.exitCode).toBe(0);

      const project = join(workspace, "agent-room");
      installForgeFixture(project);
      const generated = await runGenerateCommand({
        workspaceRoot: project,
        check: false,
        dryRun: false,
        json: false,
        concurrency: 2,
      });
      expect(generated.exitCode).toBe(0);

      const checked = await runGenerateCommand({
        workspaceRoot: project,
        check: true,
        dryRun: false,
        json: false,
        concurrency: 2,
      });
      expect(checked.exitCode).toBe(0);

      expect(read(project, "src/forge/_generated/api.ts")).toContain("liveWorkroom");
      expect(read(project, "src/forge/_generated/api.ts")).toContain("recordAgentSignal");

      const frontend = await runInspectCommand("frontend", project);
      expect(frontend.exitCode).toBe(0);
      expect(JSON.stringify(frontend.data)).toContain("liveWorkroom");
      expect(JSON.stringify(frontend.data)).toContain("recordAgentSignal");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 45_000);

  test("generated workroom runtime records external-agent evidence and serves live preview data", async () => {
    const workspace = tempWorkspace("new-agent-workroom-runtime");
    try {
      const created = await runNewCommand({
        name: "agent-room",
        template: "agent-workroom",
        packageManager: "bun",
        install: false,
        git: false,
        workspaceRoot: workspace,
      });
      expect(created.exitCode).toBe(0);

      const project = join(workspace, "agent-room");
      installForgeFixture(project);
      const generated = await runGenerateCommand({
        workspaceRoot: project,
        check: false,
        dryRun: false,
        json: false,
        concurrency: 2,
      });
      expect(generated.exitCode).toBe(0);

      const sqlPlan = readGeneratedJson<SqlPlan>(project, "sqlPlan.json");
      const db = readGeneratedJson<{ tableMap: Record<string, TableMapEntry> }>(project, "db.json");
      const adapter = createMemoryAdapter();
      await applyMigrations(adapter, sqlPlan);
      const auth: AuthContext = {
        kind: "user",
        userId: "demo-user",
        tenantId: "demo-tenant",
        role: "member",
        roles: ["member"],
        permissions: [],
      };

      const opened = await runEntry(project, "openWorkroom", {
        json: false,
        mock: false,
        auth,
        args: {
          appName: "LaunchOps",
          appPath: "C:/Users/David/Documents/launchops",
          previewUrl: "http://127.0.0.1:5174",
          previewStatus: "reachable",
          previewStatusReason: "Preview answered at the attached URL.",
          agent: "codex",
          objective: "Build a production dashboard through an external coding agent",
          generatedState: "fresh",
          generatedChangedFiles: 0,
          authoredFiles: 0,
          generatedFiles: 0,
          terminalCommand: "codex",
          terminalCwd: "C:/Users/David/Documents/launchops",
        },
        db: adapter,
      });
      expect(opened.exitCode).toBe(0);
      expect(opened.ok).toBe(true);
      const session = opened.result as { id: string; appName: string; previewUrl: string };
      expect(session.appName).toBe("LaunchOps");
      expect(session.previewUrl).toBe("http://127.0.0.1:5174");

      const signal = await runEntry(project, "recordAgentSignal", {
        json: false,
        mock: false,
        auth,
        args: {
          sessionId: session.id,
          source: "codex",
          kind: "file-change",
          title: "Dashboard shell implemented",
          detail: "External agent changed source files and left ForgeOS evidence.",
          filesChanged: ["web/src/App.tsx", "src/commands/createMetric.ts"],
          status: "info",
          previewStatus: "reachable",
          previewStatusReason: "Preview still answers after the edit.",
          generatedState: "regenerated",
          generatedChangedFiles: 8,
          authoredFiles: 2,
          generatedFiles: 8,
          authoredDiffCommand: 'git diff -- . ":(exclude)src/forge/_generated/**" ":(exclude)forge.lock"',
          generatedDiffCommand: "git diff -- src/forge/_generated forge.lock",
        },
        db: adapter,
      });
      expect(signal.exitCode).toBe(0);
      expect(signal.ok).toBe(true);

      const check = await runEntry(project, "recordCheckRun", {
        json: false,
        mock: false,
        auth,
        args: {
          sessionId: session.id,
          command: "forge verify agent",
          status: "passed",
          output: "agent checks passed",
          durationMs: 1240,
        },
        db: adapter,
      });
      expect(check.exitCode).toBe(0);
      expect(check.ok).toBe(true);

      const room = await runLiveQuery(
        project,
        "liveWorkroom",
        { auth, args: { sessionId: session.id } },
        { adapter, tableMap: db.tableMap },
      );
      expect(room.ok).toBe(true);
      expect(room.diagnostics).toEqual([]);
      const data = room.result as {
        selectedSession: {
          id: string;
          status: string;
          previewStatus: string;
          generatedState: string;
          generatedChangedFiles: number;
          authoredFiles: number;
          generatedFiles: number;
          terminalCwd: string;
        };
        signals: Array<{ title: string; filesChanged: string }>;
        checks: Array<{ command: string; status: string }>;
        stats: { signalCount: number; checkCount: number; filesTouched: number; failingChecks: number };
      };
      expect(data.selectedSession.id).toBe(session.id);
      expect(data.selectedSession.status).toBe("verified");
      expect(data.selectedSession.previewStatus).toBe("reachable");
      expect(data.selectedSession.generatedState).toBe("regenerated");
      expect(data.selectedSession.generatedChangedFiles).toBe(8);
      expect(data.selectedSession.authoredFiles).toBe(2);
      expect(data.selectedSession.generatedFiles).toBe(8);
      expect(data.selectedSession.terminalCwd).toContain("launchops");
      expect(data.signals[0]?.title).toBe("Dashboard shell implemented");
      expect(data.signals[0]?.filesChanged).toContain("web/src/App.tsx");
      expect(data.checks[0]).toMatchObject({ command: "forge verify agent", status: "passed" });
      expect(data.stats).toMatchObject({
        signalCount: 1,
        checkCount: 1,
        filesTouched: 2,
        failingChecks: 0,
      });
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 45_000);
});
