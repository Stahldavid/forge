import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runCompilerBenchCommand } from "../../src/forge/bench.ts";
import { runNewCommand } from "../../src/forge/cli/new.ts";
import {
  runCheckCommand,
  runChangedCommand,
  runGenerateCommand,
  runInspectCommand,
  runStatusCommand,
  formatStatusHuman,
} from "../../src/forge/cli/commands.ts";
import { buildInspectJson } from "../../src/forge/cli/output.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

describe("Forge CLI generation and inspection", () => {
  test("generate --json emits one JSON document on stdout", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-generate-json");
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const parsed = parseCli(["generate", "--json"]);
      expect(parsed.command?.kind).toBe("generate");

      const result = await runGenerateCommand({
        workspaceRoot: workspace,
        check: false,
        dryRun: false,
        json: true,
        concurrency: 2,
      });

      expect(() => JSON.parse(output || "{}")).not.toThrow();
      expect(result.exitCode).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
      cleanupWorkspace(workspace);
    }
  });

  test("generate --dry-run does not write files", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-dry-run");
    try {
      const result = await runGenerateCommand({
        ...defaultGenerateOptions(workspace),
        dryRun: true,
      });
      expect(result.changed.length).toBeGreaterThan(0);
      expect(result.exitCode).toBe(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("check exits 0 when guard artifacts are present", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-check-guards");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runCheckCommand(workspace);
      expect(result.exitCode).toBe(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("compiler bench reports public phase timings", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-bench-compiler");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runCompilerBenchCommand({
        subcommand: "compiler",
        workspaceRoot: workspace,
        json: true,
        iterations: 1,
        warmups: 0,
        concurrency: 2,
      });
      expect(result.exitCode).toBe(0);
      expect(result.results).toHaveLength(1);
      expect(result.summary.medianMs).toBeGreaterThanOrEqual(0);
      expect(result.results[0]?.phases.packageGraphMs).toBeGreaterThanOrEqual(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("inspect returns error when artifacts are missing", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-inspect-missing");
    try {
      const result = await runInspectCommand("app", workspace);
      expect(result.exitCode).toBe(1);
      expect(result.errors[0]?.code).toBe("FORGE_INSPECT_MISSING");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("inspect framework returns framework-level context", async () => {
    const result = await runInspectCommand("framework", process.cwd());
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({
      schemaVersion: "0.1.0",
      project: {
        type: "forgeos-framework",
      },
    });
    expect(JSON.stringify(result.data)).toContain("forge dev --once --json");
    expect(JSON.stringify(result.data)).toContain("minimal-web");
  });

  test("inspect agent-contract reads the generated agent contract", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-inspect-agent-contract");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runInspectCommand("agent-contract", workspace);
      expect(result.exitCode).toBe(0);
      expect(result.data).toMatchObject({
        schemaVersion: "0.1.0",
      });
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("inspect summary, schema, and handoff return compact agent-facing payloads", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-inspect-focused");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));

      const summary = await runInspectCommand("summary", workspace);
      expect(summary.exitCode).toBe(0);
      expect(JSON.stringify(summary.data)).toContain("forge inspect schema --json");

      const schema = await runInspectCommand("schema", workspace);
      expect(schema.exitCode).toBe(0);
      expect(schema.data).toMatchObject({
        schemaVersion: "0.1.0",
      });
      expect(JSON.stringify(schema.data)).toContain("missingRuntimeFields");

      const handoff = await runInspectCommand("handoff", workspace);
      expect(handoff.exitCode).toBe(0);
      expect(JSON.stringify(handoff.data)).toContain("forge agent prepare --target codex --json");
      expect(handoff.data).toMatchObject({
        summary: {
          defaultReady: false,
          requiredReady: false,
        },
      });
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("inspect all is compact by default and keeps full dump behind --full", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-inspect-all-compact");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));

      const brief = await runInspectCommand("all", workspace, { brief: true });
      expect(brief.exitCode).toBe(0);
      expect(brief.data).toMatchObject({
        schemaVersion: "0.1.0",
        brief: true,
        payload: {
          mode: "brief",
          fullCommand: "forge inspect all --full --json",
          compactCommand: "forge inspect all --json",
        },
      });
      expect(JSON.stringify((brief.data as { payload: unknown }).payload)).toContain("omitted");
      expect(JSON.stringify(brief.data)).toContain("forge inspect all --full --json");
      expect(JSON.stringify(brief.data)).not.toContain('"inspections"');
      expect(buildInspectJson(brief).nextActions).toContain("forge agent onboard --target codex --json");

      const compact = await runInspectCommand("all", workspace);
      expect(compact.exitCode).toBe(0);
      expect(compact.data).toMatchObject({
        schemaVersion: "0.1.0",
        compact: true,
        payload: {
          mode: "compact",
          fullCommand: "forge inspect all --full --json",
          briefCommand: "forge inspect all --brief --json",
        },
      });
      expect(JSON.stringify((compact.data as { payload: unknown }).payload)).toContain("large generated registries");
      expect(JSON.stringify(compact.data)).toContain("forge inspect all --full --json");
      expect(JSON.stringify(compact.data).length).toBeLessThan(20_000);
      expect(JSON.stringify(brief.data).length).toBeLessThan(JSON.stringify(compact.data).length);

      const full = await runInspectCommand("all", workspace, { full: true });
      expect(full.exitCode).toBe(0);
      expect(full.data).toMatchObject({
        compact: false,
        payload: {
          mode: "full",
          compactCommand: "forge inspect all --json",
          briefCommand: "forge inspect all --brief --json",
        },
      });
      expect(JSON.stringify(full.data)).toContain("moduleGraph");
      expect(JSON.stringify(full.data).length).toBeGreaterThan(JSON.stringify(compact.data).length);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("status returns a compact agent-facing project summary", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-status");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      spawnSync("git", ["init"], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["config", "user.email", "forge@example.com"], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["config", "user.name", "Forge Test"], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["add", "."], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["commit", "-m", "initial"], { cwd: workspace, windowsHide: true });
      mkdirSync(join(workspace, "bin"), { recursive: true });
      mkdirSync(join(workspace, "docs"), { recursive: true });
      writeFileSync(join(workspace, "bin", "status-helper.ts"), "export const ok = true;\n", "utf8");
      writeFileSync(join(workspace, "docs", "status.md"), "# Status\n", "utf8");
      const status = runStatusCommand(workspace);
      expect(status.exitCode).toBe(0);
      expect(status.data).toMatchObject({
        schemaVersion: "0.1.0",
        ok: true,
        generated: {
          state: "ready",
          ready: true,
          driftClean: true,
          missingArtifacts: 0,
          tableDrift: 0,
          safeDevCommand: "forge dev",
          checkCommand: "forge generate --check --json",
          repairCommand: "forge generate",
        },
        studio: {
          attachCommand: "forge studio attach . --preview-port 5174 --target codex --json",
          targetPreviewUrl: "http://127.0.0.1:5174",
          startTargetAppCommand: "forge dev --web-port 5174",
          useful: false,
        },
        summary: {
          generated: "ready",
          frontendPresent: false,
          routes: 0,
        },
        checks: {
          handoff: {
            defaultReady: false,
          },
        },
        git: {
          available: true,
        },
      });
      const git = status.data.git as {
        changed: {
          byType: {
            source: { sample: string[] };
            docs: { sample: string[] };
          };
          primaryTypes: string[];
        };
      };
      expect(git.changed.byType.source.sample).toContain("bin/status-helper.ts");
      expect(git.changed.byType.docs.sample).toContain("docs/status.md");
      expect(git.changed.primaryTypes).toContain("source");
      expect(Number((status.data.summary as Record<string, unknown>).missingDefaultAgentFiles)).toBeGreaterThan(0);
      expect((status.data.nextActions as string[])[0]).toBe("forge handoff --json");
      expect(status.data.nextActions as string[]).toContain("forge changed --json");
      expect((status.data.generated as { nextActions: string[] }).nextActions).toContain("forge dev");
      const human = formatStatusHuman(status);
      expect(human).toContain("Generated detail: missing artifacts 0, table drift 0");
      expect(human).toContain("Generated check: forge generate --check --json");
      expect(human).toContain("Generated repair: forge generate");
      expect(human).toContain("Generated dev: forge dev");
      expect(human).toContain("Studio attach: forge studio attach . --preview-port 5174 --target codex --json");
      expect(human).toContain("Studio preview: http://127.0.0.1:5174");
      expect(JSON.stringify(status.data)).toContain("forge agent prepare --target generic --json");
      expect(JSON.stringify(status.data)).toContain("forge dev");
      expect(JSON.stringify(status.data).length).toBeLessThan(8000);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("changed returns human and generated change buckets", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-changed");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      spawnSync("git", ["init"], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["config", "user.email", "forge@example.com"], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["config", "user.name", "Forge Test"], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["add", "."], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["commit", "-m", "initial"], { cwd: workspace, windowsHide: true });
      mkdirSync(join(workspace, "src", "commands"), { recursive: true });
      mkdirSync(join(workspace, "docs"), { recursive: true });
      writeFileSync(join(workspace, "src", "commands", "changed.ts"), "export const ok = true;\n", "utf8");
      writeFileSync(join(workspace, "docs", "changed.md"), "# Changed\n", "utf8");
      writeFileSync(join(workspace, "forge.lock"), "changed generated lock\n", "utf8");

      const changed = runChangedCommand(workspace);
      expect(changed.exitCode).toBe(0);
      expect(changed.data).toMatchObject({
        schemaVersion: "0.1.0",
        ok: true,
        summary: {
          changedFiles: 3,
          humanFiles: 2,
          generatedFiles: 1,
        },
      });
      const humanChanges = changed.data.humanChanges as {
        source: { sample: string[] };
        docs: { sample: string[] };
      };
      const derivedChanges = changed.data.derivedChanges as {
        generated: { sample: string[] };
      };
      expect(humanChanges.source.sample).toContain("src/commands/changed.ts");
      expect(humanChanges.docs.sample).toContain("docs/changed.md");
      expect(derivedChanges.generated.sample).toContain("forge.lock");
      expect(changed.data.reviewFocus).toMatchObject({
        first: "humanChanges",
        then: "derivedChanges",
        generatedIsDerived: true,
      });
      expect(changed.data.diffPlan).toMatchObject({
        first: "authored",
        then: "generated",
        generatedCollapsedByDefault: true,
        authoredFiles: 2,
        generatedFiles: 1,
      });
      expect(JSON.stringify(changed.data.diffPlan)).toContain("git diff -- .");
      expect(JSON.stringify(changed.data.diffPlan)).toContain("git diff -- src/forge/_generated forge.lock");
      expect((changed.data.reviewFocus as { suggestedOrder: string[] }).suggestedOrder).toEqual([
        "source",
        "docs",
        "generated",
      ]);
      expect(changed.data.nextActions as string[]).toContain("forge verify --changed");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("status reports frontend presence from frontendGraph.present", async () => {
    const workspace = tempWorkspace("cli-status-web");
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
      await runGenerateCommand(defaultGenerateOptions(project));

      const status = runStatusCommand(project);
      expect(status.exitCode).toBe(0);
      expect(status.data).toMatchObject({
        studio: {
          useful: true,
          attachCommand: "forge studio attach . --preview-port 5174 --target codex --json",
          targetPreviewUrl: "http://127.0.0.1:5174",
        },
        summary: {
          frontendPresent: true,
          routes: 1,
        },
      });
      expect(status.data.nextActions as string[]).toContain("forge studio attach . --preview-port 5174 --target codex --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
