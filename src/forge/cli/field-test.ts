import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runNewCommand, type NewPackageManager, type NewTemplateName } from "./new.ts";
import { normalizeForgeCliCommandsInValue } from "../workspace/forge-cli.ts";

export type FieldTestSubcommand = "create" | "run" | "report";

export interface FieldTestCommandOptions {
  subcommand: FieldTestSubcommand;
  workspaceRoot: string;
  json: boolean;
  name?: string;
  template: NewTemplateName;
  templates?: NewTemplateName[];
  packageManager: NewPackageManager;
  packageManagers?: NewPackageManager[];
  forgeSpec?: string;
  auth?: "none" | "workos";
  dryRun: boolean;
  keep: boolean;
  runtimeProbes: boolean;
  authProbes: boolean;
  timeoutMs: number;
  writeReport?: string;
}

export interface FieldTestCommandResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  kind: "field-test";
  action: FieldTestSubcommand;
  data?: unknown;
  summary?: unknown;
  command?: string[];
  reportPath?: string;
  stdout?: string;
  stderr?: string;
  nextActions: string[];
  exitCode: 0 | 1;
}

function scriptPath(workspaceRoot: string): string {
  return join(workspaceRoot, "scripts", "field-test-forgeos.mjs");
}

function compact(text: string, limit = 12000): string {
  if (text.length <= limit) return text;
  const half = Math.floor(limit / 2);
  return `${text.slice(0, half)}\n...[truncated ${text.length - limit} chars]...\n${text.slice(-half)}`;
}

function defaultReportPath(): string {
  return ".forge/field-test-report.json";
}

function parseJsonOutput(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

function summarizeReport(data: unknown) {
  const root = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const results = Array.isArray(root.results) ? root.results as Array<Record<string, unknown>> : [];
  const plannedCases = Array.isArray(root.cases) ? root.cases as Array<Record<string, unknown>> : [];
  const failed = results.filter((result) => result.ok === false && result.skipped !== true);
  const skipped = results.filter((result) => result.skipped === true);
  const runtimeProbeSteps = results.flatMap((result) => {
    const runtime = result.runtime && typeof result.runtime === "object"
      ? result.runtime as Record<string, unknown>
      : {};
    return Array.isArray(runtime.steps) ? runtime.steps as unknown[] : [];
  });
  const ok = root.ok === true;
  const runtimeProbes = root.runtimeProbes === true;
  const authProbes = root.authProbes === true;
  const productionEvidenceMissing = [
    ...(!ok ? ["passing field-test report"] : []),
    ...(!runtimeProbes ? ["runtime probes"] : []),
    ...(!authProbes ? ["auth probes"] : []),
    ...(failed.length > 0 ? ["zero failed cases"] : []),
  ];
  return {
    ok,
    cases: results.length || plannedCases.length,
    executedCases: results.length,
    plannedCases: plannedCases.length,
    passed: results.filter((result) => result.ok === true && result.skipped !== true).length,
    failed: failed.length,
    skipped: skipped.length,
    runtimeProbes,
    authProbes,
    runtimeProbeSteps: runtimeProbeSteps.length,
    productionEvidence: {
      readyForDeployCheck: productionEvidenceMissing.length === 0,
      missing: productionEvidenceMissing,
      deployCheckCommand: "forge deploy check --production --json",
      note: "This proves field-test evidence only; deploy check still validates production auth, database, metadata, lockfile, and tenant posture.",
    },
    failedCases: failed.map((result) => ({
      template: result.template,
      packageManager: result.packageManager,
      reason: result.reason,
    })),
  };
}

function runCommandForOptions(templates: NewTemplateName[], packageManagers: NewPackageManager[]): string {
  return [
    "forge field-test run",
    `--templates ${templates.join(",")}`,
    `--package-managers ${packageManagers.join(",")}`,
    "--runtime-probes",
    "--auth-probes",
    "--json",
  ].join(" ");
}

async function createFieldTestApp(options: FieldTestCommandOptions): Promise<FieldTestCommandResult> {
  if (!options.name) {
    return {
      schemaVersion: "0.1.0",
      ok: false,
      kind: "field-test",
      action: "create",
      data: { error: "forge field-test create requires an app name" },
      nextActions: ["forge field-test create vendor-access --auth workos --template minimal-web --json"],
      exitCode: 1,
    };
  }
  if (options.dryRun) {
    return normalizeForgeCliCommandsInValue(options.workspaceRoot, {
      schemaVersion: "0.1.0",
      ok: true,
      kind: "field-test",
      action: "create",
      data: {
        dryRun: true,
        name: options.name,
        template: options.template,
        packageManager: options.packageManager,
        auth: options.auth,
        command: `forge new ${options.name} --template ${options.template} --package-manager ${options.packageManager} --field-test --install`,
      },
      nextActions: [`forge new ${options.name} --template ${options.template} --package-manager ${options.packageManager} --field-test --install`],
      exitCode: 0,
    });
  }
  const created = await runNewCommand({
    name: options.name,
    template: options.template,
    packageManager: options.packageManager,
    install: true,
    git: true,
    fieldTest: options.auth === "workos",
    forgePackageSpec: options.forgeSpec,
    workspaceRoot: options.workspaceRoot,
  });
  const createdFieldTest = created.fieldTest?.steps ?? [];
  return normalizeForgeCliCommandsInValue(options.workspaceRoot, {
    schemaVersion: "0.1.0",
    ok: created.exitCode === 0,
    kind: "field-test",
    action: "create",
    data: {
      ...created,
      auth: options.auth,
      setup: options.auth === "workos"
        ? {
            applied: createdFieldTest.length > 0 && createdFieldTest.every((step) => step.ok),
            steps: createdFieldTest,
          }
        : {
            applied: false,
            steps: [],
            note: "auth=none creates a plain app; pass --auth workos for WorkOS/AuthKit/auth.md field-test setup.",
          },
    },
    nextActions: [
      `cd ${created.targetDir}`,
      `${options.packageManager} run forge -- agent onboard --target codex --json`,
      `${options.packageManager} run forge -- generate`,
      `${options.packageManager} run forge -- check --json`,
      ...(options.auth === "workos"
        ? [
            `${options.packageManager} run forge -- authmd check --json`,
            `${options.packageManager} run forge -- workos doctor --json`,
            `${options.packageManager} run forge -- workos seed --file workos-seed.yml --dry-run --json`,
            `${options.packageManager} run forge -- workos setup --file workos-seed.yml --json`,
          ]
        : []),
      `${options.packageManager} run forge -- dev --once --json`,
      `${options.packageManager} run forge -- verify --smoke --json`,
      `${options.packageManager} run forge -- handoff --json`,
    ],
    exitCode: created.exitCode,
  });
}

function runHarness(options: FieldTestCommandOptions): FieldTestCommandResult {
  const script = scriptPath(options.workspaceRoot);
  if (!existsSync(script)) {
    return {
      schemaVersion: "0.1.0",
      ok: false,
      kind: "field-test",
      action: "run",
      data: { error: "field-test harness script not found", script },
      nextActions: ["run from the ForgeOS framework checkout or use npm run field:test"],
      exitCode: 1,
    };
  }
  const reportPath = options.writeReport ?? (options.dryRun ? undefined : defaultReportPath());
  const templates = options.templates?.length ? options.templates : [options.template];
  const packageManagers = options.packageManagers?.length ? options.packageManagers : [options.packageManager];
  const args = [
    script,
    "--templates",
    templates.join(","),
    "--package-managers",
    packageManagers.join(","),
    "--timeout-ms",
    String(options.timeoutMs),
  ];
  if (options.dryRun) args.push("--dry-run");
  if (options.keep) args.push("--keep");
  if (options.runtimeProbes) args.push("--runtime-probes");
  if (options.authProbes) args.push("--auth-probes");
  if (options.forgeSpec) args.push("--forge-spec", options.forgeSpec);
  if (reportPath) args.push("--write-report", reportPath);
  if (options.json) args.push("--json");
  const result = spawnSync(process.execPath, args, {
    cwd: options.workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  const reportAbsolute = reportPath ? join(options.workspaceRoot, reportPath) : null;
  const reportData = reportAbsolute && existsSync(reportAbsolute)
    ? JSON.parse(readFileSync(reportAbsolute, "utf8")) as unknown
    : parseJsonOutput(result.stdout ?? "");
  return normalizeForgeCliCommandsInValue(options.workspaceRoot, {
    schemaVersion: "0.1.0",
    ok: result.status === 0,
    kind: "field-test",
    action: "run",
    command: [process.execPath, ...args],
    reportPath,
    data: reportData ?? undefined,
    summary: reportData ? summarizeReport(reportData) : undefined,
    stdout: compact(result.stdout ?? ""),
    stderr: compact(result.stderr ?? ""),
    nextActions: result.status === 0
      ? options.dryRun
        ? [runCommandForOptions(templates, packageManagers)]
        : [`forge field-test report --file ${reportPath ?? defaultReportPath()} --json`, "forge deploy check --production --json"]
      : ["inspect field-test stdout/stderr", "forge doctor pglite --json"],
    exitCode: result.status === 0 ? 0 : 1,
  });
}

function readReport(options: FieldTestCommandOptions): FieldTestCommandResult {
  const candidates = [
    options.writeReport,
    ".forge/field-test-report.json",
    "field-reports/full-alpha.json",
  ].filter(Boolean) as string[];
  const report = candidates.find((candidate) => existsSync(join(options.workspaceRoot, candidate)));
  if (!report) {
    return {
      schemaVersion: "0.1.0",
      ok: false,
      kind: "field-test",
      action: "report",
      data: { searched: candidates },
      nextActions: ["forge field-test run --runtime-probes --auth-probes --write-report .forge/field-test-report.json --json"],
      exitCode: 1,
    };
  }
  const data = JSON.parse(readFileSync(join(options.workspaceRoot, report), "utf8")) as unknown;
  const summary = summarizeReport(data);
  const productionEvidence = (summary as { productionEvidence?: { readyForDeployCheck?: boolean } }).productionEvidence;
  return {
    schemaVersion: "0.1.0",
    ok: (data && typeof data === "object" && "ok" in data) ? (data as { ok?: unknown }).ok === true : true,
    kind: "field-test",
    action: "report",
    reportPath: report,
    summary,
    data,
    nextActions: productionEvidence?.readyForDeployCheck
      ? ["forge deploy check --production --json"]
      : ["forge field-test run --runtime-probes --auth-probes --write-report .forge/field-test-report.json --json"],
    exitCode: (data && typeof data === "object" && "ok" in data && (data as { ok?: unknown }).ok !== true) ? 1 : 0,
  };
}

export async function runFieldTestCommand(options: FieldTestCommandOptions): Promise<FieldTestCommandResult> {
  if (options.subcommand === "create") return createFieldTestApp(options);
  if (options.subcommand === "run") return runHarness(options);
  return readReport(options);
}

export function formatFieldTestJson(result: FieldTestCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatFieldTestHuman(result: FieldTestCommandResult): string {
  const lines = [
    `field-test ${result.action} ${result.ok ? "ok" : "failed"}`,
    ...(result.reportPath ? [`report: ${result.reportPath}`] : []),
    ...(result.command ? [`command: ${result.command.join(" ")}`] : []),
    ...(result.stdout ? ["", result.stdout] : []),
    ...(result.stderr ? ["", result.stderr] : []),
    ...(result.nextActions.length ? ["", "Next:", ...result.nextActions.map((action) => `  ${action}`)] : []),
  ];
  return `${lines.join("\n")}\n`;
}
