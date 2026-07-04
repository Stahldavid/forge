import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeForgeCliCommandsInValue } from "../workspace/forge-cli.ts";
import { runDeployCommand, type DeployCommandResult, type DeployTarget } from "./deploy.ts";
import { runFieldTestCommand, type FieldTestCommandResult } from "./field-test.ts";
import { runWorkOSCommand, type WorkOSCommandResult } from "./workos.ts";
import type { NewPackageManager, NewTemplateName } from "./new.ts";

export type GoldenPathSubcommand = "plan" | "status";

export interface GoldenPathCommandOptions {
  subcommand: GoldenPathSubcommand;
  workspaceRoot: string;
  json: boolean;
  name: string;
  template: NewTemplateName;
  packageManager: NewPackageManager;
  forgeSpec?: string;
  auth: "none" | "workos";
  target: DeployTarget;
  production: boolean;
  real: boolean;
  clientId?: string;
  url?: string;
}

export interface GoldenPathStage {
  id: string;
  title: string;
  purpose: string;
  commands: string[];
  proves: string[];
  status?: "passed" | "blocked" | "missing" | "skipped";
  evidence?: unknown;
  nextCommand?: string | null;
}

export type GoldenPathWorkOSCheckSummary = Pick<WorkOSCommandResult, "ok" | "kind" | "checks" | "data" | "exitCode">;
export type GoldenPathFieldTestCheckSummary = Pick<FieldTestCommandResult, "ok" | "kind" | "action" | "summary" | "reportPath" | "nextActions" | "exitCode">;
export type GoldenPathDeployCheckSummary = Pick<DeployCommandResult, "ok" | "kind" | "action" | "readiness" | "nextActions" | "exitCode">;

export interface GoldenPathCommandResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  kind: "golden-path";
  action: GoldenPathSubcommand;
  target: DeployTarget;
  auth: "none" | "workos";
  production: boolean;
  real: boolean;
  summary: {
    canPublish: boolean;
    currentStage: string;
    nextCommand: string | null;
    blockers: string[];
  };
  stages: GoldenPathStage[];
  checks?: {
    workos?: GoldenPathWorkOSCheckSummary;
    workosEnv?: GoldenPathWorkOSCheckSummary;
    fieldTest?: GoldenPathFieldTestCheckSummary;
    deploy?: GoldenPathDeployCheckSummary;
  };
  nextActions: string[];
  exitCode: 0 | 1;
}

function appCommand(options: GoldenPathCommandOptions, command: string): string {
  return command.startsWith("npm run forge --") || command.startsWith("forge ")
    ? command
    : `${options.packageManager} run forge -- ${command}`;
}

function workosClientIdArg(options: Pick<GoldenPathCommandOptions, "clientId">): string {
  return options.clientId?.trim() || "client_...";
}

function workosEnvCommand(options: Pick<GoldenPathCommandOptions, "clientId">): string {
  return `workos env --client-id ${workosClientIdArg(options)} --write --json`;
}

function workosAuthProveCommand(options: Pick<GoldenPathCommandOptions, "clientId">): string {
  return `auth prove --provider workos --real --client-id ${workosClientIdArg(options)} --file workos-seed.yml --json`;
}

function buildStages(options: GoldenPathCommandOptions): GoldenPathStage[] {
  const forgeSpecFlag = options.forgeSpec ? ` --forge-spec ${options.forgeSpec}` : "";
  const createCommand = `forge field-test create ${options.name} --auth ${options.auth} --template ${options.template} --package-manager ${options.packageManager}${forgeSpecFlag} --install --git --json`;
  const cdCommand = `cd ${options.name}`;
  const workosSetup = options.real
    ? "workos setup --real --file workos-seed.yml --json"
    : "workos setup --file workos-seed.yml --json";
  const workosProve = options.real
    ? workosAuthProveCommand(options)
    : "auth prove --provider workos --file workos-seed.yml --json";
  return [
    {
      id: "create",
      title: "Create the app from the public alpha path",
      purpose: "Prove users can start without cloning the framework checkout.",
      commands: [
        createCommand,
        cdCommand,
      ],
      proves: [
        "template scaffolds",
        "dependencies install",
        "git repo initializes when requested",
        "Forge package resolves from the requested package source",
      ],
    },
    {
      id: "auth",
      title: options.auth === "workos" ? "Add and prove WorkOS AuthKit/RBAC" : "Confirm local auth posture",
      purpose: options.auth === "workos"
        ? "Configure app-owned auth files, auth.md, seed, claim mapping, policies, and tenant proof."
        : "Keep auth posture explicit even when the app does not use WorkOS.",
      commands: options.auth === "workos"
        ? [
            appCommand(options, "add auth workos --json"),
            appCommand(options, "authmd generate --json"),
            appCommand(options, "authmd check --json"),
            appCommand(options, "workos doctor --json"),
            appCommand(options, "workos seed --file workos-seed.yml --dry-run --json"),
            ...(options.real ? [appCommand(options, workosEnvCommand(options))] : []),
            appCommand(options, workosSetup),
            appCommand(options, workosProve),
            appCommand(options, "auth prove --scenario multi-tenant --json"),
          ]
        : [
            appCommand(options, "auth check --json"),
            appCommand(options, "authmd generate --json"),
            appCommand(options, "authmd check --json"),
          ],
      proves: options.auth === "workos"
        ? [
            "AuthKit routes exist",
            "web app uses backend-owned WorkOS login/session bridge",
            "WorkOS seed covers active policy permissions",
            "hosted WorkOS setup is applied or idempotently already present when --real is used",
            "tenant claim maps to organization_id",
          ]
        : [
            "auth mode is explicit",
            "auth.md metadata is generated",
          ],
    },
    {
      id: "field-test",
      title: "Run a production-shaped field test",
      purpose: "Exercise a fresh app through runtime, auth metadata, UI, seed, policy denial, and tenant probes.",
      commands: [
        appCommand(options, "field-test run --realistic --json"),
        appCommand(options, "field-test report --json"),
      ],
      proves: [
        "runtime health and entries endpoints respond",
        "auth.md and OAuth protected resource metadata respond to HEAD and GET",
        "UI loads and passes ergonomics checks",
        "vendor-access proves allowed, denied, and cross-tenant paths",
      ],
    },
    {
      id: "deploy",
      title: "Package and gate production deploy",
      purpose: "Answer whether the app can publish, what blocks it, and what command resolves the next blocker.",
      commands: [
        appCommand(options, `deploy init --target ${options.target} --json`),
        "cp deploy/.env.production.example deploy/.env.production",
        appCommand(options, "env doctor --target production --json"),
        appCommand(options, "deploy readiness --production --json"),
        appCommand(options, "deploy check --production --json"),
        appCommand(options, `deploy package --target ${options.target}`),
        appCommand(options, `deploy verify --production --url ${options.url ?? "https://app.example.com"} --json`),
      ],
      proves: [
        "Docker deploy artifacts exist",
        "production env evidence is explicit",
        "dev-headers cannot pass as public production auth",
        "DATABASE_URL is real deploy evidence, not just an example",
        "public deployment exposes health and auth metadata endpoints",
      ],
    },
  ];
}

function readJsonIfExists(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function statusOfExit(exitCode: 0 | 1 | undefined): "passed" | "blocked" {
  return exitCode === 0 ? "passed" : "blocked";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function booleanField(record: Record<string, unknown> | null, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function seedStateMatchesCurrentSeed(workos: WorkOSCommandResult | undefined): boolean {
  const data = asRecord(workos?.data);
  const seedState = asRecord(data?.seedState);
  return Boolean(
    booleanField(seedState, "exists") &&
      booleanField(seedState, "valid") &&
      seedState?.matchesSeedHash === true,
  );
}

function workosAuthStageStatus(
  options: GoldenPathCommandOptions,
  workos: WorkOSCommandResult | undefined,
  workosEnv: WorkOSCommandResult | undefined,
): { passed: boolean; nextCommand: string | null } {
  if (options.auth !== "workos") return { passed: true, nextCommand: null };
  if (!workos || workos.exitCode !== 0) {
    return { passed: false, nextCommand: "forge workos doctor --json" };
  }
  if (options.real && workosEnv && workosEnv.exitCode !== 0) {
    const data = asRecord(workosEnv.data);
    const nextCommand = typeof data?.nextCommand === "string" && data.nextCommand.trim()
      ? data.nextCommand
      : workosEnv?.data ? `forge ${workosEnvCommand(options)}` : "forge workos env --write --json";
    return { passed: false, nextCommand };
  }
  if (options.real && !seedStateMatchesCurrentSeed(workos)) {
    return {
      passed: false,
      nextCommand: options.clientId
        ? `forge ${workosAuthProveCommand(options)}`
        : "forge auth prove --provider workos --real --file workos-seed.yml --json",
    };
  }
  return { passed: true, nextCommand: null };
}

function summarizeWorkOSCheck(result: WorkOSCommandResult | undefined): GoldenPathWorkOSCheckSummary | undefined {
  if (!result) return undefined;
  return {
    ok: result.ok,
    kind: result.kind,
    checks: result.checks,
    data: result.data,
    exitCode: result.exitCode,
  };
}

function summarizeFieldTestCheck(result: FieldTestCommandResult): GoldenPathFieldTestCheckSummary {
  return {
    ok: result.ok,
    kind: result.kind,
    action: result.action,
    summary: result.summary,
    reportPath: result.reportPath,
    nextActions: result.nextActions,
    exitCode: result.exitCode,
  };
}

function summarizeDeployCheck(result: DeployCommandResult): GoldenPathDeployCheckSummary {
  return {
    ok: result.ok,
    kind: result.kind,
    action: result.action,
    readiness: result.readiness,
    nextActions: result.nextActions,
    exitCode: result.exitCode,
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function nextInstruction(nextCommand: string | null | undefined): string {
  if (!nextCommand) return "";
  return /^(edit|open|copy|set)\b/.test(nextCommand)
    ? `; next action: ${nextCommand}`
    : `; run ${nextCommand}`;
}

function blockerForStage(stage: GoldenPathStage | undefined): string | null {
  if (!stage || stage.status === "passed") return null;
  const next = nextInstruction(stage.nextCommand);
  if (stage.id === "create") {
    return `create: package.json is missing${next}`;
  }
  if (stage.id === "auth") {
    if (stage.nextCommand?.includes("workos env")) {
      return `workos-env: WorkOS real auth environment is incomplete${next}`;
    }
    if (stage.nextCommand?.includes("auth prove --provider workos --real") || stage.nextCommand?.includes("workos prove --real")) {
      return `workos-real-seed: hosted WorkOS seed evidence is missing or stale${next}`;
    }
    if (stage.nextCommand?.includes("workos doctor")) {
      return `workos-doctor: WorkOS adapter readiness has not passed${next}`;
    }
    return `auth: auth readiness has not passed${next}`;
  }
  if (stage.id === "field-test") {
    return `field-test: no passing production-shaped field-test report was found${next}`;
  }
  if (stage.id === "deploy") {
    return `deploy: production readiness has not passed${next}`;
  }
  return `${stage.id}: stage has not passed${next}`;
}

async function buildStatus(options: GoldenPathCommandOptions): Promise<GoldenPathCommandResult> {
  const stages = buildStages(options);
  const workos = options.auth === "workos"
    ? runWorkOSCommand({
        subcommand: "doctor",
        workspaceRoot: options.workspaceRoot,
        json: true,
        file: "workos-seed.yml",
        yes: false,
        dryRun: true,
        real: options.real,
      })
    : undefined;
  const workosEnv = options.auth === "workos" && options.real && workos?.exitCode === 0
    ? runWorkOSCommand({
        subcommand: "env",
        workspaceRoot: options.workspaceRoot,
        json: true,
        file: "workos-seed.yml",
        yes: false,
        dryRun: false,
        real: true,
        write: false,
        skipCliEnv: true,
        clientId: options.clientId,
      })
    : undefined;
  const fieldTest = await runFieldTestCommand({
    subcommand: "report",
    workspaceRoot: options.workspaceRoot,
    json: true,
    template: options.template,
    packageManager: options.packageManager,
    auth: options.auth,
    dryRun: false,
    keep: false,
    runtimeProbes: false,
    authProbes: false,
    uiProbes: false,
    realistic: false,
    timeoutMs: 180_000,
  });
  const deploy = await runDeployCommand({
    subcommand: "readiness",
    workspaceRoot: options.workspaceRoot,
    json: true,
    target: options.target,
    production: options.production,
    url: options.url,
  });

  const fieldReportPath = join(options.workspaceRoot, ".forge/field-test-report.json");
  const fieldReport = readJsonIfExists(fieldReportPath);
  const stageStatus = stages.map((stage) => {
    if (stage.id === "create") {
      const created = existsSync(join(options.workspaceRoot, "package.json"));
      return {
        ...stage,
        status: created ? "passed" as const : "missing" as const,
        evidence: { packageJson: created },
        nextCommand: created ? null : `forge field-test create ${options.name} --auth ${options.auth}${options.forgeSpec ? ` --forge-spec ${options.forgeSpec}` : ""} --install --git --json`,
      };
    }
    if (stage.id === "auth") {
      const authStatus = workosAuthStageStatus(options, workos, workosEnv);
      return {
        ...stage,
        status: authStatus.passed ? "passed" as const : "blocked" as const,
        evidence: options.auth === "workos" ? { doctor: workos?.data, env: workosEnv?.data } : { auth: "none" },
        nextCommand: authStatus.nextCommand,
      };
    }
    if (stage.id === "field-test") {
      return {
        ...stage,
        status: statusOfExit(fieldTest.exitCode),
        evidence: fieldTest.summary ?? fieldReport,
        nextCommand: fieldTest.exitCode === 0 ? null : "forge field-test run --realistic --json",
      };
    }
    return {
      ...stage,
      status: statusOfExit(deploy.exitCode),
      evidence: deploy.readiness,
      nextCommand: deploy.readiness?.answers.nextCommand ?? deploy.nextActions[0] ?? null,
    };
  });

  const blocked = stageStatus.find((stage) => stage.status !== "passed");
  const blockers = uniqueStrings([
    ...(blockerForStage(blocked) ? [blockerForStage(blocked) as string] : []),
    ...(deploy.readiness?.blocking ?? []),
  ]);
  const nextCommand = blocked?.nextCommand ?? deploy.readiness?.answers.nextCommand ?? null;
  const canPublish = deploy.readiness?.answers.canPublish === true;
  const result: GoldenPathCommandResult = {
    schemaVersion: "0.1.0",
    ok: !blocked && canPublish,
    kind: "golden-path",
    action: "status",
    target: options.target,
    auth: options.auth,
    production: options.production,
    real: options.real,
    summary: {
      canPublish,
      currentStage: blocked?.id ?? "complete",
      nextCommand,
      blockers,
    },
    stages: stageStatus,
    checks: {
      ...(workos ? { workos: summarizeWorkOSCheck(workos) } : {}),
      ...(workosEnv ? { workosEnv: summarizeWorkOSCheck(workosEnv) } : {}),
      fieldTest: summarizeFieldTestCheck(fieldTest),
      deploy: summarizeDeployCheck(deploy),
    },
    nextActions: nextCommand ? [nextCommand] : ["forge deploy verify --production --url https://app.example.com --json"],
    exitCode: !blocked && canPublish ? 0 : 1,
  };
  return normalizeForgeCliCommandsInValue(options.workspaceRoot, result) as GoldenPathCommandResult;
}

function buildPlan(options: GoldenPathCommandOptions): GoldenPathCommandResult {
  const stages = buildStages(options);
  const nextActions = stages.flatMap((stage) => stage.commands);
  return normalizeForgeCliCommandsInValue(options.workspaceRoot, {
    schemaVersion: "0.1.0",
    ok: true,
    kind: "golden-path",
    action: "plan",
    target: options.target,
    auth: options.auth,
    production: options.production,
    real: options.real,
    summary: {
      canPublish: false,
      currentStage: "create",
      nextCommand: nextActions[0] ?? null,
      blockers: [],
    },
    stages,
    nextActions,
    exitCode: 0,
  }) as GoldenPathCommandResult;
}

export async function runGoldenPathCommand(options: GoldenPathCommandOptions): Promise<GoldenPathCommandResult> {
  if (options.subcommand === "status") return buildStatus(options);
  return buildPlan(options);
}

export function formatGoldenPathJson(result: GoldenPathCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatGoldenPathHuman(result: GoldenPathCommandResult): string {
  const lines = [
    `golden-path ${result.action} ${result.ok ? "ok" : "blocked"}`,
    `auth: ${result.auth}${result.real ? " real" : ""}`,
    `target: ${result.target}`,
    `current: ${result.summary.currentStage}`,
    ...(result.summary.blockers.length ? ["", "Blockers:", ...result.summary.blockers.map((item) => `  - ${item}`)] : []),
    "",
    "Stages:",
    ...result.stages.map((stage) => `  ${stage.status ? `[${stage.status}] ` : ""}${stage.id}: ${stage.title}`),
    ...(result.nextActions.length ? ["", "Next:", ...result.nextActions.map((action) => `  ${action}`)] : []),
  ];
  return `${lines.join("\n")}\n`;
}
