import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runFieldTestCommand } from "../../src/forge/cli/field-test.ts";
import { cleanupWorkspace, scaffoldGenerateWorkspace } from "../orchestrator/helpers.ts";

describe("forge field-test", () => {
  test("parseCli accepts field-test create, run, and report", () => {
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
      "--dry-run",
      "--json",
    ]);
    expect(run.errors).toEqual([]);
    expect(run.command).toMatchObject({
      kind: "field-test",
      subcommand: "run",
      runtimeProbes: true,
      authProbes: true,
      dryRun: true,
    });
    expect(run.command).toMatchObject({
      template: "minimal-web",
      packageManager: "npm",
      templates: ["minimal-web", "nuxt-web"],
      packageManagers: ["npm", "pnpm"],
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
        timeoutMs: 180_000,
        json: true,
      });
      expect(result.ok).toBe(true);
      expect(JSON.stringify(result.data)).toContain("forge new vendor-access");
      expect(result.nextActions[0]).toContain("forge new vendor-access");
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
        runtimeProbeSteps: 1,
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
        timeoutMs: 180_000,
        writeReport: "field-reports/local-only.json",
        json: true,
      });
      expect(result.ok).toBe(true);
      expect(result.summary).toMatchObject({
        productionEvidence: {
          readyForDeployCheck: false,
          missing: ["auth probes"],
        },
      });
      expect(result.nextActions[0]).toContain("field-test run --runtime-probes --auth-probes");
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
        timeoutMs: 180_000,
        writeReport: "missing.json",
        json: true,
      });
      expect(result.ok).toBe(false);
      expect(result.nextActions[0]).toContain("--runtime-probes --auth-probes");
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
          "const report = { ok: true, authProbes: true, runtimeProbes: true, results: [{ ok: true, template: 'minimal-web', packageManager: 'npm', runtime: { steps: [{ ok: true }, { ok: true }] } }] };",
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
        timeoutMs: 180_000,
        json: true,
      });
      expect(result.ok).toBe(true);
      expect(result.reportPath).toBe(".forge/field-test-report.json");
      expect(existsSync(join(workspace, ".forge/field-test-report.json"))).toBe(true);
      expect(result.summary).toMatchObject({
        ok: true,
        cases: 1,
        runtimeProbeSteps: 2,
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
          "console.log(JSON.stringify({ ok: true, runtimeProbes: true, authProbes: true, cases }, null, 2));",
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
