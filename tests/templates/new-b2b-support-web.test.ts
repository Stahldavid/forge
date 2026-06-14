import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runNewCommand } from "../../src/forge/cli/new.ts";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";
import { runVerifyCommand } from "../../src/forge/cli/verify.ts";
import {
  cleanupWorkspace,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

function read(project: string, relativePath: string): string {
  return readFileSync(join(project, relativePath), "utf8");
}

describe("b2b-support-web template", () => {
  test("parseCli accepts forge new options", () => {
    const parsed = parseCli([
      "new",
      "support-app",
      "--template",
      "b2b-support-web",
      "--package-manager",
      "bun",
      "--no-install",
      "--no-git",
    ]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "new",
      name: "support-app",
      template: "b2b-support-web",
      packageManager: "bun",
      install: false,
      git: false,
    });
  });

  test("forge new creates the minimal full-stack support app", async () => {
    const workspace = tempWorkspace("new-b2b-support-web");
    try {
      const result = await runNewCommand({
        name: "support-app",
        template: "b2b-support-web",
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
      expect(result.message).toBe(
        "Created support-app from template b2b-support-web.",
      );

      const project = join(workspace, "support-app");
      expect(existsSync(join(project, "AGENTS.md"))).toBe(true);
      expect(existsSync(join(project, ".gitignore"))).toBe(true);
      expect(existsSync(join(project, ".env.example"))).toBe(true);
      expect(existsSync(join(project, "forge.lock"))).toBe(false);
      expect(existsSync(join(project, "src", "forge", "_generated"))).toBe(false);
      expect(existsSync(join(project, "web", "app", "tickets", "page.tsx"))).toBe(true);
      expect(existsSync(join(project, "src", "workflows", "triageTicketWorkflow.ts"))).toBe(true);

      expect(read(project, "package.json")).toContain('"name": "support-app"');
      expect(read(project, "package.json")).toContain('"forge": "file:');
      expect(read(project, "package.json")).not.toContain('"forge": "latest"');
      expect(read(project, "package.json")).toContain('"packageManager": "bun@1.3.14"');
      expect(read(project, "web/package.json")).not.toContain("latest");
      expect(read(project, ".env.example")).toContain("NEXT_PUBLIC_FORGE_URL");
      expect(read(project, ".env.example")).toContain("STRIPE_SECRET_KEY");
      expect(read(project, "AGENTS.md")).toContain("Do not:");
      expect(read(project, ".gitignore")).toContain(".forge/pglite/");
      expect(read(project, ".gitignore")).toContain(".forge/locks/");
      expect(read(project, ".gitignore")).toContain("src/forge/_generated/");
      expect(read(project, ".gitignore")).toContain("forge.lock");
      expect(read(project, ".gitignore")).toContain(".forge/repairs/");
      expect(read(project, ".gitignore")).toContain(".forge/refactors/");
      expect(read(project, ".gitignore")).toContain(".forge/upgrades/");
      expect(read(project, ".gitignore")).toContain(".forge/reviews/");
      expect(read(project, ".gitignore")).toContain(".forge/impact/");
      expect(read(project, ".gitignore")).toContain(".forge/agent-adapters/");

      expect(read(project, "src/forge/schema.ts")).toContain("tickets");
      expect(read(project, "src/policies.ts")).toContain("billing.manage");
      expect(read(project, "src/commands/createTicket.ts")).toContain("ticket.created");
      expect(read(project, "src/commands/manageBilling.ts")).toContain("billing.manage");
      expect(read(project, "src/queries/liveTickets.ts")).toContain("liveQuery");
      expect(read(project, "src/actions/captureTicketCreated.ts")).toContain(
        "ticket_created_action_processed",
      );
      expect(read(project, "src/workflows/triageTicketWorkflow.ts")).toContain(
        "ctx.ai.generateText",
      );

      expect(read(project, "web/components/TicketList.tsx")).toContain("useLiveQuery");
      expect(read(project, "web/components/CreateTicketForm.tsx")).toContain("useCommand");
      expect(read(project, "web/components/PolicyDeniedDemo.tsx")).toContain(
        "manageBilling",
      );
      expect(read(project, "web/components/TraceDetails.tsx")).toContain("traceId");
      expect(read(project, "web/app/providers.tsx")).toContain("../lib/forge");
      expect(read(project, "web/lib/forge.ts")).toContain("useCommand");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("template generates, checks drift, and verifies Forge invariants", async () => {
    const workspace = tempWorkspace("new-b2b-support-web-generate");
    try {
      const created = await runNewCommand({
        name: "support-app",
        template: "b2b-support-web",
        packageManager: "bun",
        install: false,
        git: false,
        workspaceRoot: workspace,
      });
      expect(created.exitCode).toBe(0);

      const project = join(workspace, "support-app");

      const generated = await runGenerateCommand({
        workspaceRoot: project,
        check: false,
        dryRun: false,
        json: false,
        concurrency: 2,
      });
      expect(generated.exitCode).toBe(0);

      const stabilized = await runGenerateCommand({
        workspaceRoot: project,
        check: false,
        dryRun: false,
        json: false,
        concurrency: 2,
      });
      expect(stabilized.exitCode).toBe(0);

      const checked = await runGenerateCommand({
        workspaceRoot: project,
        check: true,
        dryRun: false,
        json: false,
        concurrency: 2,
      });
      expect(checked.exitCode).toBe(0);

      expect(existsSync(join(project, "src", "forge", "_generated", "react.ts"))).toBe(true);
      expect(read(project, "src/forge/_generated/api.ts")).toContain("liveTickets");
      expect(read(project, "src/forge/_generated/clientManifest.json")).toContain(
        "GET /live/:name",
      );
      expect(read(project, "src/forge/_generated/frontendGraph.json")).toContain(
        "tickets/page.tsx",
      );

      const verified = await runVerifyCommand({
        workspaceRoot: project,
        json: false,
        strict: true,
        skipTests: true,
        skipTypecheck: true,
        skipEslint: true,
      });
      expect(verified.exitCode).toBe(0);
      expect(verified.steps.map((step) => step.name)).toContain("policy-check-strict");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
