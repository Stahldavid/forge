import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";
import {
  formatDevConsoleJson,
  runDevConsoleCycle,
} from "../../src/forge/dev-console/cycle.ts";
import { run as runGenerate } from "../../src/forge/compiler/orchestrator/run.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
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
  });

  test("dev console recommends forge generate when generated files are stale", async () => {
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
      expect(cycle.nextActions.map((action) => action.command)).toContain("forge generate");
      expect(JSON.parse(formatDevConsoleJson(cycle)).schemaVersion).toBe("0.1.0");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("dev console returns a clean generated phase after generation", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-console-clean");
    try {
      await runGenerate(defaultGenerateOptions(workspace));
      const cycle = await runDevConsoleCycle({
        workspaceRoot: workspace,
        mode: "once",
        includeImpact: false,
      });
      expect(cycle.phases.find((phase) => phase.name === "generated")?.ok).toBe(true);
      expect(cycle.nextActions.length).toBeGreaterThan(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
