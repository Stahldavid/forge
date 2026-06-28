import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { run as runGenerate } from "../../src/forge/compiler/orchestrator/run.ts";
import { runHandoffCommand } from "../../src/forge/cli/handoff.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

function git(workspace: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
  });
  expect(result.status).toBe(0);
}

describe("forge handoff", () => {
  test("builds a compact work handoff for the next agent", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-handoff");
    try {
      await runGenerate(defaultGenerateOptions(workspace));
      git(workspace, ["init"]);
      git(workspace, ["config", "user.email", "forge@example.test"]);
      git(workspace, ["config", "user.name", "Forge Test"]);
      git(workspace, ["add", "."]);
      git(workspace, ["commit", "--no-gpg-sign", "--no-verify", "-m", "baseline"]);
      mkdirSync(join(workspace, "docs"), { recursive: true });
      mkdirSync(join(workspace, "bin"), { recursive: true });
      mkdirSync(join(workspace, "scratch"), { recursive: true });
      mkdirSync(join(workspace, ".codex"), { recursive: true });
      writeFileSync(join(workspace, ".handoff-note.txt"), "keep the dot\n", "utf8");
      writeFileSync(join(workspace, ".codex", "hooks.json"), "{}\n", "utf8");
      writeFileSync(join(workspace, "docs", "handoff.md"), "# Handoff\n", "utf8");
      writeFileSync(join(workspace, "scratch", "handoff-note.txt"), "continue here\n", "utf8");
      writeFileSync(join(workspace, "bin", "handoff-helper.ts"), "export const ok = true;\n", "utf8");

      const result = await runHandoffCommand({
        workspaceRoot: workspace,
        json: true,
      });

      expect(result.schemaVersion).toBe("0.1.0");
      expect(result.dev.agentContext.safeToEdit).toBe(true);
      expect(result.summary.generatedFresh).toBe(true);
      expect(result.summary.generatedChanged).toBe(false);
      expect(result.summary.generatedChangedFiles).toBe(0);
      expect(result.git.available).toBe(true);
      expect(result.git.untracked.sample).toContain(".handoff-note.txt");
      expect(result.git.untracked.count).toBe(5);
      expect(result.git.changeSummary.changed.byType.source.sample).toContain("bin/handoff-helper.ts");
      expect(result.git.changeSummary.changed.byType.docs.sample).toContain("docs/handoff.md");
      expect(result.git.changeSummary.changed.byType.config.sample).toContain(".codex/hooks.json");
      expect(result.git.changeSummary.changed.byType.other.sample).toContain(".handoff-note.txt");
      expect(result.git.changeSummary.changed.primaryTypes).toContain("source");
      expect(result.summary.untrackedFiles).toBe(5);
      expect(result.commitReady).toBeDefined();
      if (!result.commitReady) {
        throw new Error("expected commit-ready handoff summary");
      }
      expect(result.commitReady.files).toContain("bin/handoff-helper.ts");
      expect(result.commitReady.files).toContain("docs/handoff.md");
      expect(result.commitReady.files).not.toContain(".codex/hooks.json");
      expect(result.summary.commitReadyFiles).toBe(result.commitReady.count);
      expect(result.nextAgent.openingBrief).toContain("ForgeOS handoff");
      expect(result.nextAgent.openingBrief).toContain("source");
      expect(result.nextAgent.openingBrief).toContain("commit-ready file");
      expect(result.nextAgent.recommendedReadFiles).toContain("AGENTS.md");
      expect(result.nextAgent.recommendedCommands).toContain("forge review run --changed --json");
      expect(result.nextAgent.recommendedCommands).toContain("forge changed --commit-ready --json");
      expect(result.nextAgent.risks).toContain("5 untracked file(s) are not in git history");
      expect(result.nextAgent.risks).toContain("1 generated or operational file(s) are excluded from the commit-ready view");
      expect(result.diagnosticSummary.total).toBe(result.diagnostics.length);
      expect(result.exitCode).toBe(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("does not rewrite generated artifacts while building a handoff", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-handoff-readonly");
    try {
      await runGenerate(defaultGenerateOptions(workspace));
      const stalePath = join(workspace, "src", "forge", "_generated", "appGraph.json");
      const staleContent = "{\"stale\":true}\n";
      writeFileSync(stalePath, staleContent, "utf8");

      const result = await runHandoffCommand({
        workspaceRoot: workspace,
        json: true,
      });

      expect(result.ok).toBe(false);
      expect(result.summary.generatedFresh).toBe(false);
      expect(result.dev.phases.find((phase) => phase.name === "generated")?.message).toContain("handoff did not rewrite files");
      expect(readFileSync(stalePath, "utf8")).toBe(staleContent);
      expect(result.nextActions[0]).toBe("forge generate");
      expect(result.nextActions).toContain("forge generate");
      expect(result.diagnosticSummary.total).toBeGreaterThan(0);
      expect(result.diagnosticSummary.byCode.FORGE_DRIFT).toBeGreaterThan(0);
      expect(result.diagnostics.length).toBeLessThanOrEqual(8);
      expect(result.diagnosticSummary.fullDiagnosticsCommands).toContain("forge dev --once --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("uses repo-local Forge CLI commands when a checkout has bin/forge.mjs", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-handoff-local-forge");
    try {
      await runGenerate(defaultGenerateOptions(workspace));
      mkdirSync(join(workspace, "bin"), { recursive: true });
      writeFileSync(join(workspace, "bin", "forge.mjs"), "#!/usr/bin/env node\n", "utf8");
      git(workspace, ["init"]);
      git(workspace, ["config", "user.email", "forge@example.test"]);
      git(workspace, ["config", "user.name", "Forge Test"]);
      git(workspace, ["add", "."]);
      git(workspace, ["commit", "--no-gpg-sign", "--no-verify", "-m", "baseline"]);
      mkdirSync(join(workspace, "docs"), { recursive: true });
      writeFileSync(join(workspace, "docs", "handoff.md"), "# Handoff\n", "utf8");

      const result = await runHandoffCommand({
        workspaceRoot: workspace,
        json: true,
      });

      expect(result.nextActions).toContain("node bin/forge.mjs review run --changed --json");
      expect(result.nextActions).toContain("node bin/forge.mjs handoff --json");
      expect(result.nextActions).not.toContain("forge review run --changed --json");
      expect(result.nextActions).not.toContain("forge handoff --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
