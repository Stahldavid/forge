import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runNewCommand } from "../../src/forge/cli/new.ts";
import { run as runGenerate } from "../../src/forge/compiler/orchestrator/run.ts";
import { runDevConsoleCycle } from "../../src/forge/dev-console/cycle.ts";
import { runForgeDoCommand } from "../../src/forge/intent/index.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

describe("H33 intent router", () => {
  test("parseCli recognizes forge do objectives", () => {
    const parsed = parseCli(["do", "add", "notes", "with", "ui", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "do",
      options: {
        objective: "add notes with ui",
        json: true,
      },
    });
  });

  test("parseCli normalizes structured forge do add-resource", () => {
    const parsed = parseCli(["do", "add-resource", "notes", "--with-ui", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "do",
      options: {
        objective: "add resource notes with ui",
        json: true,
      },
    });
  });

  test("parseCli recognizes structured understand intent", () => {
    const parsed = parseCli(["do", "understand", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "do",
      options: {
        objective: "understand project",
        json: true,
      },
    });
  });

  test("forge do plans a UI-backed resource workflow", async () => {
    const workspace = tempWorkspace("intent-router-resource");
    try {
      const created = await runNewCommand({
        name: "notes-app",
        template: "minimal-web",
        packageManager: "bun",
        install: false,
        git: false,
        workspaceRoot: workspace,
      });
      expect(created.exitCode).toBe(0);
      const project = join(workspace, "notes-app");
      await runGenerate(defaultGenerateOptions(project));

      const result = runForgeDoCommand({
        workspaceRoot: project,
        objective: "add resource notes with ui",
        json: true,
      });

      expect(result.intent.kind).toBe("add-feature");
      expect(result.context.frontendPresent).toBe(true);
      expect(result.context.routes).toContain("/");
      expect(result.commands.map((item) => item.command)).toContain(
        "forge make resource notes --fields title:text,status:enum(open,closed) --with-ui --dry-run --json",
      );
      expect(result.commands.map((item) => item.command)).toContain("forge changed --json");
      expect(result.commands.map((item) => item.command)).toContain("forge handoff --json");
      expect(result.filesToInspect).toContain("src/forge/_generated/frontendGraph.json");
      expect(JSON.stringify(result.risks)).toContain("Frontend bindings");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("forge do fix prefers diagnostics and repair loop", () => {
    const workspace = scaffoldGenerateWorkspace("intent-router-fix");
    try {
      const result = runForgeDoCommand({
        workspaceRoot: workspace,
        objective: "corrigir erros existentes",
        json: true,
      });
      expect(result.intent.kind).toBe("fix");
      expect(result.commands.map((item) => item.command)).toContain("forge changed --json");
      expect(result.commands.map((item) => item.command)).toContain("forge handoff --json");
      expect(result.commands.map((item) => item.command)).toContain("forge dev --once --json");
      expect(result.commands.map((item) => item.command)).toContain(
        "forge repair diagnose --from-last-test-run --json",
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("forge do inspect includes handoff for agent resume context", () => {
    const workspace = scaffoldGenerateWorkspace("intent-router-inspect");
    try {
      const result = runForgeDoCommand({
        workspaceRoot: workspace,
        objective: "understand project",
        json: true,
      });
      expect(["inspect", "explain"]).toContain(result.intent.kind);
      expect(result.commands[0]?.command).toBe("forge status --json");
      expect(result.commands[1]?.command).toBe("forge changed --json");
      expect(result.commands.map((item) => item.command)).toContain("forge handoff --json");
      expect(result.commands.map((item) => item.command)).toContain("forge agent print-context --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("forge do verify starts from grouped changes before focused checks", () => {
    const workspace = scaffoldGenerateWorkspace("intent-router-verify");
    try {
      const result = runForgeDoCommand({
        workspaceRoot: workspace,
        objective: "verify before handoff",
        json: true,
      });
      const commands = result.commands.map((item) => item.command);
      expect(result.intent.kind).toBe("verify");
      expect(commands[0]).toBe("forge changed --json");
      expect(commands).toContain("forge test plan --changed --json");
      expect(commands).toContain("forge verify --changed");
      expect(result.plan[0]?.commands).toContain("forge changed --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("dev console self-heals stale generated artifacts before suggesting next work", async () => {
    const workspace = scaffoldGenerateWorkspace("intent-router-dev-console");
    try {
      await runGenerate(defaultGenerateOptions(workspace));
      await Bun.write(join(workspace, "src", "forge", "_generated", "appGraph.json"), "{\"stale\":true}\n");
      const cycle = await runDevConsoleCycle({
        workspaceRoot: workspace,
        mode: "once",
        includeImpact: false,
      });
      const generated = cycle.phases.find((phase) => phase.name === "generated");
      expect(cycle.ok).toBe(true);
      expect(generated?.message).toContain("regenerated");
      expect(Number(generated?.details?.changed)).toBeGreaterThan(0);
      expect(generated?.details?.sampleChanged as string[]).toContain("src/forge/_generated/appGraph.json");
      expect(cycle.summary.agentContext.generatedFresh).toBe(true);
      expect(cycle.summary.agentContext.generatedChanged).toBe(true);
      expect(cycle.nextActions[0]?.command).toBe("forge dev");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 15_000);
});
