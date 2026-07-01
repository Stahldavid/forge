import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runFieldTestCommand } from "../../src/forge/cli/field-test.ts";
import { cleanupWorkspace, scaffoldGenerateWorkspace } from "../orchestrator/helpers.ts";

describe("forge field-test", () => {
  const seedStatusStdout = JSON.stringify({
    ok: true,
    readiness: {
      ready: true,
      autoSeedOnDev: true,
      autoSeedAllTenantsOnDev: true,
      autoSeedMode: "all-tenants",
      selectedCommand: "seedVendorAccessDemo",
      emptyWorkspaceRecovery: [
        "npm run dev",
        "forge seed dev --command seedVendorAccessDemo --all-tenants --json",
        "forge seed reset --command seedVendorAccessDemo --all-tenants --json",
        "forge seed dev --command seedVendorAccessDemo --json",
        "forge seed reset --command seedVendorAccessDemo --json",
      ],
    },
  });

  test("parseCli accepts field-test create, run, and report", () => {
    const defaultWorkOSCreate = parseCli([
      "field-test",
      "create",
      "vendor-access",
      "--auth",
      "workos",
      "--json",
    ]);
    expect(defaultWorkOSCreate.errors).toEqual([]);
    expect(defaultWorkOSCreate.command).toMatchObject({
      kind: "field-test",
      subcommand: "create",
      name: "vendor-access",
      auth: "workos",
      template: "vendor-access",
      packageManager: "npm",
    });

    const create = parseCli([
      "field-test",
      "create",
      "vendor-access",
      "--auth",
      "workos",
      "--template",
      "minimal-web",
      "--package-manager",
      "npm",
      "--json",
    ]);
    expect(create.errors).toEqual([]);
    expect(create.command).toMatchObject({
      kind: "field-test",
      subcommand: "create",
      name: "vendor-access",
      auth: "workos",
      template: "minimal-web",
      packageManager: "npm",
    });

    const run = parseCli([
      "field-test",
      "run",
      "--templates",
      "minimal-web,nuxt-web",
      "--package-managers",
      "npm,pnpm",
      "--runtime-probes",
      "--auth-probes",
      "--ui-probes",
      "--dry-run",
      "--json",
    ]);
    expect(run.errors).toEqual([]);
    expect(run.command).toMatchObject({
      kind: "field-test",
      subcommand: "run",
      runtimeProbes: true,
      authProbes: true,
      uiProbes: true,
      dryRun: true,
    });
    expect(run.command).toMatchObject({
      template: "minimal-web",
      packageManager: "npm",
      templates: ["minimal-web", "nuxt-web"],
      packageManagers: ["npm", "pnpm"],
    });

    const realistic = parseCli(["field-test", "run", "--realistic", "--json"]);
    expect(realistic.errors).toEqual([]);
    expect(realistic.command).toMatchObject({
      kind: "field-test",
      subcommand: "run",
      auth: "workos",
      template: "vendor-access",
      runtimeProbes: true,
      authProbes: true,
      uiProbes: true,
      realistic: true,
    });

    const report = parseCli(["field-test", "report", "--file", "field-report.json", "--json"]);
    expect(report.errors).toEqual([]);
    expect(report.command).toMatchObject({
      kind: "field-test",
      subcommand: "report",
      writeReport: "field-report.json",
    });
  });

  test("field-test create dry-run explains the generated app command", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-create");
    try {
      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "create",
        name: "vendor-access",
        auth: "workos",
        template: "minimal-web",
        packageManager: "npm",
        dryRun: true,
        keep: false,
        runtimeProbes: false,
        authProbes: false,
        uiProbes: false,
        realistic: false,
        timeoutMs: 180_000,
        json: true,
      });
      expect(result.ok).toBe(true);
      expect(JSON.stringify(result.data)).toContain("forge new vendor-access");
      expect(result.nextActions[0]).toContain("forge field-test create vendor-access");
      expect(result.nextActions[0]).toContain("--install --git");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("field-test run finds the packaged harness outside the app workspace", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-packaged-harness");
    try {
      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "run",
        template: "minimal-web",
        packageManager: "npm",
        dryRun: true,
        keep: false,
        runtimeProbes: false,
        authProbes: false,
        uiProbes: false,
        realistic: false,
        timeoutMs: 180_000,
        json: true,
      });

      expect(result.ok).toBe(true);
      expect(result.command?.[1]).toContain("scripts/field-test-forgeos.mjs");
      expect(JSON.stringify(result.data)).toContain("\"minimal-web\"");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("field-test report reads a machine-readable report", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-report");
    try {
      mkdirSync(join(workspace, "field-reports"), { recursive: true });
      writeFileSync(
        join(workspace, "field-reports", "full-alpha.json"),
        JSON.stringify({
          ok: true,
          authProbes: true,
          runtimeProbes: true,
          uiProbes: true,
          results: [{
            ok: true,
            template: "vendor-access",
            packageManager: "npm",
            steps: [
              { ok: true, command: "npm run forge -- add auth workos --json" },
              { ok: true, command: "npm run forge -- authmd generate --json" },
              { ok: true, command: "npm run forge -- authmd check --json" },
              { ok: true, command: "npm run forge -- workos doctor --json" },
              { ok: true, command: "npm run forge -- workos seed --file workos-seed.yml --dry-run --json" },
              { ok: true, command: "npm run forge -- workos prove --file workos-seed.yml --json" },
              { ok: true, command: "npm run forge -- auth prove --scenario multi-tenant --json" },
            ],
            uiErgonomics: {
              ok: true,
              warnings: 0,
              errors: 0,
              diagnosticCodes: [],
              scenarioNames: [
                "home-loads",
                "vendor-access-autoseed-data-visible",
                "vendor-access-local-login",
                "vendor-access-requester-denied-visible",
                "vendor-access-seed-control-visible",
              ],
            },
            runtime: {
              steps: [
                { ok: true, command: "GET /health" },
                { ok: true, command: "GET /entries" },
                { ok: true, command: "GET http://127.0.0.1:5173/" },
                { ok: true, command: "seed-status: npm run forge -- seed status --json", stdout: seedStatusStdout },
                { ok: true, command: "seed-dev: npm run forge -- seed dev --json" },
                { ok: true, command: "seed-reset: npm run forge -- seed reset --json" },
                { ok: true, command: "HEAD http://127.0.0.1:3765/auth.md" },
                { ok: true, command: "GET http://127.0.0.1:3765/auth.md" },
                { ok: true, command: "HEAD http://127.0.0.1:3765/.well-known/oauth-protected-resource" },
                { ok: true, command: "GET http://127.0.0.1:3765/.well-known/oauth-protected-resource" },
                { ok: true, command: "vendor-access-seed-all-tenants: npm run forge -- seed dev --all-tenants --json" },
                { ok: true, command: "vendor-access-query-acme: POST /queries/listVendorAccessDashboard" },
                { ok: true, command: "vendor-access-query-globex: POST /queries/listVendorAccessDashboard" },
                { ok: true, command: "vendor-access-owner-approve: POST /commands/approveAccessRequest" },
                { ok: true, command: "vendor-access-requester-approve-denied: POST /commands/approveAccessRequest" },
                { ok: true, command: "vendor-access-cross-tenant-approve-denied: POST /commands/approveAccessRequest" },
              ],
            },
          }],
        }),
        "utf8",
      );
      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "report",
        template: "minimal-web",
        packageManager: "npm",
        auth: "none",
        dryRun: false,
        keep: false,
        runtimeProbes: false,
        authProbes: false,
        uiProbes: false,
        realistic: false,
        timeoutMs: 180_000,
        writeReport: "field-reports/full-alpha.json",
        json: true,
      });
      expect(result.ok).toBe(true);
      expect(result.reportPath).toBe("field-reports/full-alpha.json");
      expect(result.summary).toMatchObject({
        ok: true,
        cases: 1,
        passed: 1,
        failed: 0,
        runtimeProbes: true,
        authProbes: true,
        uiProbes: true,
        uiErgonomics: true,
        uiErgonomicsWarnings: 0,
        uiErgonomicsErrors: 0,
        uiErgonomicsWarningCodes: [],
        uiScenarios: {
          vendorAccessReady: true,
          requiredVendorAccess: [
            "vendor-access-autoseed-data-visible",
            "vendor-access-local-login",
            "vendor-access-requester-denied-visible",
            "vendor-access-seed-control-visible",
          ],
        },
        runtimeProbeSteps: 16,
        seedProbeSteps: 4,
        seedReadiness: {
          ready: true,
          steps: 1,
          autoSeedOnDev: true,
          autoSeedAllTenantsOnDev: true,
          allTenantsAutoSeedReady: true,
          autoSeedModes: ["all-tenants"],
          selectedCommands: ["seedVendorAccessDemo"],
        },
        authSetupProbeSteps: 7,
        authMetadataProbeSteps: 4,
        uiProbeSteps: 1,
        vendorAccessProbeSteps: 6,
        productionEvidence: {
          readyForDeployCheck: true,
          missing: [],
          deployCheckCommand: "forge deploy check --production --json",
        },
      });
      expect(result.nextActions).toContain("forge deploy check --production --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("field-test report reads an absolute report path outside the workspace", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-absolute-report");
    const reportPath = join(tmpdir(), `forge-field-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    try {
      writeFileSync(
        reportPath,
        JSON.stringify({
          ok: true,
          authProbes: true,
          runtimeProbes: true,
          uiProbes: true,
          results: [{
            ok: true,
            template: "vendor-access",
            packageManager: "npm",
            uiErgonomics: { ok: true, warnings: 0, errors: 0 },
            runtime: { steps: [{ ok: true, command: "GET http://127.0.0.1:5173/" }] },
          }],
        }),
        "utf8",
      );

      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "report",
        template: "minimal-web",
        packageManager: "npm",
        auth: "none",
        dryRun: false,
        keep: false,
        runtimeProbes: false,
        authProbes: false,
        uiProbes: false,
        realistic: false,
        timeoutMs: 180_000,
        writeReport: reportPath,
        json: true,
      });

      expect(result.ok).toBe(true);
      expect(result.reportPath).toBe(reportPath);
      expect(result.summary).toMatchObject({ uiErgonomics: true, uiProbeSteps: 1 });
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("field-test report requires UI ergonomics evidence when UI probes ran", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-report-no-ergonomics");
    try {
      mkdirSync(join(workspace, "field-reports"), { recursive: true });
      writeFileSync(
        join(workspace, "field-reports", "ui-only.json"),
        JSON.stringify({
          ok: true,
          runtimeProbes: true,
          authProbes: true,
          uiProbes: true,
          results: [{
            ok: true,
            template: "minimal-web",
            packageManager: "npm",
            runtime: { steps: [{ ok: true, command: "GET http://127.0.0.1:5173/" }] },
          }],
        }),
        "utf8",
      );
      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "report",
        template: "minimal-web",
        packageManager: "npm",
        auth: "none",
        dryRun: false,
        keep: false,
        runtimeProbes: false,
        authProbes: false,
        uiProbes: false,
        realistic: false,
        timeoutMs: 180_000,
        writeReport: "field-reports/ui-only.json",
        json: true,
      });

      expect(result.summary).toMatchObject({
        uiErgonomics: false,
        productionEvidence: {
          readyForDeployCheck: false,
        },
      });
      expect(JSON.stringify(result.summary)).toContain("UI ergonomics audit");
      expect(JSON.stringify(result.summary)).toContain("auth setup probes");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("field-test report requires zero UI ergonomics warnings for deploy readiness", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-report-ui-warning");
    try {
      mkdirSync(join(workspace, "field-reports"), { recursive: true });
      writeFileSync(
        join(workspace, "field-reports", "ui-warning.json"),
        JSON.stringify({
          ok: true,
          authProbes: false,
          runtimeProbes: false,
          uiProbes: true,
          results: [{
            ok: true,
            template: "minimal-web",
            packageManager: "npm",
            uiErgonomics: {
              ok: true,
              warnings: 1,
              errors: 0,
              diagnosticCodes: ["FORGE_UI_PRODUCT_COPY_TOO_META"],
            },
            runtime: { steps: [{ ok: true, command: "GET http://127.0.0.1:5173/" }] },
          }],
        }),
        "utf8",
      );
      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "report",
        template: "minimal-web",
        packageManager: "npm",
        auth: "none",
        dryRun: false,
        keep: false,
        runtimeProbes: false,
        authProbes: false,
        uiProbes: false,
        realistic: false,
        timeoutMs: 180_000,
        writeReport: "field-reports/ui-warning.json",
        json: true,
      });

      expect(result.summary).toMatchObject({
        uiErgonomics: true,
        uiErgonomicsWarnings: 1,
        uiErgonomicsWarningCodes: ["FORGE_UI_PRODUCT_COPY_TOO_META"],
        productionEvidence: {
          readyForDeployCheck: false,
        },
      });
      expect(JSON.stringify(result.summary)).toContain("zero UI ergonomics warnings");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("field-test report requires vendor-access UI scenarios for deploy readiness", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-report-no-vendor-ui-scenarios");
    try {
      mkdirSync(join(workspace, "field-reports"), { recursive: true });
      writeFileSync(
        join(workspace, "field-reports", "vendor-no-ui-scenarios.json"),
        JSON.stringify({
          ok: true,
          authProbes: true,
          runtimeProbes: true,
          uiProbes: true,
          results: [{
            ok: true,
            template: "vendor-access",
            packageManager: "npm",
            steps: [
              { ok: true, command: "npm run forge -- add auth workos --json" },
              { ok: true, command: "npm run forge -- authmd generate --json" },
              { ok: true, command: "npm run forge -- authmd check --json" },
              { ok: true, command: "npm run forge -- workos doctor --json" },
              { ok: true, command: "npm run forge -- workos seed --json" },
              { ok: true, command: "npm run forge -- workos prove --file workos-seed.yml --json" },
              { ok: true, command: "npm run forge -- auth prove --json" },
            ],
            uiErgonomics: {
              ok: true,
              warnings: 0,
              errors: 0,
              scenarioNames: ["home-loads"],
            },
            runtime: {
              steps: [
                { ok: true, command: "GET /health" },
                { ok: true, command: "GET /entries" },
                { ok: true, command: "GET http://127.0.0.1:5173/" },
                { ok: true, command: "seed-status: npm run forge -- seed status --json", stdout: seedStatusStdout },
                { ok: true, command: "HEAD http://127.0.0.1:3765/auth.md" },
                { ok: true, command: "GET http://127.0.0.1:3765/auth.md" },
                { ok: true, command: "HEAD http://127.0.0.1:3765/.well-known/oauth-protected-resource" },
                { ok: true, command: "GET http://127.0.0.1:3765/.well-known/oauth-protected-resource" },
                { ok: true, command: "vendor-access-seed-all-tenants: npm run forge -- seed dev --all-tenants --json" },
                { ok: true, command: "vendor-access-query-acme: POST /queries/listVendorAccessDashboard" },
                { ok: true, command: "vendor-access-query-globex: POST /queries/listVendorAccessDashboard" },
                { ok: true, command: "vendor-access-owner-approve: POST /commands/approveAccessRequest" },
                { ok: true, command: "vendor-access-requester-approve-denied: POST /commands/approveAccessRequest" },
                { ok: true, command: "vendor-access-cross-tenant-approve-denied: POST /commands/approveAccessRequest" },
              ],
            },
          }],
        }),
        "utf8",
      );
      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "report",
        template: "vendor-access",
        packageManager: "npm",
        auth: "none",
        dryRun: false,
        keep: false,
        runtimeProbes: false,
        authProbes: false,
        uiProbes: false,
        realistic: false,
        timeoutMs: 180_000,
        writeReport: "field-reports/vendor-no-ui-scenarios.json",
        json: true,
      });

      expect(result.summary).toMatchObject({
        uiScenarios: {
          vendorAccessReady: false,
        },
        productionEvidence: {
          readyForDeployCheck: false,
        },
      });
      expect(JSON.stringify(result.summary)).toContain("vendor-access UI scenarios");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("field-test report requires vendor-access domain probes for deploy readiness", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-report-no-vendor-domain");
    try {
      mkdirSync(join(workspace, "field-reports"), { recursive: true });
      writeFileSync(
        join(workspace, "field-reports", "vendor-no-domain.json"),
        JSON.stringify({
          ok: true,
          runtimeProbes: true,
          authProbes: true,
          uiProbes: true,
          results: [{
            ok: true,
            template: "vendor-access",
            packageManager: "npm",
            steps: [
              { ok: true, command: "npm run forge -- add auth workos --json" },
              { ok: true, command: "npm run forge -- authmd generate --json" },
              { ok: true, command: "npm run forge -- authmd check --json" },
              { ok: true, command: "npm run forge -- workos doctor --json" },
              { ok: true, command: "npm run forge -- workos seed --json" },
              { ok: true, command: "npm run forge -- workos prove --file workos-seed.yml --json" },
              { ok: true, command: "npm run forge -- auth prove --json" },
            ],
            uiErgonomics: { ok: true, warnings: 0, errors: 0 },
            runtime: {
              steps: [
                { ok: true, command: "GET /health" },
                { ok: true, command: "GET /entries" },
                { ok: true, command: "GET http://127.0.0.1:5173/" },
                { ok: true, command: "HEAD http://127.0.0.1:3765/auth.md" },
                { ok: true, command: "GET http://127.0.0.1:3765/auth.md" },
                { ok: true, command: "HEAD http://127.0.0.1:3765/.well-known/oauth-protected-resource" },
                { ok: true, command: "GET http://127.0.0.1:3765/.well-known/oauth-protected-resource" },
              ],
            },
          }],
        }),
        "utf8",
      );
      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "report",
        template: "vendor-access",
        packageManager: "npm",
        auth: "none",
        dryRun: false,
        keep: false,
        runtimeProbes: false,
        authProbes: false,
        uiProbes: false,
        realistic: false,
        timeoutMs: 180_000,
        writeReport: "field-reports/vendor-no-domain.json",
        json: true,
      });

      expect(result.summary).toMatchObject({
        vendorAccessProbeSteps: 0,
        productionEvidence: {
          readyForDeployCheck: false,
        },
      });
      expect(JSON.stringify(result.summary)).toContain("vendor-access multi-tenant domain probes");
      expect(JSON.stringify(result.summary)).toContain("seed readiness evidence");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("field-test report requires vendor-access all-tenant auto-seed readiness", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-report-default-tenant-seed");
    try {
      mkdirSync(join(workspace, "field-reports"), { recursive: true });
      const defaultTenantSeedStatus = JSON.stringify({
        ok: true,
        readiness: {
          ready: true,
          autoSeedOnDev: true,
          autoSeedAllTenantsOnDev: false,
          autoSeedMode: "default-tenant",
          selectedCommand: "seedVendorAccessDemo",
          emptyWorkspaceRecovery: [
            "forge dev --seed --all-tenants",
            "forge seed dev --command seedVendorAccessDemo --all-tenants --json",
            "forge seed reset --command seedVendorAccessDemo --all-tenants --json",
          ],
        },
      });
      writeFileSync(
        join(workspace, "field-reports", "vendor-default-tenant-seed.json"),
        JSON.stringify({
          ok: true,
          runtimeProbes: true,
          authProbes: true,
          uiProbes: true,
          results: [{
            ok: true,
            template: "vendor-access",
            packageManager: "npm",
            steps: [
              { ok: true, command: "npm run forge -- add auth workos --json" },
              { ok: true, command: "npm run forge -- authmd generate --json" },
              { ok: true, command: "npm run forge -- authmd check --json" },
              { ok: true, command: "npm run forge -- workos doctor --json" },
              { ok: true, command: "npm run forge -- workos seed --json" },
              { ok: true, command: "npm run forge -- workos prove --file workos-seed.yml --json" },
              { ok: true, command: "npm run forge -- auth prove --json" },
            ],
            uiErgonomics: { ok: true, warnings: 0, errors: 0 },
            runtime: {
              steps: [
                { ok: true, command: "GET /health" },
                { ok: true, command: "GET /entries" },
                { ok: true, command: "GET http://127.0.0.1:5173/" },
                { ok: true, command: "HEAD http://127.0.0.1:3765/auth.md" },
                { ok: true, command: "GET http://127.0.0.1:3765/auth.md" },
                { ok: true, command: "HEAD http://127.0.0.1:3765/.well-known/oauth-protected-resource" },
                { ok: true, command: "GET http://127.0.0.1:3765/.well-known/oauth-protected-resource" },
                { ok: true, command: "seed-status: npm run forge -- seed status --json", stdout: defaultTenantSeedStatus },
                { ok: true, command: "vendor-access-seed-all-tenants: npm run forge -- seed dev --all-tenants --json" },
                { ok: true, command: "vendor-access-query-acme: POST /queries/listVendorAccessDashboard" },
                { ok: true, command: "vendor-access-query-globex: POST /queries/listVendorAccessDashboard" },
                { ok: true, command: "vendor-access-owner-approve: POST /commands/approveAccessRequest" },
                { ok: true, command: "vendor-access-requester-approve-denied: POST /commands/approveAccessRequest" },
                { ok: true, command: "vendor-access-cross-tenant-approve-denied: POST /commands/approveAccessRequest" },
              ],
            },
          }],
        }),
        "utf8",
      );
      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "report",
        template: "vendor-access",
        packageManager: "npm",
        auth: "none",
        dryRun: false,
        keep: false,
        runtimeProbes: false,
        authProbes: false,
        uiProbes: false,
        realistic: false,
        timeoutMs: 180_000,
        writeReport: "field-reports/vendor-default-tenant-seed.json",
        json: true,
      });

      expect(result.summary).toMatchObject({
        seedReadiness: {
          ready: true,
          allTenantsAutoSeedReady: false,
          autoSeedModes: ["default-tenant"],
        },
        vendorAccessProbeSteps: 6,
        productionEvidence: {
          readyForDeployCheck: false,
        },
      });
      expect(JSON.stringify(result.summary)).toContain("seed readiness all-tenants auto-seed evidence");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("field-test report distinguishes incomplete probe evidence from deploy readiness", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-report-incomplete");
    try {
      mkdirSync(join(workspace, "field-reports"), { recursive: true });
      writeFileSync(
        join(workspace, "field-reports", "local-only.json"),
        JSON.stringify({
          ok: true,
          runtimeProbes: true,
          authProbes: false,
          results: [{ ok: true, template: "minimal-web", packageManager: "npm", runtime: { steps: [{ ok: true }] } }],
        }),
        "utf8",
      );
      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "report",
        template: "minimal-web",
        packageManager: "npm",
        auth: "none",
        dryRun: false,
        keep: false,
        runtimeProbes: false,
        authProbes: false,
        uiProbes: false,
        realistic: false,
        timeoutMs: 180_000,
        writeReport: "field-reports/local-only.json",
        json: true,
      });
      expect(result.ok).toBe(true);
      expect(result.summary).toMatchObject({
        productionEvidence: {
          readyForDeployCheck: false,
        },
      });
      expect(JSON.stringify(result.summary)).toContain("auth probes");
      expect(JSON.stringify(result.summary)).toContain("ui probes");
      expect(JSON.stringify(result.summary)).toContain("runtime health probe");
      expect(JSON.stringify(result.summary)).toContain("runtime entries probe");
      expect(result.nextActions[0]).toContain("field-test run --realistic");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("field-test report missing file suggests a complete probe run", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-report-missing");
    try {
      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "report",
        template: "minimal-web",
        packageManager: "npm",
        auth: "none",
        dryRun: false,
        keep: false,
        runtimeProbes: false,
        authProbes: false,
        uiProbes: false,
        realistic: false,
        timeoutMs: 180_000,
        writeReport: "missing.json",
        json: true,
      });
      expect(result.ok).toBe(false);
      expect(result.nextActions[0]).toContain("--realistic");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("field-test run writes and summarizes the default report", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-run-report");
    try {
      mkdirSync(join(workspace, "scripts"), { recursive: true });
      writeFileSync(
        join(workspace, "scripts", "field-test-forgeos.mjs"),
        [
          "#!/usr/bin/env node",
          "import { mkdirSync, writeFileSync } from 'node:fs';",
          "import { dirname, resolve } from 'node:path';",
          "const args = process.argv.slice(2);",
          "const reportFlag = args.indexOf('--write-report');",
          "const seedStatusStdout = JSON.stringify({ ok: true, readiness: { ready: true, autoSeedOnDev: true, autoSeedAllTenantsOnDev: true, autoSeedMode: 'all-tenants', selectedCommand: 'seedVendorAccessDemo', emptyWorkspaceRecovery: ['npm run dev', 'forge seed dev --command seedVendorAccessDemo --all-tenants --json', 'forge seed reset --command seedVendorAccessDemo --all-tenants --json', 'forge seed dev --command seedVendorAccessDemo --json', 'forge seed reset --command seedVendorAccessDemo --json'] } });",
          "const report = { ok: true, authProbes: true, runtimeProbes: true, uiProbes: true, results: [{ ok: true, template: 'vendor-access', packageManager: 'npm', steps: [{ ok: true, command: 'npm run forge -- add auth workos --json' }, { ok: true, command: 'npm run forge -- authmd generate --json' }, { ok: true, command: 'npm run forge -- authmd check --json' }, { ok: true, command: 'npm run forge -- workos doctor --json' }, { ok: true, command: 'npm run forge -- workos seed --json' }, { ok: true, command: 'npm run forge -- workos prove --file workos-seed.yml --json' }, { ok: true, command: 'npm run forge -- auth prove --json' }], uiErgonomics: { ok: true, warnings: 0, errors: 0 }, runtime: { steps: [{ ok: true, command: 'GET /health' }, { ok: true, command: 'GET /entries' }, { ok: true, command: 'GET http://127.0.0.1:5173/' }, { ok: true, command: 'HEAD http://127.0.0.1:3765/auth.md' }, { ok: true, command: 'GET http://127.0.0.1:3765/auth.md' }, { ok: true, command: 'HEAD http://127.0.0.1:3765/.well-known/oauth-protected-resource' }, { ok: true, command: 'GET http://127.0.0.1:3765/.well-known/oauth-protected-resource' }, { ok: true, command: 'seed-status: npm run forge -- seed status --json', stdout: seedStatusStdout }, { ok: true, command: 'vendor-access-seed-all-tenants: npm run forge -- seed dev --all-tenants --json' }, { ok: true, command: 'vendor-access-query-acme: POST /queries/listVendorAccessDashboard' }, { ok: true, command: 'vendor-access-query-globex: POST /queries/listVendorAccessDashboard' }, { ok: true, command: 'vendor-access-owner-approve: POST /commands/approveAccessRequest' }, { ok: true, command: 'vendor-access-requester-approve-denied: POST /commands/approveAccessRequest' }, { ok: true, command: 'vendor-access-cross-tenant-approve-denied: POST /commands/approveAccessRequest' }] } }] };",
          "if (reportFlag !== -1) { const path = resolve(args[reportFlag + 1]); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2)); }",
          "console.log(JSON.stringify(report, null, 2));",
          "",
        ].join("\n"),
        "utf8",
      );
      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "run",
        template: "minimal-web",
        templates: ["minimal-web", "nuxt-web"],
        packageManager: "npm",
        packageManagers: ["npm", "pnpm"],
        auth: "none",
        dryRun: false,
        keep: false,
        runtimeProbes: true,
        authProbes: true,
        uiProbes: true,
        realistic: false,
        timeoutMs: 180_000,
        json: true,
      });
      expect(result.ok).toBe(true);
      expect(result.reportPath).toBe(".forge/field-test-report.json");
      expect(existsSync(join(workspace, ".forge/field-test-report.json"))).toBe(true);
      expect(result.summary).toMatchObject({
        ok: true,
        cases: 1,
        runtimeProbeSteps: 14,
        seedProbeSteps: 2,
        seedReadiness: {
          ready: true,
          steps: 1,
          autoSeedOnDev: true,
          autoSeedAllTenantsOnDev: true,
          allTenantsAutoSeedReady: true,
          autoSeedModes: ["all-tenants"],
          selectedCommands: ["seedVendorAccessDemo"],
        },
        authSetupProbeSteps: 7,
        authMetadataProbeSteps: 4,
        uiProbeSteps: 1,
        uiProbes: true,
        uiErgonomics: true,
        vendorAccessProbeSteps: 6,
      });
      expect(result.command?.join(" ")).toContain("--templates minimal-web,nuxt-web");
      expect(result.command?.join(" ")).toContain("--package-managers npm,pnpm");
      expect(result.nextActions[0]).toContain("field-test report --file .forge/field-test-report.json");
      expect(result.nextActions).toContain("forge deploy check --production --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("field-test dry-run preserves matrix next action", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-field-test-dry-run-matrix");
    try {
      mkdirSync(join(workspace, "scripts"), { recursive: true });
      writeFileSync(
        join(workspace, "scripts", "field-test-forgeos.mjs"),
        [
          "#!/usr/bin/env node",
          "const args = process.argv.slice(2);",
          "const templates = args[args.indexOf('--templates') + 1].split(',');",
          "const packageManagers = args[args.indexOf('--package-managers') + 1].split(',');",
          "const cases = templates.flatMap((template) => packageManagers.map((packageManager) => ({ template, packageManager })));",
          "console.log(JSON.stringify({ ok: true, runtimeProbes: true, authProbes: true, uiProbes: true, cases }, null, 2));",
          "",
        ].join("\n"),
        "utf8",
      );
      const result = await runFieldTestCommand({
        workspaceRoot: workspace,
        subcommand: "run",
        template: "minimal-web",
        templates: ["minimal-web", "nuxt-web"],
        packageManager: "npm",
        packageManagers: ["npm", "pnpm"],
        auth: "none",
        dryRun: true,
        keep: false,
        runtimeProbes: true,
        authProbes: true,
        uiProbes: true,
        realistic: false,
        timeoutMs: 180_000,
        json: true,
      });
      expect(result.ok).toBe(true);
      expect(result.nextActions[0]).toContain("--templates minimal-web,nuxt-web");
      expect(result.nextActions[0]).toContain("--package-managers npm,pnpm");
      expect(result.summary).toMatchObject({
        cases: 4,
        plannedCases: 4,
        executedCases: 0,
      });
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
