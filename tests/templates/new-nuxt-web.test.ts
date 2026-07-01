import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runGenerateCommand, runInspectCommand } from "../../src/forge/cli/commands.ts";
import { runNewCommand } from "../../src/forge/cli/new.ts";
import {
  cleanupWorkspace,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

function read(project: string, relativePath: string): string {
  return readFileSync(join(project, relativePath), "utf8");
}

describe("nuxt-web template", () => {
  test("parseCli accepts nuxt-web", () => {
    const parsed = parseCli([
      "new",
      "nuxt-notes",
      "--template",
      "nuxt-web",
      "--package-manager",
      "npm",
      "--no-install",
      "--no-git",
    ]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "new",
      name: "nuxt-notes",
      template: "nuxt-web",
      packageManager: "npm",
      install: false,
      git: false,
    });
  });

  test("forge new creates a connected Nuxt notes app", async () => {
    const workspace = tempWorkspace("new-nuxt-web");
    try {
      const result = await runNewCommand({
        name: "nuxt-notes",
        template: "nuxt-web",
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

      const project = join(workspace, "nuxt-notes");
      expect(existsSync(join(project, "web", "nuxt.config.ts"))).toBe(true);
      expect(existsSync(join(project, "web", "app.vue"))).toBe(true);
      expect(existsSync(join(project, "web", "plugins", "forge.client.ts"))).toBe(true);
      expect(existsSync(join(project, "web", "plugins", "forge.server.ts"))).toBe(true);
      expect(existsSync(join(project, "web", "composables", "forge.ts"))).toBe(true);
      expect(existsSync(join(project, "web", "composables", "useNotes.ts"))).toBe(true);
      expect(existsSync(join(project, "web", "server", "api", "forge-health.get.ts"))).toBe(true);
      expect(read(project, "package.json")).toContain('"template": "nuxt-web"');
      expect(read(project, "web/package.json")).toContain('"nuxt": "^4.0.0"');
      expect(read(project, "web/package.json")).toContain('"vue-tsc": "^3.3.5"');
      expect(read(project, "web/tsconfig.json")).toContain('"allowImportingTsExtensions": true');
      expect(read(project, "web/nuxt.config.ts")).toContain("NUXT_PUBLIC_FORGE_URL");
      expect(read(project, "web/plugins/forge.client.ts")).toContain("ForgeVuePlugin");
      expect(read(project, "web/plugins/forge.server.ts")).toContain("ForgeVuePlugin");
      expect(read(project, "web/composables/useNotes.ts")).toContain("useForgeCommand");
      expect(read(project, "web/composables/useNotes.ts")).toContain("api.commands.createNote");
      expect(read(project, "web/composables/useNotes.ts")).toContain("useForgeLiveQuery");
      expect(read(project, "web/composables/useNotes.ts")).toContain("api.liveQueries.liveNotes");
      expect(read(project, "web/app.vue")).toContain("Workspace notes");
      expect(read(project, "web/app.vue")).not.toContain("ForgeOS nuxt-web");
      expect(read(project, ".gitignore")).toContain(".forge/delta/");
      expect(read(project, ".gitignore")).toContain(".forge/studio/");

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
        framework: "nuxt",
        routes: [
          {
            path: "/",
            usesCommands: ["createNote"],
            usesLiveQueries: ["liveNotes"],
          },
        ],
        providers: [
          {
            name: "ForgeNuxtPlugin",
            file: "web/plugins/forge.client.ts",
            devAuth: true,
          },
          {
            name: "ForgeNuxtPlugin",
            file: "web/plugins/forge.server.ts",
            devAuth: true,
          },
        ],
        webManifest: {
          bridge: {
            valid: true,
          },
        },
      });
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
