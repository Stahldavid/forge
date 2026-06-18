import type { AddOptions, InspectTarget, VerifyOptions } from "../compiler/types/cli.ts";
import type { SandboxBackend } from "../compiler/types/runtime.ts";
import type { DbAdapterKind } from "../runtime/db/adapter.ts";
import type { DbSubcommand } from "./db.ts";
import type { OutboxSubcommand } from "./outbox.ts";
import type { WorkflowSubcommand } from "./workflow.ts";
import type { TelemetrySubcommand } from "./telemetry.ts";
import type { PolicySubcommand } from "./policy.ts";
import type { SecretsSubcommand } from "./secrets.ts";
import type { EnvSubcommand } from "./secrets.ts";
import type { AiSubcommand } from "./ai.ts";
import type { QuerySubcommand } from "./query.ts";
import type { LiveSubcommand } from "./live.ts";
import type { ForgeAiProvider } from "../runtime/ai/types.ts";
import type { NewPackageManager, NewTemplateName } from "./new.ts";
import type { SelfHostSubcommand } from "./self-host.ts";
import type { AgentContractSubcommand } from "./agent-contract.ts";
import type { AuthSubcommand } from "./auth.ts";
import type { RlsSubcommand } from "./rls.ts";
import type { SecuritySubcommand } from "./security.ts";
import type { DepsSubcommand } from "./deps.ts";
import type { ReleaseAction, ReleaseArea } from "./release.ts";
import type { MakeCommandOptions, MakePrimitive } from "../make/types.ts";
import type { FeatureAction, FeatureCommandOptions } from "../feature/types.ts";
import type { RefactorAction, RefactorCommandOptions, RenameTarget } from "../refactor/types.ts";
import type { ImpactCommandOptions, TestCommandOptions, TestSubcommand } from "../impact/types.ts";
import type { TestCost } from "../compiler/types/test-graph.ts";
import type { RepairCommandOptions, RepairSubcommand } from "../repair/types.ts";
import type {
  AgentAdapterTarget,
  AgentCommandOptions,
  AgentSubcommand,
} from "../agent-adapters/types.ts";
import type {
  ReviewCommandOptions,
  ReviewFailOn,
  ReviewFindingCategory,
  ReviewMode,
  ReviewSubcommand,
} from "../review/types.ts";
import type {
  UiBrowserName,
  UiCommandOptions,
  UiScreenshotMode,
  UiSubcommand,
  UiTraceMode,
  UiVideoMode,
} from "../ui/types.ts";
import type { ForgeDoOptions } from "../intent/types.ts";
import type { BenchCommandOptions, BenchSubcommand } from "../bench.ts";

export type ForgeCommand =
  | { kind: "version"; json: boolean }
  | {
      kind: "new";
      name: string;
      template: NewTemplateName;
      packageManager: NewPackageManager;
      install: boolean;
      git: boolean;
      forgePackageSpec?: string;
      localForge: boolean;
      workspaceRoot: string;
    }
  | { kind: "build"; json: boolean; workspaceRoot: string }
  | {
      kind: "serve";
      host?: string;
      port?: number;
      databaseUrl?: string;
      json: boolean;
      envFile?: string;
      allowDevAuth: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "worker";
      db: DbAdapterKind;
      databaseUrl?: string;
      json: boolean;
      once: boolean;
      pollIntervalMs: number;
      limit: number;
      mock: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "self-host";
      subcommand: SelfHostSubcommand;
      json: boolean;
      withWeb: boolean;
      postgresVersion: string;
      runtimePort: number;
      webPort: number;
      workspaceRoot: string;
    }
  | {
      kind: "agent-contract";
      subcommand: AgentContractSubcommand;
      json: boolean;
      workspaceRoot: string;
    }
  | { kind: "doctor"; target?: "project" | "windows"; json: boolean; workspaceRoot: string }
  | { kind: "setup"; target: "windows"; json: boolean; yes: boolean; workspaceRoot: string }
  | {
      kind: "security";
      subcommand: SecuritySubcommand;
      db: DbAdapterKind;
      databaseUrl?: string;
      json: boolean;
      runTests: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "auth";
      subcommand: AuthSubcommand;
      json: boolean;
      token?: string;
      workspaceRoot: string;
    }
  | {
      kind: "rls";
      subcommand: RlsSubcommand;
      db: DbAdapterKind;
      databaseUrl?: string;
      json: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "deps";
      subcommand: DepsSubcommand;
      packageName?: string;
      symbolName?: string;
      planPath?: string;
      target?: string;
      json: boolean;
      yes: boolean;
      allowScripts: boolean;
      skipTests: boolean;
      dryRun: boolean;
      changed: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "release";
      area: ReleaseArea;
      action: ReleaseAction;
      releaseId?: string;
      input?: string;
      provider?: string;
      target?: string;
      env: string;
      json: boolean;
      allowDirty: boolean;
      allowPublicSourcemaps: boolean;
      workspaceRoot: string;
    }
  | { kind: "make"; options: MakeCommandOptions }
  | { kind: "feature"; options: FeatureCommandOptions }
  | { kind: "refactor"; options: RefactorCommandOptions }
  | { kind: "impact"; options: ImpactCommandOptions }
  | { kind: "test"; options: TestCommandOptions }
  | { kind: "repair"; options: RepairCommandOptions }
  | { kind: "do"; options: ForgeDoOptions }
  | { kind: "bench"; options: BenchCommandOptions }
  | { kind: "agent"; options: AgentCommandOptions }
  | { kind: "review"; options: ReviewCommandOptions }
  | { kind: "ui"; options: UiCommandOptions }
  | { kind: "manifest"; subcommand: "validate" | "import"; path: string; json: boolean; workspaceRoot: string }
  | { kind: "delta"; subcommand: "status"; json: boolean; workspaceRoot: string }
  | { kind: "timeline"; target?: string; kindFilter?: string; limit?: number; json: boolean; workspaceRoot: string }
  | { kind: "explain"; thing: string; json: boolean; workspaceRoot: string }
  | { kind: "generate"; check: boolean; dryRun: boolean; json: boolean; concurrency: number }
  | { kind: "add"; alias: string; options: AddOptions & { workspaceRoot: string } }
  | { kind: "inspect"; target: InspectTarget; json: boolean; dryRun: boolean }
  | { kind: "check"; json: boolean; dryRun: boolean; strictSecrets: boolean }
  | { kind: "verify"; options: VerifyOptions }
  | { kind: "run"; name?: string; list: boolean; json: boolean; mock: boolean; userId?: string; tenantId?: string; role?: string; envFile?: string; workspaceRoot: string; queryMode?: boolean; args?: unknown }
  | {
      kind: "dev";
      host?: string;
      port?: number;
      mock: boolean;
      mockAi: boolean;
      once: boolean;
      watch: boolean;
      json: boolean;
      db: "memory" | "pglite" | "postgres" | "none";
      databaseUrl?: string;
      worker: boolean;
      withWeb: boolean;
      apiOnly: boolean;
      webOnly: boolean;
      open: boolean;
      webPort?: number;
      telemetry: string[];
      envFile?: string;
      skipStartupConsole: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "db";
      subcommand: DbSubcommand;
      db: DbAdapterKind;
      databaseUrl?: string;
      json: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "outbox";
      subcommand: OutboxSubcommand;
      db: DbAdapterKind;
      databaseUrl?: string;
      json: boolean;
      once: boolean;
      watch: boolean;
      limit?: number;
      deliveryId?: number;
      mock: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "workflow";
      subcommand: WorkflowSubcommand;
      db: DbAdapterKind;
      databaseUrl?: string;
      json: boolean;
      once: boolean;
      watch: boolean;
      limit?: number;
      workflowName?: string;
      runId?: number;
      stepName?: string;
      input?: unknown;
      mock: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "telemetry";
      subcommand: TelemetrySubcommand;
      db: DbAdapterKind;
      databaseUrl?: string;
      json: boolean;
      traceId?: string;
      sink?: string;
      file?: "events" | "exceptions" | "spans";
      workspaceRoot: string;
    }
  | {
      kind: "policy";
      subcommand: PolicySubcommand;
      json: boolean;
      policy?: string;
      role?: string;
      strictPolicies: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "secrets";
      subcommand: SecretsSubcommand;
      json: boolean;
      redacted: boolean;
      name?: string;
      value?: string;
      workspaceRoot: string;
    }
  | {
      kind: "env";
      subcommand: EnvSubcommand;
      json: boolean;
      redacted: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "query";
      subcommand: QuerySubcommand;
      name?: string;
      args?: unknown;
      json: boolean;
      userId?: string;
      tenantId?: string;
      role?: string;
      workspaceRoot: string;
    }
  | {
      kind: "live";
      subcommand: LiveSubcommand;
      name?: string;
      args?: unknown;
      json: boolean;
      userId?: string;
      tenantId?: string;
      role?: string;
      url?: string;
      workspaceRoot: string;
    }
  | {
      kind: "ai";
      subcommand: AiSubcommand;
      json: boolean;
      provider?: ForgeAiProvider;
      model?: string;
      prompt?: string;
      mock: boolean;
      modelLevel: boolean;
      live: boolean;
      traceId?: string;
      db?: DbAdapterKind;
      databaseUrl?: string;
      workspaceRoot: string;
    };

export interface ParsedCli {
  command: ForgeCommand | null;
  workspaceRoot: string;
  errors: string[];
}

export const TOP_LEVEL_COMMANDS = [
  "version",
  "new",
  "build",
  "serve",
  "worker",
  "self-host",
  "agent-contract",
  "agent",
  "review",
  "ui",
  "doctor",
  "setup",
  "security",
  "auth",
  "rls",
  "deps",
  "release",
  "make",
  "feature",
  "refactor",
  "impact",
  "test",
  "repair",
  "do",
  "bench",
  "delta",
  "timeline",
  "explain",
  "manifest",
  "generate",
  "add",
  "inspect",
  "check",
  "verify",
  "run",
  "query",
  "live",
  "dev",
  "db",
  "workflow",
  "outbox",
  "telemetry",
  "policy",
  "secrets",
  "env",
  "ai",
] as const;

export const INSPECT_TARGETS: InspectTarget[] = [
  "app",
  "packages",
  "capabilities",
  "runtime-matrix",
  "data",
  "runtime",
  "dev",
  "subscriptions",
  "workflows",
  "telemetry",
  "policies",
  "secrets",
  "env",
  "ai",
  "queries",
  "api",
  "external",
  "client",
  "frontend",
  "auth",
  "rls",
  "db-security",
  "release",
  "artifacts",
  "sourcemaps",
  "live-production",
  "live-protocol",
  "live-transport",
  "make",
  "test-graph",
  "test-plans",
  "agent-contract",
  "agent-tools",
  "agent-adapters",
  "capability-map",
  "framework",
  "ui",
  "ui-scenarios",
  "ui-routes",
  "all",
  "rules",
  "map",
];

const NEW_TEMPLATES: NewTemplateName[] = ["b2b-support-web", "minimal-web"];
const NEW_PACKAGE_MANAGERS: NewPackageManager[] = ["bun", "npm", "pnpm", "yarn"];
const SELF_HOST_SUBCOMMANDS: SelfHostSubcommand[] = ["compose", "env", "check", "clean"];
const AGENT_CONTRACT_SUBCOMMANDS: AgentContractSubcommand[] = [
  "generate",
  "check",
  "print",
];
const AUTH_SUBCOMMANDS: AuthSubcommand[] = [
  "check",
  "config",
  "decode",
  "test-token",
  "jwks",
  "prove",
];
const SECURITY_SUBCOMMANDS: SecuritySubcommand[] = ["prove"];
const RLS_SUBCOMMANDS: RlsSubcommand[] = ["generate", "check", "apply", "test", "mutate-test"];
const DEPS_SUBCOMMANDS: DepsSubcommand[] = [
  "outdated",
  "inspect",
  "api",
  "trace",
  "runtime-compat",
  "diff",
  "upgrade-plan",
  "upgrade-apply",
  "upgrade-check",
  "upgrade-rollback",
  "risk",
];
const LIVE_SUBCOMMANDS: LiveSubcommand[] = [
  "list",
  "subscribe",
  "status",
  "debug",
  "invalidations",
  "test",
  "load-test",
];
const MAKE_PRIMITIVES: MakePrimitive[] = [
  "list",
  "explain",
  "table",
  "field",
  "policy",
  "command",
  "query",
  "livequery",
  "action",
  "workflow",
  "component",
  "page",
  "ui",
  "ai-chat",
  "resource",
  "apply",
  "rollback",
];
const FEATURE_ACTIONS: FeatureAction[] = [
  "validate",
  "plan",
  "diff",
  "apply",
  "list",
  "inspect",
  "rollback",
  "examples",
];
const REFACTOR_ACTIONS: RefactorAction[] = [
  "plan",
  "apply",
  "diff",
  "rollback",
  "list",
  "rename",
  "move",
  "extract-action",
  "replace-process-env",
  "replace-import",
];
const RENAME_TARGETS: RenameTarget[] = [
  "table",
  "field",
  "policy",
  "command",
  "query",
  "livequery",
  "action",
  "workflow",
  "event",
];
const TEST_SUBCOMMANDS: TestSubcommand[] = ["plan", "run", "explain"];
const TEST_COSTS: TestCost[] = ["instant", "fast", "standard", "slow", "docker", "browser"];
const REPAIR_SUBCOMMANDS: RepairSubcommand[] = [
  "diagnose",
  "explain",
  "plan",
  "apply",
  "run",
  "list",
  "inspect",
  "rollback",
];
const AGENT_SUBCOMMANDS: AgentSubcommand[] = [
  "list-targets",
  "export",
  "check",
  "doctor",
  "print-context",
  "clean",
];
const REVIEW_SUBCOMMANDS: ReviewSubcommand[] = ["inspect", "list", "explain"];
const REVIEW_MODES: ReviewMode[] = ["quick", "standard", "strict"];
const REVIEW_FAIL_ON: ReviewFailOn[] = ["warning", "error", "blocking"];
const REVIEW_CATEGORIES: ReviewFindingCategory[] = [
  "runtime",
  "data",
  "policy",
  "secrets",
  "package",
  "workflow",
  "livequery",
  "frontend",
  "test",
  "deploy",
  "release",
  "agent",
];
const UI_SUBCOMMANDS: UiSubcommand[] = [
  "smoke",
  "test",
  "scenario",
  "route",
  "snapshot",
  "report",
  "doctor",
  "list",
];
const UI_BROWSERS: UiBrowserName[] = ["chromium", "firefox", "webkit"];
const UI_TRACE_MODES: UiTraceMode[] = ["on", "off", "retain-on-failure"];
const UI_SCREENSHOT_MODES: UiScreenshotMode[] = ["on", "off", "only-on-failure"];
const UI_VIDEO_MODES: UiVideoMode[] = ["on", "off", "retain-on-failure"];
const AI_SUBCOMMANDS: AiSubcommand[] = [
  "providers",
  "check",
  "test",
  "models",
  "tools",
  "agents",
  "redteam",
  "trace",
];
const BENCH_SUBCOMMANDS: BenchSubcommand[] = ["compiler"];

function parseFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseOptionValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  return args[index + 1];
}

function parseOptionValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === flag && index + 1 < args.length) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function parseDbKind(value: string | undefined): "memory" | "pglite" | "postgres" | "none" {
  if (value === "memory" || value === "postgres" || value === "none") {
    return value;
  }
  return "pglite";
}

function parsePersistentDbKind(value: string | undefined): DbAdapterKind {
  return parseDbKind(value) === "postgres" ? "postgres" : "pglite";
}

function parseAdapterKind(value: string | undefined): DbAdapterKind {
  if (value === "postgres" || value === "memory") {
    return value;
  }
  return "pglite";
}

function parseSandboxBackend(value: string | undefined): SandboxBackend {
  if (value === "child" || value === "docker" || value === "none") {
    return value;
  }
  return "none";
}

function parseAddOptions(
  args: string[],
  workspaceRoot: string,
): AddOptions & { workspaceRoot: string } {
  return {
    workspaceRoot,
    json: parseFlag(args, "--json"),
    dryRun: parseFlag(args, "--dry-run"),
    runtimeInspect: parseFlag(args, "--runtime-inspect"),
    sandboxBackend: parseSandboxBackend(
      parseOptionValue(args, "--sandbox-backend"),
    ),
    allowScripts: parseFlag(args, "--allow-scripts"),
  };
}

function parseTestCost(value: string | undefined): TestCost {
  return TEST_COSTS.includes(value as TestCost) ? (value as TestCost) : "standard";
}

function parseReviewMode(value: string | undefined): ReviewMode {
  return REVIEW_MODES.includes(value as ReviewMode) ? (value as ReviewMode) : "standard";
}

function parseReviewFailOn(value: string | undefined): ReviewFailOn | undefined {
  return REVIEW_FAIL_ON.includes(value as ReviewFailOn) ? (value as ReviewFailOn) : undefined;
}

function parseReviewCategories(value: string | undefined): ReviewFindingCategory[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is ReviewFindingCategory => REVIEW_CATEGORIES.includes(item as ReviewFindingCategory));
}

function parseUiBrowser(value: string | undefined): UiBrowserName {
  return UI_BROWSERS.includes(value as UiBrowserName) ? (value as UiBrowserName) : "chromium";
}

function parseUiTrace(value: string | undefined): UiTraceMode {
  return UI_TRACE_MODES.includes(value as UiTraceMode) ? (value as UiTraceMode) : "retain-on-failure";
}

function parseUiScreenshot(value: string | undefined): UiScreenshotMode {
  return UI_SCREENSHOT_MODES.includes(value as UiScreenshotMode) ? (value as UiScreenshotMode) : "only-on-failure";
}

function parseUiVideo(value: string | undefined): UiVideoMode {
  return UI_VIDEO_MODES.includes(value as UiVideoMode) ? (value as UiVideoMode) : "retain-on-failure";
}

function parseNewTemplate(value: string | undefined): NewTemplateName {
  return NEW_TEMPLATES.includes(value as NewTemplateName)
    ? (value as NewTemplateName)
    : "b2b-support-web";
}

function parseNewPackageManager(value: string | undefined): NewPackageManager {
  return NEW_PACKAGE_MANAGERS.includes(value as NewPackageManager)
    ? (value as NewPackageManager)
    : "bun";
}

function parseDoObjective(rest: string[], argv: string[]): string {
  const [action, name, ...tail] = rest;
  if (action === "add-resource") {
    return [
      "add",
      "resource",
      name ?? "<name>",
      parseFlag(argv, "--with-ui") ? "with ui" : "",
      tail.join(" "),
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  if (action === "understand") {
    return tail.length > 0 ? ["understand", ...tail].join(" ").trim() : "understand project";
  }
  if (action === "connect-ui") {
    return ["connect", "ui", name, ...tail].filter(Boolean).join(" ").trim();
  }
  return rest.join(" ").trim() || "inspect project";
}

export function parseCli(argv: string[]): ParsedCli {
  const errors: string[] = [];
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const workspaceRoot = process.cwd().replace(/\\/g, "/");

  if (parseFlag(argv, "--version") || parseFlag(argv, "-v")) {
    return {
      command: { kind: "version", json: parseFlag(argv, "--json") },
      workspaceRoot,
      errors,
    };
  }

  if (positional.length === 0) {
    errors.push(
      `missing command; expected ${TOP_LEVEL_COMMANDS.join(", ")}`,
    );
    return { command: null, workspaceRoot, errors };
  }

  const [commandName, ...rest] = positional;

  switch (commandName) {
    case "new": {
      const name = rest[0];
      if (!name) {
        errors.push("forge new requires a project name");
        return { command: null, workspaceRoot, errors };
      }
      const templateRaw = parseOptionValue(argv, "--template");
      if (templateRaw && !NEW_TEMPLATES.includes(templateRaw as NewTemplateName)) {
        errors.push(`unsupported template '${templateRaw}'; supported: ${NEW_TEMPLATES.join(", ")}`);
      }
      const packageManagerRaw = parseOptionValue(argv, "--package-manager");
      const forgePackageSpec = parseOptionValue(argv, "--forge-spec");
      const localForge = parseFlag(argv, "--local-forge");
      const install = parseFlag(argv, "--install");
      const noInstall = parseFlag(argv, "--no-install");
      if (
        packageManagerRaw &&
        !NEW_PACKAGE_MANAGERS.includes(packageManagerRaw as NewPackageManager)
      ) {
        errors.push(
          `unsupported package manager '${packageManagerRaw}'; supported: ${NEW_PACKAGE_MANAGERS.join(", ")}`,
        );
      }
      if (forgePackageSpec && localForge) {
        errors.push("use either --forge-spec or --local-forge, not both");
      }
      if (install && noInstall) {
        errors.push("use either --install or --no-install, not both");
      }

      return {
        command: {
          kind: "new",
          name,
          template: parseNewTemplate(templateRaw),
          packageManager: parseNewPackageManager(packageManagerRaw),
          install: install || !noInstall,
          git: !parseFlag(argv, "--no-git"),
          forgePackageSpec,
          localForge,
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "build":
      return {
        command: {
          kind: "build",
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    case "serve": {
      const portRaw = parseOptionValue(argv, "--port");
      const port = portRaw ? Number(portRaw) : undefined;
      if (portRaw !== undefined && (!Number.isFinite(port) || port! < 0)) {
        errors.push("--port must be a number >= 0");
      }
      return {
        command: {
          kind: "serve",
          host: parseOptionValue(argv, "--host"),
          port,
          databaseUrl: parseOptionValue(argv, "--database-url"),
          json: parseFlag(argv, "--json"),
          envFile: parseOptionValue(argv, "--env-file"),
          allowDevAuth: parseFlag(argv, "--allow-dev-auth"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "worker": {
      const limitRaw = parseOptionValue(argv, "--limit");
      const limit = limitRaw ? Number(limitRaw) : 10;
      if (!Number.isFinite(limit) || limit < 1) {
        errors.push("--limit must be a number >= 1");
      }
      const pollRaw = parseOptionValue(argv, "--poll-interval");
      const pollIntervalMs = pollRaw ? Number(pollRaw) : 1_000;
      if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) {
        errors.push("--poll-interval must be a number >= 1");
      }
      return {
        command: {
          kind: "worker",
          db: parseAdapterKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          json: parseFlag(argv, "--json"),
          once: parseFlag(argv, "--once"),
          pollIntervalMs,
          limit: Math.floor(limit),
          mock: parseFlag(argv, "--mock"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "self-host": {
      const subcommand = rest[0] as SelfHostSubcommand | undefined;
      if (!subcommand || !SELF_HOST_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge self-host requires subcommand: compose, env, check, or clean");
        return { command: null, workspaceRoot, errors };
      }
      const runtimePortRaw = parseOptionValue(argv, "--runtime-port");
      const runtimePort = runtimePortRaw ? Number(runtimePortRaw) : 3765;
      if (!Number.isFinite(runtimePort) || runtimePort < 1) {
        errors.push("--runtime-port must be a number >= 1");
      }
      const webPortRaw = parseOptionValue(argv, "--web-port");
      const webPort = webPortRaw ? Number(webPortRaw) : 3000;
      if (!Number.isFinite(webPort) || webPort < 1) {
        errors.push("--web-port must be a number >= 1");
      }
      return {
        command: {
          kind: "self-host",
          subcommand,
          json: parseFlag(argv, "--json"),
          withWeb: !parseFlag(argv, "--no-web"),
          postgresVersion: parseOptionValue(argv, "--postgres-version") ?? "16",
          runtimePort: Math.floor(runtimePort),
          webPort: Math.floor(webPort),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "agent-contract": {
      const subcommand = rest[0] as AgentContractSubcommand | undefined;
      if (!subcommand || !AGENT_CONTRACT_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge agent-contract requires subcommand: generate, check, or print");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "agent-contract",
          subcommand,
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "agent": {
      const subcommand = rest[0] as AgentSubcommand | undefined;
      if (!subcommand || !AGENT_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge agent requires subcommand: list-targets, export, check, doctor, print-context, or clean");
        return { command: null, workspaceRoot, errors };
      }
      const target =
        (parseOptionValue(argv, "--target") as AgentAdapterTarget | undefined) ??
        (subcommand === "export" || subcommand === "clean" ? "generic" : "generic");
      return {
        command: {
          kind: "agent",
          options: {
            subcommand,
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            target,
            dryRun: parseFlag(argv, "--dry-run"),
            force: parseFlag(argv, "--force"),
            preserveUserSections: !parseFlag(argv, "--no-preserve-user-sections"),
            skills: !parseFlag(argv, "--no-skills"),
            rules: !parseFlag(argv, "--no-rules"),
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "review": {
      const requested = rest[0] as ReviewSubcommand | undefined;
      const subcommand =
        requested && REVIEW_SUBCOMMANDS.includes(requested) ? requested : "run";
      const positionalWrite = rest[0] === "write";
      const noSourceFlag =
        !parseFlag(argv, "--changed") &&
        !parseFlag(argv, "--staged") &&
        !parseOptionValue(argv, "--base") &&
        !parseOptionValue(argv, "--feature") &&
        !parseOptionValue(argv, "--refactor") &&
        !parseOptionValue(argv, "--upgrade") &&
        !parseOptionValue(argv, "--release");
      return {
        command: {
          kind: "review",
          options: {
            subcommand,
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            md: parseFlag(argv, "--md"),
            sarif: parseFlag(argv, "--sarif"),
            write: positionalWrite || parseFlag(argv, "--write"),
            changed: parseFlag(argv, "--changed") || noSourceFlag,
            staged: parseFlag(argv, "--staged"),
            base: parseOptionValue(argv, "--base"),
            featureId: parseOptionValue(argv, "--feature"),
            refactorId: parseOptionValue(argv, "--refactor"),
            upgradeId: parseOptionValue(argv, "--upgrade"),
            releaseId: parseOptionValue(argv, "--release"),
            failOn: parseReviewFailOn(parseOptionValue(argv, "--fail-on")),
            mode: parseReviewMode(parseOptionValue(argv, "--mode")),
            include: parseReviewCategories(parseOptionValue(argv, "--include")),
            exclude: parseReviewCategories(parseOptionValue(argv, "--exclude")),
            reviewId: subcommand === "inspect" ? rest[1] : undefined,
            ruleId: subcommand === "explain" ? rest[1] : undefined,
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "ui": {
      const subcommand = (rest[0] ?? "smoke") as UiSubcommand;
      if (!UI_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge ui requires subcommand: smoke, test, scenario, route, snapshot, report, doctor, or list");
        return { command: null, workspaceRoot, errors };
      }
      const timeoutRaw = parseOptionValue(argv, "--timeout");
      const timeoutMs = timeoutRaw ? Number(timeoutRaw) : 30_000;
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
        errors.push("--timeout must be a number >= 1");
      }
      const scenarioName =
        parseOptionValue(argv, "--scenario") ??
        (subcommand === "scenario" ? rest[1] : undefined);
      const routePath =
        subcommand === "route" || subcommand === "snapshot"
          ? rest[1] ?? "/"
          : undefined;
      return {
        command: {
          kind: "ui",
          options: {
            subcommand,
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            headed: parseFlag(argv, "--headed"),
            browser: parseUiBrowser(parseOptionValue(argv, "--browser")),
            trace: parseUiTrace(parseOptionValue(argv, "--trace")),
            screenshot: parseUiScreenshot(parseOptionValue(argv, "--screenshot")),
            video: parseUiVideo(parseOptionValue(argv, "--video")),
            baseUrl: parseOptionValue(argv, "--base-url") ?? "http://127.0.0.1:3000",
            runtimeUrl: parseOptionValue(argv, "--runtime-url") ?? "http://127.0.0.1:3765",
            reuseServers: parseFlag(argv, "--reuse-servers"),
            startServers: parseFlag(argv, "--start-servers"),
            scenarioName,
            routePath,
            snapshotName: parseOptionValue(argv, "--name"),
            reportId: subcommand === "report" ? rest[1] ?? "last" : undefined,
            all: parseFlag(argv, "--all"),
            changed: parseFlag(argv, "--changed"),
            ci: parseFlag(argv, "--ci"),
            timeoutMs: Math.floor(timeoutMs),
            authToken: parseOptionValue(argv, "--auth-token"),
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "doctor":
      if (rest[0] && rest[0] !== "windows") {
        errors.push("forge doctor supports subcommand: windows");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "doctor",
          target: rest[0] === "windows" ? "windows" : "project",
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    case "setup": {
      const target = rest[0];
      if (target !== "windows") {
        errors.push("forge setup requires subcommand: windows");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "setup",
          target,
          json: parseFlag(argv, "--json"),
          yes: parseFlag(argv, "--yes"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "security": {
      const subcommand = rest[0] as SecuritySubcommand | undefined;
      if (!subcommand || !SECURITY_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge security requires subcommand: prove");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "security",
          subcommand,
          db: parseAdapterKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          json: parseFlag(argv, "--json"),
          runTests: parseFlag(argv, "--full") || parseFlag(argv, "--run-tests"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "auth": {
      const subcommand = rest[0] as AuthSubcommand | undefined;
      if (!subcommand || !AUTH_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge auth requires subcommand: check, config, decode, test-token, jwks, or prove");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "auth",
          subcommand,
          json: parseFlag(argv, "--json"),
          token: parseOptionValue(argv, "--token"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "rls": {
      const subcommand = rest[0] as RlsSubcommand | undefined;
      if (!subcommand || !RLS_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge rls requires subcommand: generate, check, apply, test, or mutate-test");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "rls",
          subcommand,
          db: parseAdapterKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "deps": {
      const subcommand = rest[0] as DepsSubcommand | undefined;
      if (!subcommand || !DEPS_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge deps requires subcommand: outdated, inspect, api, trace, runtime-compat, diff, upgrade-plan, upgrade-apply, upgrade-check, upgrade-rollback, or risk");
        return { command: null, workspaceRoot, errors };
      }
      const packageName =
        subcommand === "outdated" || subcommand === "upgrade-check" ? undefined : rest[1];
      const symbolName = subcommand === "api" ? rest[2] : undefined;
      const planPath =
        subcommand === "upgrade-apply" || subcommand === "upgrade-rollback"
          ? rest[1]
          : undefined;
      return {
        command: {
          kind: "deps",
          subcommand,
          packageName,
          symbolName,
          planPath,
          target: parseOptionValue(argv, "--to"),
          json: parseFlag(argv, "--json"),
          yes: parseFlag(argv, "--yes"),
          allowScripts: parseFlag(argv, "--allow-scripts"),
          skipTests: parseFlag(argv, "--skip-tests"),
          dryRun: parseFlag(argv, "--dry-run"),
          changed: parseFlag(argv, "--changed"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "release": {
      const first = rest[0] ?? "prepare";
      const area =
        first === "artifacts" || first === "sourcemaps"
          ? (first as ReleaseArea)
          : "release";
      const action = (area === "release" ? first : rest[1]) as ReleaseAction;
      const releaseId =
        area === "release" && action === "inspect"
          ? rest[1]
          : parseOptionValue(argv, "--release");
      return {
        command: {
          kind: "release",
          area,
          action,
          releaseId,
          input: parseOptionValue(argv, "--input"),
          provider: parseOptionValue(argv, "--provider"),
          target: parseOptionValue(argv, "--target"),
          env: parseOptionValue(argv, "--env") ?? "production",
          json: parseFlag(argv, "--json"),
          allowDirty: parseFlag(argv, "--allow-dirty"),
          allowPublicSourcemaps: parseFlag(argv, "--allow-public-sourcemaps"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "make": {
      const primitive = rest[0] as MakePrimitive | undefined;
      if (!primitive || !MAKE_PRIMITIVES.includes(primitive)) {
        errors.push(`forge make requires primitive: ${MAKE_PRIMITIVES.join(", ")}`);
        return { command: null, workspaceRoot, errors };
      }
      const name =
        primitive === "explain"
          ? undefined
          : primitive === "list"
            ? undefined
            : primitive === "ui"
              ? rest[1] ?? "ui"
              : primitive === "ai-chat"
                ? rest[1] ?? "support"
              : rest[1];
      const explainPrimitive =
        primitive === "explain" ? (rest[1] as MakePrimitive | undefined) : undefined;
      if (
        primitive === "explain" &&
        (!explainPrimitive || !MAKE_PRIMITIVES.includes(explainPrimitive))
      ) {
        errors.push("forge make explain requires a known primitive");
      }
      if (
        !["list", "explain", "ui", "ai-chat"].includes(primitive) &&
        !name
      ) {
        errors.push(`forge make ${primitive} requires a name or plan id`);
      }

      return {
        command: {
          kind: "make",
          options: {
            primitive,
            name,
            explainPrimitive,
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            dryRun: parseFlag(argv, "--dry-run"),
            plan: parseFlag(argv, "--plan"),
            apply:
              primitive === "apply" ||
              parseFlag(argv, "--apply") ||
              parseFlag(argv, "--yes"),
            yes: parseFlag(argv, "--yes"),
            force: parseFlag(argv, "--force"),
            noGenerate: parseFlag(argv, "--no-generate"),
            noVerify: parseFlag(argv, "--no-verify"),
            keepFailed: parseFlag(argv, "--keep-failed"),
            tenantScoped: parseFlag(argv, "--tenant-scoped"),
            fieldSpecs: parseOptionValues(argv, "--field"),
            fieldsRaw: parseOptionValue(argv, "--fields"),
            type: parseOptionValue(argv, "--type"),
            values: parseOptionValue(argv, "--values"),
            defaultValue: parseOptionValue(argv, "--default"),
            index: parseFlag(argv, "--index"),
            roles: parseOptionValue(argv, "--roles"),
            table: parseOptionValue(argv, "--table"),
            policy: parseOptionValue(argv, "--policy"),
            emit: parseOptionValue(argv, "--emit"),
            event: parseOptionValue(argv, "--event"),
            trigger: parseOptionValue(argv, "--trigger"),
            component: parseOptionValue(argv, "--component"),
            framework: parseOptionValue(argv, "--framework") as "vite" | "next" | undefined,
            withAi: parseFlag(argv, "--with-ai"),
            withCrud: parseFlag(argv, "--with-crud"),
            withLiveQuery: parseFlag(argv, "--with-livequery"),
            withReact: parseFlag(argv, "--with-react") || parseFlag(argv, "--with-ui"),
            withUi: parseFlag(argv, "--with-ui"),
            withTests: parseFlag(argv, "--with-tests"),
            withCreateForm: parseFlag(argv, "--with-create-form"),
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "feature": {
      const action = rest[0] as FeatureAction | undefined;
      if (!action || !FEATURE_ACTIONS.includes(action)) {
        errors.push(`forge feature requires action: ${FEATURE_ACTIONS.join(", ")}`);
        return { command: null, workspaceRoot, errors };
      }
      const blueprintPath =
        ["validate", "plan", "diff", "apply"].includes(action) ? rest[1] : undefined;
      const featureId =
        ["inspect", "rollback"].includes(action) ? rest[1] : undefined;
      const exampleName = action === "examples" ? rest[1] : undefined;
      if (["validate", "plan", "diff", "apply"].includes(action) && !blueprintPath) {
        errors.push(`forge feature ${action} requires a blueprint path`);
      }
      if (["inspect", "rollback"].includes(action) && !featureId) {
        errors.push(`forge feature ${action} requires a feature id`);
      }
      return {
        command: {
          kind: "feature",
          options: {
            action,
            blueprintPath,
            featureId,
            exampleName,
            writePath: parseOptionValue(argv, "--write"),
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            dryRun: parseFlag(argv, "--dry-run"),
            yes: parseFlag(argv, "--yes"),
            noGenerate: parseFlag(argv, "--no-generate"),
            noVerify: parseFlag(argv, "--no-verify"),
            keepFailed: parseFlag(argv, "--keep-failed"),
            update: parseFlag(argv, "--update"),
            allowHighRisk: parseFlag(argv, "--allow-high-risk"),
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "refactor": {
      const action = rest[0] as RefactorAction | undefined;
      if (!action || !REFACTOR_ACTIONS.includes(action)) {
        errors.push(`forge refactor requires action: ${REFACTOR_ACTIONS.join(", ")}`);
        return { command: null, workspaceRoot, errors };
      }
      let renameTarget: RenameTarget | undefined;
      let from: string | undefined;
      let to: string | undefined;
      let planId: string | undefined;
      let componentName: string | undefined;

      if (action === "rename") {
        renameTarget = rest[1] as RenameTarget | undefined;
        if (!renameTarget || !RENAME_TARGETS.includes(renameTarget)) {
          errors.push(`forge refactor rename requires target: ${RENAME_TARGETS.join(", ")}`);
        }
        from = rest[2];
        to = rest[3];
        if (!from || !to) {
          errors.push("forge refactor rename requires <from> <to>");
        }
      } else if (action === "move") {
        renameTarget = rest[1] as RenameTarget | undefined;
        if (renameTarget !== "field" && rest[1] !== "component") {
          errors.push("forge refactor move requires target: component");
        }
        componentName = rest[2];
        to = rest[3];
        if (!componentName || !to) {
          errors.push("forge refactor move component requires <name> <path>");
        }
      } else if (action === "extract-action") {
        from = rest[1];
        if (!from) {
          errors.push("forge refactor extract-action requires a command name");
        }
      } else if (action === "replace-process-env") {
        from = rest[1];
        if (!from) {
          errors.push("forge refactor replace-process-env requires an env var");
        }
      } else if (action === "replace-import") {
        from = rest[1];
        to = rest[2];
        if (!from || !to) {
          errors.push("forge refactor replace-import requires <from> <to>");
        }
      } else if (action === "apply" || action === "diff" || action === "rollback") {
        planId = rest[1];
        if (!planId) {
          errors.push(`forge refactor ${action} requires a plan id`);
        }
      } else if (action === "plan") {
        const nestedAction = rest[1] as RefactorAction | undefined;
        if (nestedAction === "rename") {
          renameTarget = rest[2] as RenameTarget | undefined;
          from = rest[3];
          to = rest[4];
        } else {
          errors.push("forge refactor plan currently supports: rename <target> <from> <to>");
        }
      }

      return {
        command: {
          kind: "refactor",
          options: {
            action: action === "plan" && rest[1] === "rename" ? "rename" : action,
            renameTarget,
            from,
            to,
            planId,
            componentName,
            packageName: parseOptionValue(argv, "--package"),
            eventName: parseOptionValue(argv, "--event"),
            actionName: parseOptionValue(argv, "--action"),
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            dryRun: parseFlag(argv, "--dry-run"),
            plan: action === "plan" || parseFlag(argv, "--plan"),
            yes: parseFlag(argv, "--yes"),
            force: parseFlag(argv, "--force"),
            allowHighRisk: parseFlag(argv, "--allow-high-risk"),
            noGenerate: parseFlag(argv, "--no-generate"),
            noVerify: parseFlag(argv, "--no-verify"),
            keepFailed: parseFlag(argv, "--keep-failed"),
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "impact": {
      return {
        command: {
          kind: "impact",
          options: {
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            write: parseFlag(argv, "--write"),
            changed: parseFlag(argv, "--changed") || (!parseFlag(argv, "--staged") && !parseOptionValue(argv, "--since") && !parseOptionValue(argv, "--feature") && !parseOptionValue(argv, "--refactor") && !parseOptionValue(argv, "--upgrade")),
            staged: parseFlag(argv, "--staged"),
            since: parseOptionValue(argv, "--since"),
            featureId: parseOptionValue(argv, "--feature"),
            refactorId: parseOptionValue(argv, "--refactor"),
            upgradeId: parseOptionValue(argv, "--upgrade"),
            includeGenerated: parseFlag(argv, "--include-generated"),
            excludeTests: parseFlag(argv, "--exclude-tests"),
            riskThreshold: parseOptionValue(argv, "--risk-threshold") as ImpactCommandOptions["riskThreshold"],
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "test": {
      const subcommand = rest[0] as TestSubcommand | undefined;
      if (!subcommand || !TEST_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge test requires subcommand: plan, run, or explain");
        return { command: null, workspaceRoot, errors };
      }
      const timeoutRaw = parseOptionValue(argv, "--timeout-ms");
      const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
      if (
        timeoutRaw !== undefined &&
        (!Number.isFinite(timeoutMs) || timeoutMs! < 1)
      ) {
        errors.push("--timeout-ms must be a number >= 1");
      }
      return {
        command: {
          kind: "test",
          options: {
            subcommand,
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            write: parseFlag(argv, "--write"),
            changed: parseFlag(argv, "--changed") || (!parseFlag(argv, "--staged") && !parseOptionValue(argv, "--since") && !parseOptionValue(argv, "--feature") && !parseOptionValue(argv, "--refactor") && !parseOptionValue(argv, "--upgrade") && !parseOptionValue(argv, "--plan") && subcommand !== "explain"),
            staged: parseFlag(argv, "--staged"),
            since: parseOptionValue(argv, "--since"),
            featureId: parseOptionValue(argv, "--feature"),
            refactorId: parseOptionValue(argv, "--refactor"),
            upgradeId: parseOptionValue(argv, "--upgrade"),
            planPath: parseOptionValue(argv, "--plan"),
            testFile: subcommand === "explain" ? rest[1] : undefined,
            maxCost: parseTestCost(parseOptionValue(argv, "--max-cost")),
            includeDocker: parseFlag(argv, "--include-docker"),
            includeBrowser: parseFlag(argv, "--include-browser"),
            bail: parseFlag(argv, "--bail"),
            report: parseOptionValue(argv, "--report"),
            timeoutMs: timeoutMs ? Math.floor(timeoutMs) : undefined,
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "repair": {
      const subcommand = rest[0] as RepairSubcommand | undefined;
      if (!subcommand || !REPAIR_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge repair requires subcommand: diagnose, explain, plan, apply, run, list, inspect, or rollback");
        return { command: null, workspaceRoot, errors };
      }
      const positionalId =
        subcommand === "explain" ||
        subcommand === "apply" ||
        subcommand === "inspect" ||
        subcommand === "rollback"
          ? rest[1]
          : undefined;
      const attemptsRaw = parseOptionValue(argv, "--max-attempts");
      const maxAttempts = attemptsRaw ? Number(attemptsRaw) : 1;
      if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
        errors.push("--max-attempts must be a number >= 1");
      }
      return {
        command: {
          kind: "repair",
          options: {
            subcommand,
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            fromLastTestRun: parseFlag(argv, "--from-last-test-run"),
            fromLastUiRun: parseFlag(argv, "--from-last-ui-run"),
            from: parseOptionValue(argv, "--from"),
            traceId: parseOptionValue(argv, "--trace"),
            workflowRunId: parseOptionValue(argv, "--workflow-run"),
            outboxDeliveryId: parseOptionValue(argv, "--outbox-delivery"),
            diagnosticCode:
              parseOptionValue(argv, "--diagnostic") ??
              (subcommand === "explain" ? positionalId : undefined),
            repairId:
              subcommand === "apply" || subcommand === "inspect" || subcommand === "rollback"
                ? positionalId
                : undefined,
            selectedRepair: parseOptionValue(argv, "--repair"),
            write: parseFlag(argv, "--write"),
            yes: parseFlag(argv, "--yes"),
            keepFailed: parseFlag(argv, "--keep-failed"),
            allowMediumConfidence: parseFlag(argv, "--allow-medium-confidence"),
            maxAttempts: Math.floor(maxAttempts),
            commitFriendly: parseFlag(argv, "--commit-friendly"),
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "do": {
      const objective = parseDoObjective(rest, argv);
      return {
        command: {
          kind: "do",
          options: {
            workspaceRoot,
            objective,
            json: parseFlag(argv, "--json"),
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "bench": {
      const subcommand = rest[0] as BenchSubcommand | undefined;
      if (!subcommand || !BENCH_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge bench requires subcommand: compiler");
        return { command: null, workspaceRoot, errors };
      }
      const iterationsRaw = parseOptionValue(argv, "--iterations");
      const warmupsRaw = parseOptionValue(argv, "--warmups");
      const concurrencyRaw = parseOptionValue(argv, "--concurrency");
      const iterations = iterationsRaw !== undefined ? Number(iterationsRaw) : 5;
      const warmups = warmupsRaw !== undefined ? Number(warmupsRaw) : 1;
      const concurrency = concurrencyRaw !== undefined ? Number(concurrencyRaw) : 4;
      if (!Number.isFinite(iterations) || iterations < 1) {
        errors.push("--iterations must be a number >= 1");
      }
      if (!Number.isFinite(warmups) || warmups < 0) {
        errors.push("--warmups must be a number >= 0");
      }
      if (!Number.isFinite(concurrency) || concurrency < 1) {
        errors.push("--concurrency must be a number >= 1");
      }
      return {
        command: {
          kind: "bench",
          options: {
            subcommand,
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            iterations: Math.floor(iterations),
            warmups: Math.floor(warmups),
            concurrency: Math.floor(concurrency),
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "generate": {
      const concurrencyRaw = parseOptionValue(argv, "--concurrency");
      const concurrency = concurrencyRaw ? Number(concurrencyRaw) : 4;
      if (!Number.isFinite(concurrency) || concurrency < 1) {
        errors.push("--concurrency must be an integer >= 1");
      }
      return {
        command: {
          kind: "generate",
          check: parseFlag(argv, "--check"),
          dryRun: parseFlag(argv, "--dry-run"),
          json: parseFlag(argv, "--json"),
          concurrency: Math.max(1, Math.floor(concurrency || 4)),
        },
        workspaceRoot,
        errors,
      };
    }
    case "delta": {
      const subcommand = rest[0];
      if (subcommand !== "status") {
        errors.push("forge delta requires subcommand: status");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "delta",
          subcommand,
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "timeline": {
      const limitRaw = parseOptionValue(argv, "--limit");
      const kindFilter = parseOptionValue(argv, "--kind");
      const target = rest.find((item) => item !== kindFilter && item !== limitRaw);
      const limit = limitRaw ? Number(limitRaw) : undefined;
      if (limitRaw !== undefined && (!Number.isFinite(limit) || limit! < 1)) {
        errors.push("--limit must be a number >= 1");
      }
      return {
        command: {
          kind: "timeline",
          target,
          kindFilter,
          limit: limit ? Math.floor(limit) : undefined,
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "explain": {
      const thing = rest[0];
      if (!thing) {
        errors.push("forge explain requires a target");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "explain",
          thing,
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "manifest": {
      const subcommand = rest[0];
      const path = rest[1];
      if (subcommand !== "validate" && subcommand !== "import") {
        errors.push("forge manifest requires subcommand validate or import");
        return { command: null, workspaceRoot, errors };
      }
      if (!path) {
        errors.push(`forge manifest ${subcommand} requires a manifest file path`);
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "manifest",
          subcommand,
          path,
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "add": {
      const alias = rest[0];
      if (!alias) {
        errors.push("forge add requires an integration alias");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "add",
          alias,
          options: parseAddOptions(argv, workspaceRoot),
        },
        workspaceRoot,
        errors,
      };
    }
    case "inspect": {
      const target = rest[0] as InspectTarget | undefined;
      if (!target || !INSPECT_TARGETS.includes(target)) {
        errors.push(
          `unsupported inspect target; supported: ${INSPECT_TARGETS.join(", ")}`,
        );
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "inspect",
          target,
          json: parseFlag(argv, "--json"),
          dryRun: parseFlag(argv, "--dry-run"),
        },
        workspaceRoot,
        errors,
      };
    }
    case "check":
      return {
        command: {
          kind: "check",
          json: parseFlag(argv, "--json"),
          dryRun: parseFlag(argv, "--dry-run"),
          strictSecrets: parseFlag(argv, "--strict-secrets"),
        },
        workspaceRoot,
        errors,
      };
    case "verify":
      {
        const scriptTimeoutRaw = parseOptionValue(argv, "--script-timeout-ms");
        const scriptTimeoutMs = scriptTimeoutRaw ? Number(scriptTimeoutRaw) : undefined;
        const testJobsRaw = parseOptionValue(argv, "--test-jobs");
        const testJobs = testJobsRaw ? Number(testJobsRaw) : undefined;
        const typechecker = parseOptionValue(argv, "--typechecker");
        if (
          scriptTimeoutRaw !== undefined &&
          (!Number.isFinite(scriptTimeoutMs) || scriptTimeoutMs! < 1)
        ) {
          errors.push("--script-timeout-ms must be a number >= 1");
        }
        if (
          testJobsRaw !== undefined &&
          (!Number.isInteger(testJobs) || testJobs! < 1)
        ) {
          errors.push("--test-jobs must be an integer >= 1");
        }
        if (
          typechecker !== undefined &&
          typechecker !== "tsc" &&
          typechecker !== "tsgo" &&
          typechecker !== "auto"
        ) {
          errors.push("--typechecker must be one of: tsc, tsgo, auto");
        }
      return {
        command: {
          kind: "verify",
          options: {
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            skipTests: parseFlag(argv, "--skip-tests"),
            skipTypecheck: parseFlag(argv, "--skip-typecheck"),
            skipEslint: parseFlag(argv, "--skip-eslint"),
            strict: parseFlag(argv, "--strict"),
            changed: parseFlag(argv, "--changed"),
            fast: parseFlag(argv, "--fast"),
            smoke: parseFlag(argv, "--smoke"),
            standard: parseFlag(argv, "--standard"),
            scriptTimeoutMs: scriptTimeoutMs ? Math.floor(scriptTimeoutMs) : undefined,
            testJobs: testJobs ? Math.floor(testJobs) : undefined,
            typechecker: typechecker as "tsc" | "tsgo" | "auto" | undefined,
            fullTests: parseFlag(argv, "--full"),
            testPlan: parseFlag(argv, "--test-plan"),
          },
        },
        workspaceRoot,
        errors,
      };
      }
    case "run": {
      if (rest[0] === "query") {
        const queryName = rest[1];
        if (!queryName) {
          errors.push("forge run query requires a query name");
        }
        const argsRaw = parseOptionValue(argv, "--args");
        let args: unknown = {};
        if (argsRaw !== undefined) {
          try {
            args = JSON.parse(argsRaw);
          } catch {
            errors.push("--args must be valid JSON");
          }
        }
        return {
          command: {
            kind: "run",
            name: queryName,
            list: false,
            json: parseFlag(argv, "--json"),
            mock: parseFlag(argv, "--mock"),
            userId: parseOptionValue(argv, "--user-id"),
            tenantId: parseOptionValue(argv, "--tenant-id"),
            role: parseOptionValue(argv, "--role"),
            envFile: parseOptionValue(argv, "--env-file"),
            workspaceRoot,
            queryMode: true,
            args,
          },
          workspaceRoot,
          errors,
        };
      }

      const name = rest[0];
      const list = parseFlag(argv, "--list") || !name;
      const argsRaw = parseOptionValue(argv, "--args");
      let args: unknown = {};
      if (argsRaw !== undefined) {
        try {
          args = JSON.parse(argsRaw);
        } catch {
          errors.push("--args must be valid JSON");
        }
      }
      return {
        command: {
          kind: "run",
          name,
          list,
          json: parseFlag(argv, "--json"),
          mock: parseFlag(argv, "--mock"),
          userId: parseOptionValue(argv, "--user-id"),
          tenantId: parseOptionValue(argv, "--tenant-id"),
          role: parseOptionValue(argv, "--role"),
          envFile: parseOptionValue(argv, "--env-file"),
          workspaceRoot,
          args,
        },
        workspaceRoot,
        errors,
      };
    }
    case "query": {
      const requested = rest[0] as QuerySubcommand | undefined;
      const subcommand =
        !requested
          ? "list"
          : ["list", "run"].includes(requested)
            ? requested
            : "run";
      if (!["list", "run"].includes(subcommand)) {
        errors.push("forge query requires subcommand: list or run");
        return { command: null, workspaceRoot, errors };
      }

      const queryName = subcommand === "run"
        ? requested === "run"
          ? rest[1]
          : rest[0]
        : undefined;
      if (subcommand === "run" && !queryName) {
        errors.push("forge query run requires a query name");
      }

      const argsRaw = parseOptionValue(argv, "--args");
      let args: unknown = {};
      if (argsRaw !== undefined) {
        try {
          args = JSON.parse(argsRaw);
        } catch {
          errors.push("--args must be valid JSON");
        }
      }

      return {
        command: {
          kind: "query",
          subcommand,
          name: queryName,
          args,
          json: parseFlag(argv, "--json"),
          userId: parseOptionValue(argv, "--user-id"),
          tenantId: parseOptionValue(argv, "--tenant-id"),
          role: parseOptionValue(argv, "--role"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "live": {
      const requested = rest[0] as LiveSubcommand | undefined;
      const subcommand =
        !requested
          ? "list"
          : LIVE_SUBCOMMANDS.includes(requested)
            ? requested
            : "subscribe";
      const name =
        subcommand === "subscribe"
          ? rest[0]
          : subcommand === "debug"
            ? rest[1]
            : undefined;
      const argsRaw = parseOptionValue(argv, "--args");
      let args: unknown = {};
      if (argsRaw !== undefined) {
        try {
          args = JSON.parse(argsRaw);
        } catch {
          errors.push("--args must be valid JSON");
        }
      }

      return {
        command: {
          kind: "live",
          subcommand,
          name,
          args,
          json: parseFlag(argv, "--json"),
          userId: parseOptionValue(argv, "--user-id"),
          tenantId: parseOptionValue(argv, "--tenant-id"),
          role: parseOptionValue(argv, "--role"),
          url: parseOptionValue(argv, "--url"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "dev": {
      const portRaw = parseOptionValue(argv, "--port");
      const port = portRaw !== undefined ? Number(portRaw) : undefined;
      if (portRaw !== undefined && (!Number.isFinite(port) || port! < 0)) {
        errors.push("--port must be a non-negative integer");
      }
      const webPortRaw = parseOptionValue(argv, "--web-port");
      const webPort = webPortRaw !== undefined ? Number(webPortRaw) : undefined;
      if (webPortRaw !== undefined && (!Number.isFinite(webPort) || webPort! < 1)) {
        errors.push("--web-port must be a positive integer");
      }
      const aiMode = parseOptionValue(argv, "--ai");
      const mockAi =
        parseFlag(argv, "--mock-ai") || aiMode === "mock" || process.env.FORGE_MOCK_AI === "1";
      return {
        command: {
          kind: "dev",
          host: parseOptionValue(argv, "--host"),
          port,
          mock: parseFlag(argv, "--mock"),
          mockAi,
          once: parseFlag(argv, "--once"),
          watch: !parseFlag(argv, "--no-watch") || parseFlag(argv, "--watch"),
          json: parseFlag(argv, "--json"),
          db: parseDbKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          worker: !parseFlag(argv, "--no-worker") || parseFlag(argv, "--worker"),
          withWeb: !parseFlag(argv, "--no-web") && !parseFlag(argv, "--api-only"),
          apiOnly: parseFlag(argv, "--api-only"),
          webOnly: parseFlag(argv, "--web-only"),
          open: parseFlag(argv, "--open"),
          webPort,
          telemetry: (parseOptionValue(argv, "--telemetry") ?? "local")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          envFile: parseOptionValue(argv, "--env-file"),
          skipStartupConsole: parseFlag(argv, "--skip-startup-console"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "db": {
      const subcommand = rest[0] as DbSubcommand | undefined;
      if (!subcommand || !["diff", "migrate", "reset", "status", "rls-check"].includes(subcommand)) {
        errors.push("forge db requires subcommand: diff, migrate, reset, status, or rls-check");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "db",
          subcommand,
          db: parseAdapterKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "workflow": {
      const subcommand = rest[0] as WorkflowSubcommand | undefined;
      if (
        !subcommand ||
        !["list", "run", "inspect", "process", "retry", "cancel"].includes(subcommand)
      ) {
        errors.push(
          "forge workflow requires subcommand: list, run, inspect, process, retry, or cancel",
        );
        return { command: null, workspaceRoot, errors };
      }

      const limitRaw = parseOptionValue(argv, "--limit");
      const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
      if (limitRaw !== undefined && (!Number.isFinite(limit) || limit! < 1)) {
        errors.push("--limit must be an integer >= 1");
      }

      const inputRaw = parseOptionValue(argv, "--input");
      let input: unknown;
      if (inputRaw !== undefined) {
        try {
          input = JSON.parse(inputRaw);
        } catch {
          errors.push("--input must be valid JSON");
        }
      }

      const stepName = parseOptionValue(argv, "--step");
      let runId: number | undefined;
      let workflowName: string | undefined;

      if (subcommand === "run") {
        workflowName = rest[1];
        if (!workflowName) {
          errors.push("forge workflow run requires a workflow name");
        }
      } else if (["inspect", "retry", "cancel"].includes(subcommand)) {
        const runIdRaw = rest[1];
        runId = runIdRaw !== undefined ? Number(runIdRaw) : undefined;
        if (runIdRaw !== undefined && !Number.isFinite(runId)) {
          errors.push("run id must be a number");
        }
        if (!runIdRaw) {
          errors.push(`forge workflow ${subcommand} requires a run id`);
        }
      }

      return {
        command: {
          kind: "workflow",
          subcommand,
          db: parseAdapterKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          json: parseFlag(argv, "--json"),
          once: parseFlag(argv, "--once"),
          watch: parseFlag(argv, "--watch"),
          limit,
          workflowName,
          runId,
          stepName,
          input,
          mock: parseFlag(argv, "--mock"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "outbox": {
      const subcommand = rest[0] as OutboxSubcommand | undefined;
      if (
        !subcommand ||
        !["list", "process", "retry", "dead", "clear"].includes(subcommand)
      ) {
        errors.push(
          "forge outbox requires subcommand: list, process, retry, dead, or clear",
        );
        return { command: null, workspaceRoot, errors };
      }

      const limitRaw = parseOptionValue(argv, "--limit");
      const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
      if (limitRaw !== undefined && (!Number.isFinite(limit) || limit! < 1)) {
        errors.push("--limit must be an integer >= 1");
      }

      const deliveryIdRaw = subcommand === "retry" ? rest[1] : undefined;
      const deliveryId =
        deliveryIdRaw !== undefined ? Number(deliveryIdRaw) : undefined;
      if (deliveryIdRaw !== undefined && !Number.isFinite(deliveryId)) {
        errors.push("delivery id must be a number");
      }

      return {
        command: {
          kind: "outbox",
          subcommand,
          db: parseAdapterKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          json: parseFlag(argv, "--json"),
          once: parseFlag(argv, "--once"),
          watch: parseFlag(argv, "--watch"),
          limit,
          deliveryId,
          mock: parseFlag(argv, "--mock"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "telemetry": {
      const subcommand = rest[0] as TelemetrySubcommand | undefined;
      if (
        !subcommand ||
        !["list", "inspect", "symbolicate", "flush", "tail", "clear"].includes(subcommand)
      ) {
        errors.push(
          "forge telemetry requires subcommand: list, inspect, symbolicate, flush, tail, or clear",
        );
        return { command: null, workspaceRoot, errors };
      }

      let traceId: string | undefined;
      if (subcommand === "inspect" || subcommand === "symbolicate") {
        traceId = rest[1];
        if (!traceId) {
          errors.push("forge telemetry inspect requires a trace id");
        }
      }

      return {
        command: {
          kind: "telemetry",
          subcommand,
          db: parseAdapterKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          json: parseFlag(argv, "--json"),
          traceId,
          sink: parseOptionValue(argv, "--sink"),
          file: parseOptionValue(argv, "--file") as "events" | "exceptions" | "spans" | undefined,
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "policy": {
      const subcommand = rest[0] as PolicySubcommand | undefined;
      if (!subcommand || !["list", "matrix", "simulate", "check"].includes(subcommand)) {
        errors.push("forge policy requires subcommand: list, matrix, simulate, or check");
        return { command: null, workspaceRoot, errors };
      }

      let policyName: string | undefined;
      if (subcommand === "simulate") {
        policyName = rest[1];
        if (!policyName) {
          errors.push("forge policy simulate requires a policy name");
        }
      }

      return {
        command: {
          kind: "policy",
          subcommand,
          json: parseFlag(argv, "--json"),
          policy: policyName,
          role: parseOptionValue(argv, "--role"),
          strictPolicies: parseFlag(argv, "--strict-policies"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "secrets": {
      const subcommand = rest[0] as SecretsSubcommand | undefined;
      if (
        !subcommand ||
        !["list", "check", "print", "set", "unset", "prove"].includes(subcommand)
      ) {
        errors.push(
          "forge secrets requires subcommand: list, check, print, set, unset, or prove",
        );
        return { command: null, workspaceRoot, errors };
      }

      return {
        command: {
          kind: "secrets",
          subcommand,
          json: parseFlag(argv, "--json"),
          redacted: parseFlag(argv, "--redacted"),
          name: subcommand === "set" || subcommand === "unset" ? rest[1] : undefined,
          value: subcommand === "set" ? rest[2] : undefined,
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "env": {
      const subcommand = rest[0] as EnvSubcommand | undefined;
      if (!subcommand || !["list", "check", "print"].includes(subcommand)) {
        errors.push("forge env requires subcommand: list, check, or print");
        return { command: null, workspaceRoot, errors };
      }

      return {
        command: {
          kind: "env",
          subcommand,
          json: parseFlag(argv, "--json"),
          redacted: parseFlag(argv, "--redacted"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "ai": {
      const subcommand = rest[0] as AiSubcommand | undefined;
      if (!subcommand || !AI_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge ai requires subcommand: providers, check, test, models, tools, agents, redteam, or trace");
        return { command: null, workspaceRoot, errors };
      }

      const providerRaw = parseOptionValue(argv, "--provider");
      const provider = providerRaw as ForgeAiProvider | undefined;
      const traceId = subcommand === "trace" ? rest[1] ?? parseOptionValue(argv, "--trace") : undefined;
      if (subcommand === "trace" && !traceId) {
        errors.push("forge ai trace requires a trace id");
      }

      return {
        command: {
          kind: "ai",
          subcommand,
          json: parseFlag(argv, "--json"),
          provider,
          model: parseOptionValue(argv, "--model"),
          prompt: parseOptionValue(argv, "--prompt"),
          mock: parseFlag(argv, "--mock"),
          modelLevel: parseFlag(argv, "--model-level"),
          live: parseFlag(argv, "--live"),
          traceId,
          db: parsePersistentDbKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    default:
      errors.push(`unrecognized command '${commandName}'`);
      return { command: null, workspaceRoot, errors };
  }
}

export function hasUnknownOption(argv: string[]): string | null {
  const known = new Set([
    "--version",
    "--check",
    "--json",
    "--dry-run",
    "--plan",
    "--staged",
    "--since",
    "--feature",
    "--refactor",
    "--upgrade",
    "--include-generated",
    "--exclude-tests",
    "--risk-threshold",
    "--max-cost",
    "--include-docker",
    "--include-browser",
    "--bail",
    "--report",
    "--from-last-test-run",
    "--from-last-ui-run",
    "--from",
    "--trace",
    "--workflow-run",
    "--outbox-delivery",
    "--diagnostic",
    "--repair",
    "--allow-medium-confidence",
    "--max-attempts",
    "--commit-friendly",
    "--fast",
    "--smoke",
    "--standard",
    "--script-timeout-ms",
    "--test-plan",
    "--typechecker",
    "--timeout-ms",
    "--apply",
    "--runtime-inspect",
    "--allow-scripts",
    "--yes",
    "--force",
    "--no-generate",
    "--no-verify",
    "--keep-failed",
    "--tenant-scoped",
    "--field",
    "--fields",
    "--type",
    "--values",
    "--default",
    "--index",
    "--roles",
    "--table",
    "--policy",
    "--emit",
    "--event",
    "--trigger",
    "--component",
    "--framework",
    "--package",
    "--action",
    "--with-ai",
    "--with-crud",
    "--with-livequery",
    "--with-react",
    "--with-ui",
    "--with-tests",
    "--with-create-form",
    "--write",
    "--md",
    "--sarif",
    "--fail-on",
    "--mode",
    "--include",
    "--exclude",
    "--base",
    "--headed",
    "--browser",
    "--trace",
    "--screenshot",
    "--video",
    "--base-url",
    "--runtime-url",
    "--reuse-servers",
    "--start-servers",
    "--scenario",
    "--all",
    "--ci",
    "--timeout",
    "--name",
    "--auth-token",
    "--update",
    "--allow-high-risk",
    "--to",
    "--changed",
    "--env",
    "--input",
    "--provider",
    "--target",
    "--release",
    "--allow-dirty",
    "--allow-public-sourcemaps",
    "--with-release",
    "--concurrency",
    "--iterations",
    "--warmups",
    "--sandbox-backend",
    "--skip-tests",
    "--test-jobs",
    "--skip-typecheck",
    "--skip-eslint",
    "--mock",
    "--list",
    "--port",
    "--host",
    "--watch",
    "--no-watch",
    "--db",
    "--database-url",
    "--worker",
    "--no-worker",
    "--once",
    "--limit",
    "--kind",
    "--input",
    "--args",
    "--step",
    "--sink",
    "--file",
    "--telemetry",
    "--user-id",
    "--tenant-id",
    "--role",
    "--strict-policies",
    "--strict",
    "--strict-secrets",
    "--env-file",
    "--skip-startup-console",
    "--redacted",
    "--mock-ai",
    "--ai",
    "--provider",
    "--model",
    "--prompt",
    "--url",
    "--template",
    "--package-manager",
    "--forge-spec",
    "--local-forge",
    "--install",
    "--no-install",
    "--no-git",
    "--with-web",
    "--no-web",
    "--api-only",
    "--web-only",
    "--open",
    "--postgres-version",
    "--runtime-port",
    "--web-port",
    "--poll-interval",
    "--allow-dev-auth",
    "--token",
    "--no-preserve-user-sections",
    "--no-skills",
    "--no-rules",
    "--full",
    "--run-tests",
    "--model-level",
    "--live",
    "--no-delta",
  ]);

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    if (known.has(arg)) {
      if (
        arg === "--concurrency" ||
        arg === "--iterations" ||
        arg === "--warmups" ||
        arg === "--field" ||
        arg === "--fields" ||
        arg === "--type" ||
        arg === "--values" ||
        arg === "--default" ||
        arg === "--roles" ||
        arg === "--table" ||
        arg === "--policy" ||
        arg === "--emit" ||
        arg === "--event" ||
        arg === "--trigger" ||
        arg === "--component" ||
        arg === "--package" ||
        arg === "--action" ||
        arg === "--since" ||
        arg === "--feature" ||
        arg === "--refactor" ||
        arg === "--upgrade" ||
        arg === "--risk-threshold" ||
        arg === "--max-cost" ||
        arg === "--report" ||
        arg === "--from" ||
        arg === "--trace" ||
        arg === "--workflow-run" ||
        arg === "--outbox-delivery" ||
        arg === "--diagnostic" ||
        arg === "--repair" ||
        arg === "--max-attempts" ||
        arg === "--write" ||
        arg === "--fail-on" ||
        arg === "--mode" ||
        arg === "--include" ||
        arg === "--exclude" ||
        arg === "--base" ||
        arg === "--browser" ||
        arg === "--trace" ||
        arg === "--screenshot" ||
        arg === "--video" ||
        arg === "--base-url" ||
        arg === "--runtime-url" ||
        arg === "--scenario" ||
        arg === "--timeout" ||
        arg === "--timeout-ms" ||
        arg === "--test-jobs" ||
        arg === "--typechecker" ||
        arg === "--name" ||
        arg === "--auth-token" ||
        arg === "--sandbox-backend" ||
        arg === "--port" ||
        arg === "--host" ||
        arg === "--db" ||
        arg === "--database-url" ||
        arg === "--limit" ||
        arg === "--kind" ||
        arg === "--input" ||
        arg === "--args" ||
        arg === "--step" ||
        arg === "--sink" ||
        arg === "--file" ||
        arg === "--telemetry" ||
        arg === "--user-id" ||
        arg === "--tenant-id" ||
        arg === "--role" ||
        arg === "--strict-policies" ||
        arg === "--env-file" ||
        arg === "--ai" ||
        arg === "--provider" ||
        arg === "--model" ||
        arg === "--prompt" ||
        arg === "--url" ||
        arg === "--template" ||
        arg === "--package-manager" ||
        arg === "--forge-spec" ||
        arg === "--postgres-version" ||
        arg === "--runtime-port" ||
        arg === "--web-port" ||
        arg === "--poll-interval" ||
        arg === "--token"
        || arg === "--to" ||
        arg === "--env" ||
        arg === "--input" ||
        arg === "--provider" ||
        arg === "--target" ||
        arg === "--release"
      ) {
        index += 1;
      }
      continue;
    }
    return arg;
  }

  return null;
}
