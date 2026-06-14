import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runCheckCommand, runGenerateCommand, runInspectCommand } from "../../src/forge/cli/commands.ts";
import { runNewCommand } from "../../src/forge/cli/new.ts";
import {
  cleanupWorkspace,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

function read(project: string, relativePath: string): string {
  return readFileSync(join(project, relativePath), "utf8");
}

describe("minimal-web template", () => {
  test("parseCli accepts minimal-web", () => {
    const parsed = parseCli([
      "new",
      "notes-app",
      "--template",
      "minimal-web",
      "--no-install",
      "--no-git",
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "new",
      template: "minimal-web",
    });
  });

  test("forge new creates a connected minimal full-stack app", async () => {
    const workspace = tempWorkspace("new-minimal-web");
    try {
      const result = await runNewCommand({
        name: "notes-app",
        template: "minimal-web",
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

      const project = join(workspace, "notes-app");
      expect(existsSync(join(project, "web", "index.html"))).toBe(true);
      expect(existsSync(join(project, "web", "package.json"))).toBe(true);
      expect(existsSync(join(project, "web", "src", "lib", "forge.ts"))).toBe(true);
      expect(read(project, ".gitignore")).toContain("src/forge/_generated/");
      expect(read(project, ".gitignore")).toContain("forge.lock");
      expect(read(project, ".gitignore")).toContain(".forge/locks/");
      expect(read(project, ".gitignore")).toContain(".forge/repairs/");
      expect(read(project, ".gitignore")).toContain(".forge/refactors/");
      expect(read(project, ".gitignore")).toContain(".forge/upgrades/");
      expect(read(project, ".gitignore")).toContain(".forge/agent-adapters/");
      expect(read(project, "package.json")).toContain('"forge": "file:');
      expect(read(project, "package.json")).not.toContain('"forge": "latest"');
      expect(read(project, "package.json")).toContain('"packageManager": "bun@1.3.14"');
      expect(read(project, "web/package.json")).not.toContain("latest");
      expect(read(project, "web/package.json")).toContain('"vite": "^6.0.5"');
      expect(read(project, "src/commands/createNote.ts")).toContain("note.created");
      expect(read(project, "src/queries/listNotes.ts")).toContain("listNotes");
      expect(read(project, "src/queries/liveNotes.ts")).toContain("liveNotes");
      expect(read(project, "web/src/main.tsx")).toContain("devAuth");
      expect(read(project, "web/src/App.tsx")).toContain("useCommand");
      expect(read(project, "web/src/App.tsx")).toContain("useLiveQuery");
      expect(read(project, "web/src/App.tsx")).not.toContain("/commands/createNote");

      const generated = await runGenerateCommand({
        workspaceRoot: project,
        check: false,
        dryRun: false,
        json: false,
        concurrency: 2,
      });
      expect(generated.exitCode).toBe(0);

      const frontend = await runInspectCommand("frontend", project);
      expect(frontend.exitCode).toBe(0);
      expect(frontend.data).toMatchObject({
        present: true,
        framework: "vite",
        routes: [
          {
            path: "/",
            usesCommands: ["createNote"],
            usesLiveQueries: ["liveNotes"],
          },
        ],
        providers: [
          {
            name: "ForgeProvider",
            devAuth: true,
          },
        ],
        webManifest: {
          bridge: {
            valid: true,
          },
        },
      });
      expect(JSON.stringify(frontend.data)).toContain("createNote");
      expect(JSON.stringify(frontend.data)).toContain("liveNotes");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("forge check surfaces frontend diagnostics with fix hints", async () => {
    const workspace = tempWorkspace("new-minimal-web-frontend-check");
    try {
      const result = await runNewCommand({
        name: "notes-app",
        template: "minimal-web",
        packageManager: "bun",
        install: false,
        git: false,
        workspaceRoot: workspace,
      });
      expect(result.exitCode).toBe(0);

      const project = join(workspace, "notes-app");
      writeFileSync(
        join(project, "web", "src", "App.tsx"),
        `${read(project, "web/src/App.tsx")}\nfetch("/commands/createNote");\n`,
        "utf8",
      );

      const generated = await runGenerateCommand({
        workspaceRoot: project,
        check: false,
        dryRun: false,
        json: false,
        concurrency: 2,
      });
      expect(generated.exitCode).toBe(0);

      const checked = await runCheckCommand(project);
      const frontendWarning = checked.warnings.find(
        (diagnostic) => diagnostic.code === "FORGE_FRONTEND_DIRECT_RUNTIME_FETCH",
      );
      expect(frontendWarning?.fixHint).toContain("useCommand");
      expect(frontendWarning?.suggestedCommands).toContain("forge inspect frontend --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
