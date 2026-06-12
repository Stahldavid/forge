import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";
import {
  formatDevConsoleJson,
  runDevConsoleCycle,
} from "../../src/forge/dev-console/cycle.ts";
import { run as runGenerate } from "../../src/forge/compiler/orchestrator/run.ts";
import { runNewCommand } from "../../src/forge/cli/new.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

describe("H33 forge dev console", () => {
  test("parseCli recognizes forge dev --once as the diagnostic entrypoint", () => {
    const parsed = parseCli(["dev", "--once", "--json", "--watch"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("dev");
    if (parsed.command?.kind !== "dev") return;
    expect(parsed.command.once).toBe(true);
    expect(parsed.command.json).toBe(true);
    expect(parsed.command.watch).toBe(true);
    expect(parsed.command.withWeb).toBe(true);
  });

  test("parseCli accepts forge dev web controls", () => {
    const parsed = parseCli(["dev", "--api-only", "--web-port", "5173"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "dev",
      withWeb: false,
      apiOnly: true,
      webPort: 5173,
    });

    const webOnly = parseCli(["dev", "--web-only", "--open"]);
    expect(webOnly.errors).toEqual([]);
    expect(webOnly.command).toMatchObject({
      kind: "dev",
      webOnly: true,
      open: true,
    });
  });

  test(
    "dev console recommends forge generate when generated files are stale",
    async () => {
      const workspace = scaffoldGenerateWorkspace("dev-console-stale");
      try {
        await runGenerate(defaultGenerateOptions(workspace));
        writeFileSync(join(workspace, "src", "forge", "_generated", "appGraph.json"), "{\"stale\":true}\n", "utf8");
        const cycle = await runDevConsoleCycle({
          workspaceRoot: workspace,
          mode: "once",
          includeImpact: false,
        });
        expect(cycle.ok).toBe(false);
        expect(cycle.phases.find((phase) => phase.name === "generated")?.ok).toBe(false);
        expect(cycle.phases.find((phase) => phase.name === "check")?.status).toBe("skipped");
        expect(cycle.phases.find((phase) => phase.name === "frontend")?.status).toBe("skipped");
        expect(cycle.nextActions.map((action) => action.command)).toContain("forge generate");
        expect(JSON.parse(formatDevConsoleJson(cycle)).schemaVersion).toBe("0.1.0");
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    15_000,
  );

  test(
    "dev console returns a clean generated phase after generation",
    async () => {
      const workspace = scaffoldGenerateWorkspace("dev-console-clean");
      try {
        await runGenerate(defaultGenerateOptions(workspace));
        const cycle = await runDevConsoleCycle({
          workspaceRoot: workspace,
          mode: "once",
          includeImpact: false,
        });
        expect(cycle.phases.find((phase) => phase.name === "generated")?.ok).toBe(true);
        expect(cycle.phases.find((phase) => phase.name === "check")?.status).not.toBe("skipped");
        expect(cycle.phases.find((phase) => phase.name === "frontend")?.status).not.toBe("skipped");
        expect(cycle.nextActions.length).toBeGreaterThan(0);
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    15_000,
  );

  test(
    "dev console skips impact in non-git workspaces",
    async () => {
      const scaffold = scaffoldGenerateWorkspace("dev-console-no-git");
      const outer = mkdtempSync(join(tmpdir(), "forge-dev-console-no-git-"));
      const workspace = join(outer, "app");
      try {
        cpSync(scaffold, workspace, { recursive: true });
        await runGenerate(defaultGenerateOptions(workspace));
        const cycle = await runDevConsoleCycle({
          workspaceRoot: workspace,
          mode: "once",
          includeImpact: true,
        });
        expect(cycle.ok).toBe(true);
        const impact = cycle.phases.find((phase) => phase.name === "impact");
        expect(impact?.status).toBe("skipped");
        expect(impact?.message).toContain("not a git repository");
      } finally {
        cleanupWorkspace(scaffold);
        rmSync(outer, { recursive: true, force: true });
      }
    },
    15_000,
  );

  test(
    "dev console summarizes frontend routes and bindings",
    async () => {
      const workspace = tempWorkspace("dev-console-frontend");
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

        const cycle = await runDevConsoleCycle({
          workspaceRoot: project,
          mode: "once",
          includeImpact: false,
        });
        const frontend = cycle.phases.find((phase) => phase.name === "frontend");
        expect(frontend?.ok).toBe(true);
        expect(frontend?.message).toContain("frontend vite");
        expect(frontend?.details?.summary).toMatchObject({
          present: true,
          framework: "vite",
          routes: ["/"],
          bridgeFiles: ["web/src/lib/forge.ts"],
        });
        expect(JSON.stringify(frontend?.details?.summary)).toContain("command:createNote");
        expect(JSON.stringify(frontend?.details?.summary)).toContain("liveQuery:liveNotes");
        expect(formatDevConsoleJson(cycle)).toContain("\"frontend\"");
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    30_000,
  );
});
