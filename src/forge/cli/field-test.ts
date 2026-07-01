import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  uiProbes: boolean;
  realistic: boolean;
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

function scriptCandidates(workspaceRoot: string): string[] {
  const localScript = join(workspaceRoot, "scripts", "field-test-forgeos.mjs");
  const packageScript = join(dirname(fileURLToPath(import.meta.url)), "../../../scripts/field-test-forgeos.mjs");
  return Array.from(new Set([localScript, packageScript]));
}

function scriptPath(workspaceRoot: string): string | null {
  return scriptCandidates(workspaceRoot).find((candidate) => existsSync(candidate)) ?? null;
}

function compact(text: string, limit = 12000): string {
  if (text.length <= limit) return text;
  const half = Math.floor(limit / 2);
  return `${text.slice(0, half)}\n...[truncated ${text.length - limit} chars]...\n${text.slice(-half)}`;
}

function defaultReportPath(): string {
  return ".forge/field-test-report.json";
}

function resolveReportPath(workspaceRoot: string, reportPath: string): string {
  return isAbsolute(reportPath) ? reportPath : join(workspaceRoot, reportPath);
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
  const topLevelSteps = results.flatMap((result) =>
    Array.isArray(result.steps) ? result.steps as unknown[] : [],
  );
  const runtimeProbeSteps = results.flatMap((result) => {
    const runtime = result.runtime && typeof result.runtime === "object"
      ? result.runtime as Record<string, unknown>
      : {};
    return Array.isArray(runtime.steps) ? runtime.steps as unknown[] : [];
  });
  const hasVendorAccessCase = results.some((result) => result.template === "vendor-access");
  const commandOf = (step: unknown): string =>
    step && typeof step === "object" && typeof (step as { command?: unknown }).command === "string"
      ? (step as { command: string }).command
      : "";
  const stdoutOf = (step: unknown): string =>
    step && typeof step === "object" && typeof (step as { stdout?: unknown }).stdout === "string"
      ? (step as { stdout: string }).stdout
      : "";
  const okStep = (step: unknown): boolean =>
    Boolean(step && typeof step === "object" && (step as { ok?: unknown }).ok === true);
  const jsonOfStep = (step: unknown): Record<string, unknown> | null => {
    const stdout = stdoutOf(step).trim();
    if (!stdout) return null;
    const parsed = parseJsonOutput(stdout);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  };
  const hasOkRuntimeCommand = (pattern: RegExp): boolean =>
    runtimeProbeSteps.some((step) => okStep(step) && pattern.test(commandOf(step)));
  const hasOkTopLevelCommand = (pattern: RegExp): boolean =>
    topLevelSteps.some((step) => okStep(step) && pattern.test(commandOf(step)));
  const seedProbeSteps = runtimeProbeSteps.filter((step) => commandOf(step).includes("seed-"));
  const seedReadinessSteps = runtimeProbeSteps.filter((step) => commandOf(step).includes("seed-status"));
  const seedReadinessResults = seedReadinessSteps
    .filter((step) => okStep(step))
    .map((step) => {
      const payload = jsonOfStep(step);
      const readiness = payload?.readiness && typeof payload.readiness === "object"
        ? payload.readiness as Record<string, unknown>
        : {};
      const recovery = Array.isArray(readiness.emptyWorkspaceRecovery)
        ? readiness.emptyWorkspaceRecovery.filter((item) => typeof item === "string")
        : [];
      return {
        ready: readiness.ready === true,
        autoSeedOnDev: readiness.autoSeedOnDev === true,
        autoSeedAllTenantsOnDev: readiness.autoSeedAllTenantsOnDev === true,
        autoSeedMode: typeof readiness.autoSeedMode === "string" ? readiness.autoSeedMode : undefined,
        selectedCommand: typeof readiness.selectedCommand === "string" ? readiness.selectedCommand : undefined,
        recoveryCommands: recovery.length,
      };
    });
  const seedReadinessEvidence = !hasVendorAccessCase || seedReadinessResults.some((result) =>
    result.ready &&
    result.selectedCommand === "seedVendorAccessDemo" &&
    result.recoveryCommands >= 2,
  );
  const seedAllTenantsAutoSeedEvidence = !hasVendorAccessCase || seedReadinessResults.some((result) =>
    result.ready &&
    result.selectedCommand === "seedVendorAccessDemo" &&
    (result.autoSeedMode === "all-tenants" || result.autoSeedAllTenantsOnDev),
  );
  const vendorAccessProbeSteps = runtimeProbeSteps.filter((step) => commandOf(step).includes("vendor-access-"));
  const uiProbeSteps = runtimeProbeSteps.filter((step) => /^GET\s+https?:\/\/[^/]+\/$/i.test(commandOf(step)));
  const authMetadataProbeSteps = runtimeProbeSteps.filter((step) =>
    /^(HEAD|GET)\s+https?:\/\/[^/]+\/(auth\.md|\.well-known\/oauth-protected-resource)\b/i.test(commandOf(step)),
  );
  const authSetupProbeSteps = topLevelSteps.filter((step) =>
    /forge\s+(?:--\s+)?(add\s+auth\s+workos|authmd\s+generate|authmd\s+check|workos\s+doctor|workos\s+seed|workos\s+prove|auth\s+prove)/.test(commandOf(step)),
  );
  const uiErgonomicsResults = results
    .map((result) => result.uiErgonomics)
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"));
  const uiErgonomicsWarnings = uiErgonomicsResults.reduce((total, result) =>
    total + (typeof result.warnings === "number" ? result.warnings : 0), 0);
  const uiErgonomicsErrors = uiErgonomicsResults.reduce((total, result) =>
    total + (typeof result.errors === "number" ? result.errors : 0), 0);
  const uiErgonomicsWarningCodes = Array.from(new Set(uiErgonomicsResults.flatMap((result) =>
    Array.isArray(result.diagnosticCodes)
      ? result.diagnosticCodes.filter((code): code is string => typeof code === "string")
      : [],
  ))).sort();
  const uiScenarioNames = Array.from(new Set(uiErgonomicsResults.flatMap((result) =>
    Array.isArray(result.scenarioNames)
      ? result.scenarioNames.filter((name): name is string => typeof name === "string")
      : [],
  ))).sort();
  const vendorAccessRequiredUiScenarios = [
    "vendor-access-autoseed-data-visible",
    "vendor-access-local-login",
    "vendor-access-requester-denied-visible",
    "vendor-access-seed-control-visible",
  ];
  const ok = root.ok === true;
  const runtimeProbes = root.runtimeProbes === true;
  const authProbes = root.authProbes === true;
  const uiProbes = root.uiProbes === true;
  const uiErgonomics = !uiProbes || (results.length > 0 && uiErgonomicsResults.length === results.filter((result) => result.skipped !== true).length);
  const runtimeHealthEvidence = !runtimeProbes || hasOkRuntimeCommand(/\bGET\s+.*\/health\b/i);
  const runtimeEntriesEvidence = !runtimeProbes || hasOkRuntimeCommand(/\bGET\s+.*\/entries\b/i);
  const authSetupEvidence = !authProbes || [
    /forge\s+(?:--\s+)?add\s+auth\s+workos\b/,
    /forge\s+(?:--\s+)?authmd\s+generate\b/,
    /forge\s+(?:--\s+)?authmd\s+check\b/,
    /forge\s+(?:--\s+)?workos\s+doctor\b/,
    /forge\s+(?:--\s+)?workos\s+seed\b/,
    /forge\s+(?:--\s+)?workos\s+prove\b/,
    /forge\s+(?:--\s+)?auth\s+prove\b/,
  ].every((pattern) => hasOkTopLevelCommand(pattern));
  const authMetadataEvidence = !authProbes || [
    /^HEAD\s+.*\/auth\.md\b/i,
    /^GET\s+.*\/auth\.md\b/i,
    /^HEAD\s+.*\/\.well-known\/oauth-protected-resource\b/i,
    /^GET\s+.*\/\.well-known\/oauth-protected-resource\b/i,
  ].every((pattern) => hasOkRuntimeCommand(pattern));
  const uiProbeEvidence = !uiProbes || uiProbeSteps.some((step) => okStep(step));
  const vendorAccessSeedEvidence = !hasVendorAccessCase ||
    hasOkRuntimeCommand(/vendor-access-seed-all-tenants:/) ||
    [
      /vendor-access-seed-acme:/,
      /vendor-access-seed-globex:/,
    ].every((pattern) => hasOkRuntimeCommand(pattern));
  const vendorAccessEvidence = !hasVendorAccessCase || (
    vendorAccessSeedEvidence &&
    [
      /vendor-access-query-acme:/,
      /vendor-access-query-globex:/,
      /vendor-access-owner-approve:/,
      /vendor-access-requester-approve-denied:/,
      /vendor-access-cross-tenant-approve-denied:/,
    ].every((pattern) => hasOkRuntimeCommand(pattern))
  );
  const vendorAccessUiScenarioEvidence = !hasVendorAccessCase || !uiProbes ||
    vendorAccessRequiredUiScenarios.every((scenario) => uiScenarioNames.includes(scenario));
  const productionEvidenceMissing = [
    ...(!ok ? ["passing field-test report"] : []),
    ...(!runtimeProbes ? ["runtime probes"] : []),
    ...(!authProbes ? ["auth probes"] : []),
    ...(!uiProbes ? ["ui probes"] : []),
    ...(!runtimeHealthEvidence ? ["runtime health probe"] : []),
    ...(!runtimeEntriesEvidence ? ["runtime entries probe"] : []),
    ...(!authSetupEvidence ? ["auth setup probes"] : []),
    ...(!authMetadataEvidence ? ["auth metadata endpoint probes"] : []),
    ...(!uiProbeEvidence ? ["web UI probe"] : []),
    ...(!seedReadinessEvidence ? ["seed readiness evidence"] : []),
    ...(!seedAllTenantsAutoSeedEvidence ? ["seed readiness all-tenants auto-seed evidence"] : []),
    ...(!vendorAccessEvidence ? ["vendor-access multi-tenant domain probes"] : []),
    ...(!vendorAccessUiScenarioEvidence ? ["vendor-access UI scenarios"] : []),
    ...(!uiErgonomics ? ["UI ergonomics audit"] : []),
    ...(uiErgonomicsWarnings > 0 ? ["zero UI ergonomics warnings"] : []),
    ...(uiErgonomicsErrors > 0 ? ["zero UI ergonomics errors"] : []),
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
    uiProbes,
    uiErgonomics,
    uiErgonomicsWarnings,
    uiErgonomicsErrors,
    uiErgonomicsWarningCodes,
    uiScenarios: {
      names: uiScenarioNames,
      vendorAccessReady: vendorAccessUiScenarioEvidence,
      requiredVendorAccess: hasVendorAccessCase ? vendorAccessRequiredUiScenarios : [],
    },
    runtimeProbeSteps: runtimeProbeSteps.length,
    seedProbeSteps: seedProbeSteps.length,
    seedReadiness: {
      ready: seedReadinessEvidence,
      steps: seedReadinessSteps.length,
      autoSeedOnDev: seedReadinessResults.some((result) => result.autoSeedOnDev),
      autoSeedAllTenantsOnDev: seedReadinessResults.some((result) => result.autoSeedAllTenantsOnDev),
      allTenantsAutoSeedReady: seedAllTenantsAutoSeedEvidence,
      autoSeedModes: Array.from(new Set(seedReadinessResults
        .map((result) => result.autoSeedMode)
        .filter((value): value is string => Boolean(value)))),
      selectedCommands: Array.from(new Set(seedReadinessResults
        .map((result) => result.selectedCommand)
        .filter((value): value is string => Boolean(value)))),
    },
    authSetupProbeSteps: authSetupProbeSteps.length,
    authMetadataProbeSteps: authMetadataProbeSteps.length,
    uiProbeSteps: uiProbeSteps.length,
    vendorAccessProbeSteps: vendorAccessProbeSteps.length,
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
    "forge field-test run --realistic",
    `--templates ${templates.join(",")}`,
    `--package-managers ${packageManagers.join(",")}`,
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
      nextActions: ["forge field-test create vendor-access --auth workos --json"],
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
        install: true,
        git: true,
        command: `forge new ${options.name} --template ${options.template} --package-manager ${options.packageManager} --field-test --install`,
        goldenPath: [
          `forge field-test create ${options.name} --auth ${options.auth ?? "none"} --template ${options.template} --package-manager ${options.packageManager} --install --git --json`,
          `cd ${options.name}`,
          "forge field-test run --realistic --json",
          "forge field-test report --json",
          "forge deploy plan --target docker --json",
          "forge deploy check --production --json",
        ],
      },
      nextActions: [
        `forge field-test create ${options.name} --auth ${options.auth ?? "none"} --template ${options.template} --package-manager ${options.packageManager} --install --git --json`,
      ],
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
            `${options.packageManager} run forge -- workos prove --file workos-seed.yml --json`,
            `${options.packageManager} run forge -- workos setup --file workos-seed.yml --json`,
          ]
        : []),
      `${options.packageManager} run forge -- field-test run --realistic --json`,
      `${options.packageManager} run forge -- field-test report --json`,
      `${options.packageManager} run forge -- dev --once --json`,
      `${options.packageManager} run forge -- verify --smoke --json`,
      `${options.packageManager} run forge -- handoff --json`,
    ],
    exitCode: created.exitCode,
  });
}

function shouldEmitProgress(): boolean {
  return process.env.FORGE_FIELD_TEST_PROGRESS !== "0";
}

function runHarnessProcess(
  options: FieldTestCommandOptions,
  args: string[],
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const emitProgress = shouldEmitProgress();
    const child = spawn(process.execPath, args, {
      cwd: options.workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    const heartbeat = emitProgress
      ? setInterval(() => {
          const elapsed = Math.round((Date.now() - startedAt) / 1000);
          process.stderr.write(`[forge] field-test still running after ${elapsed}s; timeout=${options.timeoutMs}ms\n`);
        }, 30_000)
      : undefined;
    const finish = (status: number | null, extraStderr = "") => {
      if (settled) return;
      settled = true;
      if (heartbeat) clearInterval(heartbeat);
      if (extraStderr) stderr += extraStderr;
      resolve({ status, stdout, stderr });
    };
    child.on("error", (error) => {
      finish(1, `${error.message}\n`);
    });
    child.on("close", (status) => {
      finish(status);
    });
  });
}

async function runHarness(options: FieldTestCommandOptions): Promise<FieldTestCommandResult> {
  const script = scriptPath(options.workspaceRoot);
  if (!script) {
    return {
      schemaVersion: "0.1.0",
      ok: false,
      kind: "field-test",
      action: "run",
      data: { error: "field-test harness script not found", searched: scriptCandidates(options.workspaceRoot) },
      nextActions: ["upgrade forgeos to a version that includes scripts/field-test-forgeos.mjs", "run from the ForgeOS framework checkout with npm run field:test"],
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
  if (options.runtimeProbes || options.realistic) args.push("--runtime-probes");
  if (options.authProbes || options.realistic) args.push("--auth-probes");
  if (options.uiProbes || options.realistic) args.push("--ui-probes");
  if (options.forgeSpec) args.push("--forge-spec", options.forgeSpec);
  if (reportPath) args.push("--write-report", reportPath);
  if (options.json) args.push("--json");
  const result = await runHarnessProcess(options, args);
  const reportAbsolute = reportPath ? resolveReportPath(options.workspaceRoot, reportPath) : null;
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
  const report = candidates.find((candidate) => existsSync(resolveReportPath(options.workspaceRoot, candidate)));
  if (!report) {
    return {
      schemaVersion: "0.1.0",
      ok: false,
      kind: "field-test",
      action: "report",
      data: { searched: candidates },
      nextActions: ["forge field-test run --realistic --write-report .forge/field-test-report.json --json"],
      exitCode: 1,
    };
  }
  const data = JSON.parse(readFileSync(resolveReportPath(options.workspaceRoot, report), "utf8")) as unknown;
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
      : ["forge field-test run --realistic --write-report .forge/field-test-report.json --json"],
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
