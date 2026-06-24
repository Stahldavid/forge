import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { buildDevWatchGenerateFailureEvent, buildDevWatchReloadEvent, ensureGeneratedForDev, generatedEvidenceFromCycle, resolveAvailableWebPort, runDevCommand } from "../../src/forge/cli/dev.ts";
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

async function listenOnRandomPort(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to allocate test port");
  }
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    return {
      result: await fn(),
      output: chunks.join(""),
    };
  } finally {
    process.stdout.write = originalWrite;
  }
}

describe("H33 forge dev console", () => {
  test("parseCli recognizes forge dev --once as the diagnostic entrypoint", () => {
    const parsed = parseCli(["dev", "--once", "--json", "--watch"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("dev");
    if (parsed.command?.kind !== "dev") return;
    expect(parsed.command.once).toBe(true);
    expect(parsed.command.json).toBe(true);
    expect(parsed.command.watch).toBe(true);
    expect(parsed.command.worker).toBe(true);
    expect(parsed.command.withWeb).toBe(true);
  });

  test("parseCli makes forge dev the full local loop by default", () => {
    const parsed = parseCli(["dev"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "dev",
      db: "pglite",
      watch: true,
      worker: true,
      withWeb: true,
      apiOnly: false,
      webOnly: false,
    });

    const narrowed = parseCli(["dev", "--no-watch", "--no-worker", "--api-only"]);
    expect(narrowed.errors).toEqual([]);
    expect(narrowed.command).toMatchObject({
      kind: "dev",
      watch: false,
      worker: false,
      withWeb: false,
      apiOnly: true,
    });
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
    "dev console exposes a target preview URL for Studio observers",
    async () => {
      const workspace = scaffoldGenerateWorkspace("dev-console-preview-url");
      try {
        await runGenerate(defaultGenerateOptions(workspace));
        const cycle = await runDevConsoleCycle({
          workspaceRoot: workspace,
          mode: "once",
          includeImpact: false,
        });

        expect(cycle.summary.urls.suggestedPreview).toBe(cycle.summary.preview.targetAppUrl);
        expect(cycle.summary.preview.targetAppPort).toBe(5174);
        expect(cycle.summary.preview.targetAppUrl).toBe("http://127.0.0.1:5174");
        expect(cycle.summary.preview.note).toContain("target app preview");
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    15_000,
  );

  test("dev watch generation failures produce agent-readable JSON events", () => {
    const event = buildDevWatchGenerateFailureEvent({
      changedCount: 2,
      changedPaths: ["src/commands/createTicket.ts", "src/forge/schema.ts"],
      result: {
        ok: false,
        changed: [],
        unchanged: [],
        diagnostics: [
          {
            severity: "error",
            code: "FORGE_TEST_DIAGNOSTIC",
            message: "schema could not be compiled",
          },
        ],
        exitCode: 1,
      },
    });

    expect(event).toMatchObject({
      schemaVersion: "0.1.0",
      event: "dev.generate_failed",
      ok: false,
      changedFiles: 2,
      changedPaths: ["src/commands/createTicket.ts", "src/forge/schema.ts"],
      generated: {
        ok: false,
        state: "stale-risk",
        changedFiles: 0,
      },
      nextActions: ["forge dev --once --json", "forge check --json"],
    });
    expect(event.diagnostics[0]?.code).toBe("FORGE_TEST_DIAGNOSTIC");
  });

  test(
    "dev watch reload events include generated posture and agent context",
    async () => {
      const workspace = scaffoldGenerateWorkspace("dev-watch-reload-event");
      try {
        await runGenerate(defaultGenerateOptions(workspace));
        const cycle = await runDevConsoleCycle({
          workspaceRoot: workspace,
          mode: "watch",
          includeImpact: true,
        });
        const event = buildDevWatchReloadEvent({
          changedCount: 1,
          changedPaths: ["src/forge/schema.ts"],
          generated: {
            ok: true,
            changed: ["src/forge/_generated/appGraph.json"],
            unchanged: [],
            diagnostics: [],
            exitCode: 0,
          },
          reload: {
            ok: true,
            reason: "test",
            migrated: false,
            routes: 1,
            runtimeEntries: 1,
            worker: "running",
            diagnostics: [],
          },
          cycle,
        });

        expect(event).toMatchObject({
          schemaVersion: "0.1.0",
          event: "dev.reload",
          ok: true,
          changedFiles: 1,
          changedPaths: ["src/forge/schema.ts"],
          generated: {
            state: "regenerated",
            changedFiles: 1,
            command: "forge generate",
            checkCommand: "forge generate --check --json",
          },
          preview: {
            targetAppUrl: "http://127.0.0.1:5174",
          },
          agentContext: {
            safeToEdit: true,
            generatedFresh: true,
          },
        });
        expect(event.agentContext.diffPlan?.authoredDiffCommand).toContain("git diff -- .");
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    15_000,
  );

  test(
    "forge dev reports port-busy failures with recovery commands",
    async () => {
      const workspace = scaffoldGenerateWorkspace("dev-console-port-busy");
      const occupied = await listenOnRandomPort();
      try {
        await runGenerate(defaultGenerateOptions(workspace));
        const captured = await captureStdout(() =>
          runDevCommand({
            workspaceRoot: workspace,
            host: "127.0.0.1",
            port: occupied.port,
            mock: false,
            mockAi: false,
            watch: false,
            json: true,
            db: "memory",
            worker: false,
            telemetry: [],
            skipStartupConsole: true,
          }),
        );
        const payload = JSON.parse(captured.output.trim()) as {
          ok: boolean;
          failureKind?: string;
          busy?: { port?: number; suggestedCommands?: string[] };
          exitCode: number;
        };

        expect(captured.result.exitCode).toBe(1);
        expect(payload).toMatchObject({
          ok: false,
          failureKind: "port_busy",
          exitCode: 1,
          busy: {
            port: occupied.port,
          },
        });
        expect(payload.busy?.suggestedCommands?.[0]).toContain("forge dev --port 0");
        expect(payload.busy?.suggestedCommands).toContain("forge doctor windows --json");
      } finally {
        await occupied.close();
        cleanupWorkspace(workspace);
      }
    },
    20_000,
  );

  test("forge dev resolves an available web port before starting the web app", async () => {
    const occupied = await listenOnRandomPort();
    try {
      const selected = await resolveAvailableWebPort({
        host: "127.0.0.1",
        preferredPort: occupied.port,
        maxAttempts: 3,
      });

      expect(selected).toMatchObject({
        requestedPort: occupied.port,
        autoPortSelected: true,
      });
      expect(selected.port).toBeGreaterThan(occupied.port);
    } finally {
      await occupied.close();
    }
  });

  test(
    "forge dev generation guard refreshes stale artifacts before serving",
    async () => {
      const workspace = scaffoldGenerateWorkspace("dev-console-autogenerate");
      try {
        await runGenerate(defaultGenerateOptions(workspace));
        writeFileSync(join(workspace, "src", "forge", "_generated", "appGraph.json"), "{\"stale\":true}\n", "utf8");

        const generated = await ensureGeneratedForDev(workspace);
        expect(generated.ok).toBe(true);
        expect(generated.changed).toContain("src/forge/_generated/appGraph.json");
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    15_000,
  );

  test(
    "dev console regenerates stale artifacts instead of serving stale output",
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
        const generated = cycle.phases.find((phase) => phase.name === "generated");
        expect(cycle.ok).toBe(true);
        expect(cycle.summary.health.ok).toBe(true);
        expect(generated?.ok).toBe(true);
        expect(generated?.message).toContain("regenerated");
        expect(Number(generated?.details?.changed)).toBeGreaterThan(0);
        expect(generated?.details?.sampleChanged as string[]).toContain("src/forge/_generated/appGraph.json");
        expect(cycle.phases.find((phase) => phase.name === "check")?.status).not.toBe("skipped");
        expect(cycle.phases.find((phase) => phase.name === "frontend")?.status).not.toBe("skipped");
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
        expect(cycle.summary.health.errors).toBe(0);
        expect(Number(cycle.phases.find((phase) => phase.name === "generated")?.details?.changed)).toBe(0);
        expect(cycle.phases.find((phase) => phase.name === "generated")?.message).toBe("generated artifacts are up to date");
        expect(cycle.phases.find((phase) => phase.name === "check")?.status).not.toBe("skipped");
        expect(cycle.phases.find((phase) => phase.name === "frontend")?.status).not.toBe("skipped");
        expect(cycle.nextActions.length).toBeGreaterThan(0);
        expect(cycle.summary.agentContext).toMatchObject({
          safeToEdit: true,
          generatedFresh: true,
          generatedChanged: false,
          generatedChangedFiles: 0,
          changedFiles: 0,
        });
        expect(cycle.summary.generated).toMatchObject({
          ok: true,
          state: "fresh",
          changedFiles: 0,
          command: "forge generate",
          checkCommand: "forge generate --check --json",
        });
        expect(cycle.summary.agentContext.recommendedReadFiles).toContain("AGENTS.md");
        expect(cycle.summary.agentContext.recommendedCommands).toContain("forge dev");
        expect(generatedEvidenceFromCycle(cycle)).toMatchObject({
          state: "fresh",
          changedFiles: 0,
          command: "forge generate",
          checkCommand: "forge generate --check --json",
        });
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    15_000,
  );

  test(
    "dev console uses the repo-local CLI entrypoint in the ForgeOS framework checkout",
    async () => {
      const workspace = scaffoldGenerateWorkspace("dev-console-framework-entrypoint");
      try {
        writeFileSync(
          join(workspace, "package.json"),
          JSON.stringify(
            {
              name: "forgeos",
              private: true,
              type: "module",
              dependencies: { zod: "^3.24.0" },
            },
            null,
            2,
          ),
          "utf8",
        );
        mkdirSync(join(workspace, "bin"), { recursive: true });
        writeFileSync(join(workspace, "bin", "forge.mjs"), "", "utf8");
        await runGenerate(defaultGenerateOptions(workspace));

        const cycle = await runDevConsoleCycle({
          workspaceRoot: workspace,
          mode: "once",
          includeImpact: false,
        });

        expect(cycle.summary.generated).toMatchObject({
          command: "node bin/forge.mjs generate",
          checkCommand: "node bin/forge.mjs generate --check --json",
        });
        expect(cycle.summary.agentContext.recommendedCommands[0]).toBe("node bin/forge.mjs dev");
        expect(cycle.summary.agentContext.useFullCommands).toContain("node bin/forge.mjs inspect all --full --json");
        expect(cycle.nextActions[0]?.command).toBe("node bin/forge.mjs dev");
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    15_000,
  );

  test(
    "dev console marks generated artifacts fresh after self-healing stale files",
    async () => {
      const workspace = scaffoldGenerateWorkspace("dev-console-self-heal-fresh");
      try {
        await runGenerate(defaultGenerateOptions(workspace));
        await Bun.write(join(workspace, "src", "forge", "_generated", "appGraph.json"), "{\"stale\":true}\n");
        const cycle = await runDevConsoleCycle({
          workspaceRoot: workspace,
          mode: "once",
          includeImpact: false,
        });

        expect(cycle.ok).toBe(true);
        expect(cycle.summary.agentContext).toMatchObject({
          safeToEdit: true,
          generatedFresh: true,
          generatedChanged: true,
        });
        expect(cycle.summary.agentContext.generatedChangedFiles).toBeGreaterThan(0);
        expect(cycle.summary.generated.state).toBe("regenerated");
        expect(cycle.summary.generated.changedFiles).toBeGreaterThan(0);
        expect(cycle.phases.find((phase) => phase.name === "generated")?.message).toContain("regenerated");
        const evidence = generatedEvidenceFromCycle(cycle);
        expect(evidence.state).toBe("regenerated");
        expect(evidence.changedFiles).toBeGreaterThan(0);
        expect(evidence.message).toContain("regenerated");
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    15_000,
  );

  test(
    "dev console self-heals missing agent-native guide artifacts before serving",
    async () => {
      const workspace = scaffoldGenerateWorkspace("dev-console-missing-agent-guides");
      try {
        await runGenerate(defaultGenerateOptions(workspace));
        const cairGuide = join(workspace, "src", "forge", "_generated", "agentCairGuide.md");
        expect(existsSync(cairGuide)).toBe(true);
        unlinkSync(cairGuide);

        const cycle = await runDevConsoleCycle({
          workspaceRoot: workspace,
          mode: "once",
          includeImpact: false,
        });

        const generated = cycle.phases.find((phase) => phase.name === "generated");
        expect(cycle.ok).toBe(true);
        expect(generated?.ok).toBe(true);
        expect(generated?.message).toContain("regenerated");
        expect(generated?.details?.sampleChanged as string[]).toContain("src/forge/_generated/agentCairGuide.md");
        expect(existsSync(cairGuide)).toBe(true);
        expect(cycle.phases.find((phase) => phase.name === "check")?.status).not.toBe("skipped");
        expect(cycle.phases.find((phase) => phase.name === "frontend")?.status).not.toBe("skipped");
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
    "dev console impact summary is compact for agent JSON",
    async () => {
      const workspace = scaffoldGenerateWorkspace("dev-console-impact-compact");
      try {
        await runGenerate(defaultGenerateOptions(workspace));
        spawnSync("git", ["init"], { cwd: workspace, windowsHide: true });
        spawnSync("git", ["config", "user.email", "forge@example.com"], { cwd: workspace, windowsHide: true });
        spawnSync("git", ["config", "user.name", "Forge Test"], { cwd: workspace, windowsHide: true });
        spawnSync("git", ["add", "."], { cwd: workspace, windowsHide: true });
        spawnSync("git", ["commit", "-m", "initial"], { cwd: workspace, windowsHide: true });
        mkdirSync(join(workspace, "bin"), { recursive: true });
        mkdirSync(join(workspace, "docs"), { recursive: true });
        mkdirSync(join(workspace, "scratch"), { recursive: true });
        writeFileSync(join(workspace, "bin", "dev-console-helper.ts"), "export const ok = true;\n", "utf8");
        writeFileSync(join(workspace, "docs", "dev-console.md"), "# Dev console\n", "utf8");
        writeFileSync(
          join(workspace, "src", "forge", "schema.ts"),
          'import { defineTable } from "forge/schema";\n\nexport const users = defineTable("users", {\n  id: "string",\n});\n\nexport const auditEvents = defineTable("audit_events", {\n  id: "string",\n});\n',
          "utf8",
        );
        for (let index = 0; index < 20; index += 1) {
          writeFileSync(join(workspace, "scratch", `zz-${String(index).padStart(2, "0")}.txt`), `${index}\n`, "utf8");
        }

        const cycle = await runDevConsoleCycle({
          workspaceRoot: workspace,
          mode: "once",
          includeImpact: true,
        });
        const impact = cycle.phases.find((phase) => phase.name === "impact");
        const summary = impact?.details?.summary as {
          changedFiles: number;
          sampleChangedFiles: string[];
          hiddenChangedFiles: number;
          changeSummary: {
            byType: {
              source: { sample: string[] };
              docs: { sample: string[] };
              other: { count: number };
            };
            primaryTypes: string[];
          };
          fullCommand: string;
        } | undefined;

        expect(impact?.ok).toBe(true);
        expect(summary?.changedFiles).toBeGreaterThan(12);
        expect(summary?.sampleChangedFiles.length).toBeLessThanOrEqual(12);
        expect(summary?.hiddenChangedFiles).toBeGreaterThan(0);
        expect(summary?.changeSummary.byType.source.sample).toContain("bin/dev-console-helper.ts");
        expect(summary?.changeSummary.byType.docs.sample).toContain("docs/dev-console.md");
        expect(summary?.changeSummary.byType.other.count).toBeGreaterThan(12);
        expect(summary?.changeSummary.primaryTypes).toContain("other");
        expect(summary?.fullCommand).toBe("forge impact --changed --json");
        expect(cycle.summary.agentContext.changedFiles).toBeGreaterThan(12);
        expect(cycle.summary.agentContext.changeSummary?.byType.source.sample).toContain("bin/dev-console-helper.ts");
        expect(cycle.summary.agentContext.diffPlan).toMatchObject({
          first: "authored",
          then: "generated",
          generatedCollapsedByDefault: true,
          authoredDiffCommand: 'git diff -- . ":(exclude)src/forge/_generated/**" ":(exclude)forge.lock"',
        });
        expect(cycle.summary.agentContext.diffPlan?.generatedDiffCommand).toContain("src/forge/_generated");
        expect(cycle.summary.agentContext.diffPlan?.generatedDiffCommand).toContain("forge.lock");
        expect(cycle.summary.agentContext.diffPlan?.generatedDiffCommand).toContain("AGENTS.md");
        expect(cycle.summary.agentContext.diffPlan?.generatedDiffCommand).toContain(".forge/agent/context.json");
        expect(cycle.summary.agentContext.diffPlan?.generatedFiles).toBeGreaterThan(0);
        expect(cycle.summary.agentContext.diffPlan?.authoredFiles).toBeGreaterThan(12);
        expect(cycle.summary.agentContext.recommendedCommands).toContain("forge do verify --json");
        expect(cycle.summary.agentContext.useFullCommands).toContain("forge impact --changed --json");
        expect(formatDevConsoleJson(cycle)).not.toContain("zz-19.txt");
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    20_000,
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
        expect(cycle.summary.frontend).toMatchObject({
          present: true,
          framework: "vite",
          routes: ["/"],
          bridgeFiles: ["web/src/lib/forge.ts"],
        });
        expect(cycle.summary.capabilities.covered).toBeGreaterThanOrEqual(1);
        expect(cycle.summary.urls.web).toBe("http://127.0.0.1:5173");
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
