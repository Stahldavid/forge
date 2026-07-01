import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runCheckCommand, runGenerateCommand, runInspectCommand } from "../../src/forge/cli/commands.ts";
import { runNewCommand } from "../../src/forge/cli/new.ts";
import { runSeedCommand } from "../../src/forge/cli/seed.ts";
import { cleanupWorkspace, tempWorkspace } from "../orchestrator/helpers.ts";

function read(project: string, relativePath: string): string {
  return readFileSync(join(project, relativePath), "utf8");
}

describe("vendor-access template", () => {
  test("parseCli accepts vendor-access", () => {
    const parsed = parseCli([
      "new",
      "vendor-app",
      "--template",
      "vendor-access",
      "--package-manager",
      "npm",
      "--no-install",
      "--no-git",
    ]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "new",
      template: "vendor-access",
      packageManager: "npm",
      install: false,
      git: false,
    });
  });

  test("forge new creates a production-shaped vendor access app", async () => {
    const workspace = tempWorkspace("new-vendor-access");
    try {
      const result = await runNewCommand({
        name: "vendor-app",
        template: "vendor-access",
        packageManager: "npm",
        install: false,
        git: false,
        workspaceRoot: workspace,
      });

      expect(result.exitCode).toBe(0);
      expect(result.gitHygiene).toMatchObject({ ok: true, missingPaths: [] });

      const project = join(workspace, "vendor-app");
      expect(existsSync(join(project, "web", "vite.config.ts"))).toBe(true);
      expect(read(project, "web/vite.config.ts")).toContain("/session");
      expect(existsSync(join(project, "src", "commands", "seedVendorAccessDemo.ts"))).toBe(true);
      expect(existsSync(join(project, "src", "commands", "approveAccessRequest.ts"))).toBe(true);
      expect(existsSync(join(project, "src", "queries", "liveVendorAccessDashboard.ts"))).toBe(true);

      expect(read(project, "package.json")).toContain('"template": "vendor-access"');
      expect(read(project, "package.json")).toContain('"dev": "forge dev --seed --all-tenants"');
      expect(read(project, "package.json")).toContain('"dev:no-seed": "forge dev"');
      expect(read(project, "README.md")).toContain("npm run dev");
      expect(read(project, "README.md")).toContain("`dev` script runs `forge dev --seed --all-tenants`");
      expect(read(project, "README.md")).not.toContain("run dev -- --seed");
      expect(read(project, ".gitignore")).toContain(".workos-seed-state.json");
      expect(read(project, ".gitignore")).toContain(".codex/");
      expect(read(project, ".gitignore")).toContain(".forge/runtime-cache/");
      expect(read(project, "web/index.html")).toContain("Vendor App - Vendor Access");
      expect(read(project, "web/index.html")).not.toContain("__FORGE_APP_TITLE__");
      expect(read(project, "src/forge/schema.ts")).toContain("access_requests");
      expect(read(project, "src/policies.ts")).toContain("access:approve");
      expect(read(project, "src/policies.ts")).toContain("vendors:read");
      expect(read(project, "src/commands/seedVendorAccessDemo.ts")).toContain("upsertById(ctx.db.vendors");
      expect(read(project, "src/commands/seedVendorAccessDemo.ts")).toContain("reset?: boolean");
      expect(read(project, "src/commands/seedVendorAccessDemo.ts")).toContain("deleteWhere(ctx.db.accessRequests");
      expect(read(project, "src/queries/listVendorAccessDashboard.ts")).toContain("ctx.auth?.tenantId");
      expect(read(project, "src/queries/listVendorAccessDashboard.ts")).toContain("ctx.db.organizations.get(tenantId)");
      expect(read(project, "src/queries/listVendorAccessDashboard.ts")).not.toContain("ctx.db.organizations.all()");
      expect(read(project, "src/queries/liveVendorAccessDashboard.ts")).toContain("ctx.auth?.tenantId");
      expect(read(project, "src/queries/liveVendorAccessDashboard.ts")).toContain("ctx.db.organizations.get(tenantId)");
      expect(read(project, "src/queries/liveVendorAccessDashboard.ts")).not.toContain("ctx.db.organizations.all()");
      expect(read(project, "web/src/main.tsx")).toContain("permissions:");
      expect(read(project, "web/src/main.tsx")).toContain("Sign in to review vendor access");
      expect(read(project, "web/src/main.tsx")).toContain("Local development account");
      expect(read(project, "web/src/main.tsx")).toContain("Continue with WorkOS");
      expect(read(project, "web/src/main.tsx")).toContain("data-forge-testid=\"login-submit\"");
      expect(read(project, "web/src/main.tsx")).toContain("Sign in");
      expect(read(project, "web/src/main.tsx")).toContain("LocalPersona");
      expect(read(project, "web/src/main.tsx")).not.toContain("Demo account");
      expect(read(project, "web/src/main.tsx")).not.toContain("DemoPersona");
      expect(read(project, "web/src/main.tsx")).not.toContain("login-password");
      expect(read(project, "web/src/main.tsx")).not.toContain("forge-demo");
      expect(read(project, "web/src/App.tsx")).toContain("Vendor access review");
      expect(read(project, "web/src/App.tsx")).toContain("Developer diagnostics");
      expect(read(project, "web/src/App.tsx")).toContain("data-forge-testid=\"dev-diagnostics-toggle\"");
      expect(read(project, "web/src/App.tsx")).toContain("Sign out");
      expect(read(project, "web/src/App.tsx")).toContain("data-forge-testid=\"seed-status\"");
      expect(read(project, "web/src/App.tsx")).toContain("data-forge-testid=\"reset-demo\"");
      expect(read(project, "web/src/App.tsx")).toContain("Tenant data ready");
      expect(read(project, "web/src/App.tsx")).toContain("Refresh tenant data");
      expect(read(project, "web/src/App.tsx")).toContain("Reset tenant");
      expect(read(project, "web/src/App.tsx")).toContain("data-forge-testid=\"vendor-detail\"");
      expect(read(project, "web/src/App.tsx")).not.toContain("seedDemo");
      expect(read(project, "web/src/App.tsx")).not.toContain("refreshDemoData");
      expect(read(project, "web/src/App.tsx")).toContain("delete next[tenantId]");
      expect(read(project, "web/src/App.tsx")).toContain("data-forge-testid=\"policy-denied-approval\"");
      expect(read(project, "web/src/App.tsx")).toContain("/health");
      expect(read(project, "web/src/App.tsx")).not.toContain("production-shaped ForgeOS app");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("template generates, checks, and captures connected capabilities", async () => {
    const workspace = tempWorkspace("new-vendor-access-generate");
    try {
      const created = await runNewCommand({
        name: "vendor-app",
        template: "vendor-access",
        packageManager: "npm",
        install: false,
        git: false,
        workspaceRoot: workspace,
      });
      expect(created.exitCode).toBe(0);

      const project = join(workspace, "vendor-app");
      const generated = await runGenerateCommand({
        workspaceRoot: project,
        check: false,
        dryRun: false,
        json: false,
        concurrency: 2,
      });
      expect(generated.exitCode).toBe(0);

      const checked = await runCheckCommand(project);
      expect(checked.exitCode).toBe(0);

      const capabilities = await runInspectCommand("capabilities", project);
      expect(capabilities.exitCode).toBe(0);
      expect(JSON.stringify(capabilities.data)).toContain("approveAccessRequest");
      expect(JSON.stringify(capabilities.data)).toContain("liveVendorAccessDashboard");
      expect(JSON.stringify(capabilities.data)).toContain("evidence_items");

      const ui = await runInspectCommand("ui", project, { ergonomics: true });
      expect(ui.exitCode).toBe(0);
      expect(JSON.stringify(ui.data)).toContain('"framework":"vite"');
      expect(JSON.stringify(ui.data)).toContain("seedVendorAccessDemo");
      expect(JSON.stringify(ui.data)).toContain("vendor-access-autoseed-data-visible");
      expect(JSON.stringify(ui.data)).toContain("vendor-access-local-login");
      expect(JSON.stringify(ui.data)).toContain("vendor-access-requester-denied-visible");
      expect(JSON.stringify(ui.data)).toContain("vendor-access-seed-control-visible");
      expect(JSON.stringify(ui.data)).toContain('"kind":"selectOption"');
      expect(ui.warnings.map((warning) => warning.code)).not.toContain("FORGE_UI_NETWORK_ERROR_TOO_GENERIC");
      expect(ui.warnings.map((warning) => warning.code)).not.toContain("FORGE_UI_SEED_ACTION_MISSING");
      expect(ui.warnings.map((warning) => warning.code)).not.toContain("FORGE_UI_AUTO_SEED_RECOVERY_MISSING");
      expect(ui.warnings.map((warning) => warning.code)).not.toContain("FORGE_UI_PRODUCT_COPY_TOO_META");
      expect(ui.warnings.map((warning) => warning.code)).not.toContain("FORGE_UI_AUTH_COPY_TOO_DEMO");
      expect(ui.warnings.map((warning) => warning.code)).not.toContain("FORGE_UI_FAKE_AUTH_FORM");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("seed status discovers the template demo seed command", async () => {
    const workspace = tempWorkspace("new-vendor-access-seed-status");
    try {
      const created = await runNewCommand({
        name: "vendor-app",
        template: "vendor-access",
        packageManager: "npm",
        install: false,
        git: false,
        workspaceRoot: workspace,
      });
      expect(created.exitCode).toBe(0);

      const project = join(workspace, "vendor-app");
      const generated = await runGenerateCommand({
        workspaceRoot: project,
        check: false,
        dryRun: false,
        json: false,
        concurrency: 2,
      });
      expect(generated.exitCode).toBe(0);

      const seed = await runSeedCommand({
        subcommand: "status",
        args: {},
        json: true,
        workspaceRoot: project,
      });

      expect(seed.exitCode).toBe(0);
      expect(seed.ok).toBe(true);
      expect(seed.selectedCommand).toBe("seedVendorAccessDemo");
      expect(seed.commands.map((command) => command.name)).toContain("seedVendorAccessDemo");
      expect(seed.readiness).toMatchObject({
        ready: true,
        reason: "seed-command-ready",
        autoSeedOnDev: true,
        autoSeedAllTenantsOnDev: true,
        autoSeedMode: "all-tenants",
        selectedCommand: "seedVendorAccessDemo",
      });
      expect(seed.readiness.emptyWorkspaceRecovery).toEqual([
        "npm run dev",
        "forge seed dev --command seedVendorAccessDemo --all-tenants --json",
        "forge seed reset --command seedVendorAccessDemo --all-tenants --json",
        "forge seed dev --command seedVendorAccessDemo --json",
        "forge seed reset --command seedVendorAccessDemo --json",
      ]);
      expect(seed.readiness.localTenants).toHaveLength(2);
      expect(seed.readiness.localTenants[0]).toMatchObject({
        tenantId: "11111111-1111-4111-8111-111111111111",
        organizationName: "Acme Corp",
        role: "owner",
      });
      expect(seed.readiness.localTenants[0]?.seedCommand).toContain("--tenant-id 11111111-1111-4111-8111-111111111111");
      expect(seed.readiness.localTenants[1]).toMatchObject({
        tenantId: "22222222-2222-4222-8222-222222222222",
        organizationName: "Globex Security",
        role: "security",
      });
      expect(seed.readiness.localTenants[1]?.resetCommand).toContain("--tenant-id 22222222-2222-4222-8222-222222222222");
      expect(seed.nextActions).toEqual(seed.readiness.emptyWorkspaceRecovery);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
