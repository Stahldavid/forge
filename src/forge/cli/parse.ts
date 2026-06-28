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
import type { DocsSubcommand } from "./docs.ts";
import type { AgentContractSubcommand } from "./agent-contract.ts";
import type { AuthSubcommand } from "./auth.ts";
import type { BaselineSubcommand } from "./baseline.ts";
import type { AuthMdSubcommand } from "./authmd.ts";
import type { WorkOSSubcommand } from "./workos.ts";
import type { DeploySubcommand, DeployTarget } from "./deploy.ts";
import type { FieldTestSubcommand } from "./field-test.ts";
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
import type { BrownfieldImportCommandOptions } from "../brownfield-import/types.ts";
import type { CairCommandOptions, CairSubcommand } from "../cair/types.ts";

export type ForgeCommand =
  | { kind: "version"; json: boolean }
  | { kind: "last"; json: boolean; workspaceRoot: string }
  | { kind: "baseline"; subcommand: BaselineSubcommand; json: boolean; reason?: string; workspaceRoot: string }
  | {
      kind: "new";
      name: string;
      template: NewTemplateName;
      packageManager: NewPackageManager;
      install: boolean;
      git: boolean;
      forgePackageSpec?: string;
      localForge: boolean;
      json: boolean;
      fieldTest: boolean;
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
      preparedOnly?: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "docs";
      subcommand: DocsSubcommand;
      json: boolean;
      build: boolean;
      installVenv: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "agent-contract";
      subcommand: AgentContractSubcommand;
      json: boolean;
      workspaceRoot: string;
    }
  | { kind: "doctor"; target?: "project" | "windows" | "agent" | "delta" | "pglite" | "runtime"; agentTarget?: AgentAdapterTarget; json: boolean; workspaceRoot: string }
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
      prod?: boolean;
      scenario?: string;
      workspaceRoot: string;
    }
  | {
      kind: "authmd";
      subcommand: AuthMdSubcommand;
      json: boolean;
      output?: string;
      workspaceRoot: string;
    }
  | {
      kind: "workos";
      subcommand: WorkOSSubcommand;
      json: boolean;
      file?: string;
      yes: boolean;
      dryRun: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "deploy";
      subcommand: DeploySubcommand;
      target: DeployTarget;
      production: boolean;
      url?: string;
      json: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "field-test";
      subcommand: FieldTestSubcommand;
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
      json: boolean;
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
      allowMissingLocalRelease?: boolean;
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
  | { kind: "cair"; options: CairCommandOptions }
  | { kind: "agent"; options: AgentCommandOptions }
  | { kind: "mcp"; subcommand: "serve"; workspaceRoot: string }
  | { kind: "review"; options: ReviewCommandOptions }
  | { kind: "ui"; options: UiCommandOptions }
  | { kind: "manifest"; subcommand: "validate" | "import"; path: string; json: boolean; workspaceRoot: string }
  | { kind: "import"; options: BrownfieldImportCommandOptions }
  | {
      kind: "delta";
      subcommand: "status" | "repair" | "compact" | "prune" | "export";
      json: boolean;
      workspaceRoot: string;
      dryRun: boolean;
      yes: boolean;
      verbose: boolean;
      olderThan?: string;
      output?: string;
      limit?: number;
      redacted: boolean;
    }
  | { kind: "status"; json: boolean; workspaceRoot: string }
  | { kind: "changed"; json: boolean; authoredOnly: boolean; reviewOnly: boolean; commitReady: boolean; workspaceRoot: string }
  | { kind: "diff"; target: "authored" | "generated" | "full"; json: boolean; workspaceRoot: string }
  | { kind: "handoff"; json: boolean; commitReady: boolean; workspaceRoot: string }
  | {
      kind: "studio";
      subcommand: "attach" | "snapshot" | "watch" | "open" | "doctor" | "bridge" | "codex-server";
      path?: string;
      previewUrl?: string;
      previewPort?: number;
      studioUrl?: string;
      intervalMs?: number;
      once: boolean;
      workspaceId?: string;
      tenantId?: string;
      userId?: string;
      role?: string;
      targets: string[];
      install?: boolean;
      start?: boolean;
      bridge?: boolean;
      writeSchemas?: boolean;
      probeAppServer?: boolean;
      json: boolean;
      dryRun: boolean;
      force: boolean;
      workspaceRoot: string;
    }
  | { kind: "timeline"; target?: string; kindFilter?: string; sessionId?: string; limit?: number; json: boolean; rebuild: boolean; forAgent: boolean; causal: boolean; staleProofs: boolean; workspaceRoot: string }
  | { kind: "explain"; thing: string; json: boolean; workspaceRoot: string }
  | {
      kind: "session";
      subcommand: "list" | "show" | "rename" | "merge" | "split" | "detach";
      sessionId?: string;
      sourceSessionId?: string;
      operationId?: string;
      title?: string;
      limit?: number;
      json: boolean;
      workspaceRoot: string;
    }
  | { kind: "generate"; check: boolean; dryRun: boolean; json: boolean; concurrency: number; workspaceRoot: string }
  | { kind: "add"; alias: string; options: AddOptions & { workspaceRoot: string } }
  | { kind: "inspect"; target: InspectTarget; json: boolean; dryRun: boolean; full: boolean; brief: boolean; ergonomics: boolean; workspaceRoot: string }
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
      detach: boolean;
      lifecycle?: "status" | "stop";
      workspaceRoot: string;
    }
  | {
      kind: "db";
      subcommand: DbSubcommand;
      db: DbAdapterKind;
      databaseUrl?: string;
      local?: boolean;
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
  "last",
  "baseline",
  "new",
  "build",
  "serve",
  "worker",
  "self-host",
  "docs",
  "agent-contract",
  "agent",
  "mcp",
  "review",
  "ui",
  "doctor",
  "setup",
  "security",
  "auth",
  "authmd",
  "workos",
  "deploy",
  "field-test",
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
  "cair",
  "delta",
  "session",
  "timeline",
  "explain",
  "manifest",
  "import",
  "status",
  "changed",
  "diff",
  "handoff",
  "studio",
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
  "summary",
  "schema",
  "drift",
  "handoff",
  "framework",
  "imported",
  "ui",
  "ui-scenarios",
  "ui-routes",
  "all",
  "rules",
  "map",
];

const NEW_TEMPLATES: NewTemplateName[] = ["agent-workroom", "b2b-support-web", "minimal-web", "nuxt-web"];
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
  "status",
];
const BASELINE_SUBCOMMANDS: BaselineSubcommand[] = ["create", "status"];
const AUTHMD_SUBCOMMANDS: AuthMdSubcommand[] = ["generate", "check"];
const WORKOS_SUBCOMMANDS: WorkOSSubcommand[] = ["install", "doctor", "seed"];
const DEPLOY_SUBCOMMANDS: DeploySubcommand[] = ["plan", "check", "render", "verify"];
const FIELD_TEST_SUBCOMMANDS: FieldTestSubcommand[] = ["create", "run", "report"];
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
const TEST_SUBCOMMANDS: TestSubcommand[] = ["plan", "run", "explain", "authz"];
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
  "onboard",
  "print-context",
  "clean",
  "prepare",
  "hooks",
  "install",
  "ingest",
  "context",
  "memory",
  "timeline",
];
const REVIEW_SUBCOMMANDS: ReviewSubcommand[] = ["run", "inspect", "list", "explain"];
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
  "audit",
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
const CAIR_SUBCOMMANDS: CairSubcommand[] = ["snapshot", "query", "action"];

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
  mode: AddOptions["mode"] = "auto",
): AddOptions & { workspaceRoot: string } {
  const frontend = parseFlag(args, "--frontend");
  const backend = parseFlag(args, "--backend");
  return {
    workspaceRoot,
    json: parseFlag(args, "--json"),
    dryRun: parseFlag(args, "--dry-run"),
    runtimeInspect: parseFlag(args, "--runtime-inspect"),
    sandboxBackend: parseSandboxBackend(
      parseOptionValue(args, "--sandbox-backend"),
    ),
    allowScripts: parseFlag(args, "--allow-scripts"),
    mode,
    installWorkspace: parseOptionValue(args, "--workspace"),
    packageTarget: frontend && !backend ? "frontend" : backend ? "backend" : undefined,
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

function parseCommaList(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTemplateList(value: string | undefined, errors: string[], optionName: string): NewTemplateName[] | undefined {
  if (!value) return undefined;
  const values = parseCommaList(value);
  const unsupported = values.filter((item) => !NEW_TEMPLATES.includes(item as NewTemplateName));
  if (unsupported.length > 0) {
    errors.push(`${optionName} contains unsupported template(s): ${unsupported.join(", ")}; supported: ${NEW_TEMPLATES.join(", ")}`);
  }
  return values.filter((item) => NEW_TEMPLATES.includes(item as NewTemplateName)) as NewTemplateName[];
}

function parsePackageManagerList(value: string | undefined, errors: string[], optionName: string): NewPackageManager[] | undefined {
  if (!value) return undefined;
  const values = parseCommaList(value);
  const unsupported = values.filter((item) => !NEW_PACKAGE_MANAGERS.includes(item as NewPackageManager));
  if (unsupported.length > 0) {
    errors.push(`${optionName} contains unsupported package manager(s): ${unsupported.join(", ")}; supported: ${NEW_PACKAGE_MANAGERS.join(", ")}`);
  }
  return values.filter((item) => NEW_PACKAGE_MANAGERS.includes(item as NewPackageManager)) as NewPackageManager[];
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
    case "version":
      return {
        command: { kind: "version", json: parseFlag(argv, "--json") },
        workspaceRoot,
        errors,
      };
    case "last":
      return {
        command: { kind: "last", json: parseFlag(argv, "--json"), workspaceRoot },
        workspaceRoot,
        errors,
      };
    case "baseline": {
      const subcommand = (rest[0] ?? "status") as BaselineSubcommand;
      if (!BASELINE_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge baseline requires subcommand: create or status");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "baseline",
          subcommand,
          reason: parseOptionValue(argv, "--reason"),
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
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
      if (parseFlag(argv, "--field-test") && noInstall) {
        errors.push("forge new --field-test requires installation; remove --no-install");
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
          json: parseFlag(argv, "--json"),
          fieldTest: parseFlag(argv, "--field-test"),
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
          preparedOnly: parseFlag(argv, "--prepared-only"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "docs": {
      const subcommand = rest[0] as DocsSubcommand | undefined;
      if (subcommand !== "check") {
        errors.push("forge docs requires subcommand: check");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "docs",
          subcommand,
          json: parseFlag(argv, "--json"),
          build: parseFlag(argv, "--build"),
          installVenv: parseFlag(argv, "--install-venv"),
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
        errors.push("forge agent requires subcommand: list-targets, export, check, doctor, onboard, print-context, clean, prepare, hooks, install, ingest, context, memory, or timeline");
        return { command: null, workspaceRoot, errors };
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
      const limitRaw = parseOptionValue(argv, "--limit");
      const limit = limitRaw ? Number(limitRaw) : undefined;
      const pollIntervalRaw = parseOptionValue(argv, "--poll-interval");
      const pollIntervalMs = pollIntervalRaw ? Number(pollIntervalRaw) : undefined;
      if (limitRaw !== undefined && (!Number.isFinite(limit) || limit! < 1)) {
        errors.push("--limit must be a number >= 1");
      }
      if (
        pollIntervalRaw !== undefined &&
        (!Number.isFinite(pollIntervalMs) || pollIntervalMs! < 100)
      ) {
        errors.push("--poll-interval must be a number >= 100");
      }
      const target =
        (parseOptionValue(argv, "--target") as AgentAdapterTarget | undefined) ??
        (subcommand === "install" || subcommand === "ingest" ? rest[1] : undefined) ??
        (subcommand === "hooks" ? rest[2] : undefined) ??
        (subcommand === "timeline" ? rest[1] : undefined) ??
        (subcommand === "timeline" ? "all" : undefined) ??
        (subcommand === "hooks" || subcommand === "onboard" ? "codex" : "generic");
      const contextOptionValues = new Set(
        [
          parseOptionValue(argv, "--entry"),
          parseOptionValue(argv, "--change"),
          parseOptionValue(argv, "--proof"),
          parseOptionValue(argv, "--event"),
          parseOptionValue(argv, "--input"),
          parseOptionValue(argv, "--target"),
          parseOptionValue(argv, "--file"),
          limitRaw,
          pollIntervalRaw,
        ].filter((value): value is string => typeof value === "string"),
      );
      const contextEntry = subcommand === "context"
        ? rest.slice(1).find((part) => !part.startsWith("--") && !contextOptionValues.has(part))
        : undefined;
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
            eventName: parseOptionValue(argv, "--event"),
            hookAction: subcommand === "hooks" ? rest[1] : undefined,
            input,
            entry: parseOptionValue(argv, "--entry") ?? contextEntry,
            change: parseOptionValue(argv, "--change"),
            proof: parseOptionValue(argv, "--proof"),
            handoff: parseFlag(argv, "--handoff"),
            current: parseFlag(argv, "--current"),
            limit: limit ? Math.floor(limit) : undefined,
            watch: parseFlag(argv, "--watch"),
            file: parseOptionValue(argv, "--file"),
            pollIntervalMs: pollIntervalMs ? Math.floor(pollIntervalMs) : undefined,
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "mcp": {
      const subcommand = rest[0];
      if (subcommand !== "serve") {
        errors.push("forge mcp requires subcommand: serve");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "mcp",
          subcommand,
          workspaceRoot,
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
            full: parseFlag(argv, "--full"),
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
        errors.push("forge ui requires subcommand: audit, smoke, test, scenario, route, snapshot, report, doctor, or list");
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
      if (rest[0] && rest[0] !== "windows" && rest[0] !== "agent" && rest[0] !== "delta" && rest[0] !== "pglite" && rest[0] !== "runtime") {
        errors.push("forge doctor supports subcommand: windows, agent, delta, pglite, or runtime");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "doctor",
          target: rest[0] === "windows"
            ? "windows"
            : rest[0] === "agent"
              ? "agent"
              : rest[0] === "delta"
                ? "delta"
                : rest[0] === "pglite"
                  ? "pglite"
                  : rest[0] === "runtime"
                    ? "runtime"
                  : "project",
          agentTarget: rest[0] === "agent"
            ? (parseOptionValue(argv, "--target") as AgentAdapterTarget | undefined) ?? (rest[1] as AgentAdapterTarget | undefined) ?? "codex"
            : undefined,
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
        errors.push("forge auth requires subcommand: check, config, decode, test-token, jwks, prove, or status");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "auth",
          subcommand,
          json: parseFlag(argv, "--json"),
          token: parseOptionValue(argv, "--token"),
          prod: parseFlag(argv, "--prod") || parseFlag(argv, "--production"),
          scenario: parseOptionValue(argv, "--scenario"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "authmd": {
      const subcommand = rest[0] as AuthMdSubcommand | undefined;
      if (!subcommand || !AUTHMD_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge authmd requires subcommand: generate or check");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "authmd",
          subcommand,
          json: parseFlag(argv, "--json"),
          output: parseOptionValue(argv, "--output"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "workos": {
      const subcommand = rest[0] as WorkOSSubcommand | undefined;
      if (!subcommand || !WORKOS_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge workos requires subcommand: install, doctor, or seed");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "workos",
          subcommand,
          json: parseFlag(argv, "--json"),
          file: parseOptionValue(argv, "--file"),
          yes: parseFlag(argv, "--yes"),
          dryRun: parseFlag(argv, "--dry-run"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "deploy": {
      const subcommand = rest[0] as DeploySubcommand | undefined;
      if (!subcommand || !DEPLOY_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge deploy requires subcommand: plan, check, render, or verify");
        return { command: null, workspaceRoot, errors };
      }
      const targetRaw = parseOptionValue(argv, "--target") ?? (subcommand === "render" ? rest[1] : undefined) ?? "docker";
      if (targetRaw !== "docker" && targetRaw !== "forge-cloud") {
        errors.push("forge deploy --target must be docker or forge-cloud");
      }
      return {
        command: {
          kind: "deploy",
          subcommand,
          target: targetRaw as DeployTarget,
          production: parseFlag(argv, "--production") || parseFlag(argv, "--prod"),
          url: parseOptionValue(argv, "--url"),
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "field-test": {
      const subcommand = rest[0] as FieldTestSubcommand | undefined;
      if (!subcommand || !FIELD_TEST_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge field-test requires subcommand: create, run, or report");
        return { command: null, workspaceRoot, errors };
      }
      const timeoutRaw = parseOptionValue(argv, "--timeout-ms");
      const timeoutMs = timeoutRaw ? Number(timeoutRaw) : 180_000;
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
        errors.push("--timeout-ms must be a positive integer");
      }
      const authRaw = parseOptionValue(argv, "--auth") ?? "none";
      if (authRaw !== "none" && authRaw !== "workos") {
        errors.push("forge field-test --auth must be none or workos");
      }
      const templates = parseTemplateList(parseOptionValue(argv, "--templates"), errors, "--templates");
      const packageManagers = parsePackageManagerList(parseOptionValue(argv, "--package-managers"), errors, "--package-managers");
      return {
        command: {
          kind: "field-test",
          subcommand,
          name: subcommand === "create" ? rest[1] : undefined,
          template: parseNewTemplate(parseOptionValue(argv, "--template") ?? "minimal-web"),
          templates,
          packageManager: parseNewPackageManager(parseOptionValue(argv, "--package-manager") ?? "npm"),
          packageManagers,
          forgeSpec: parseOptionValue(argv, "--forge-spec"),
          auth: authRaw as "none" | "workos",
          dryRun: parseFlag(argv, "--dry-run"),
          keep: parseFlag(argv, "--keep"),
          runtimeProbes: parseFlag(argv, "--runtime-probes"),
          authProbes: parseFlag(argv, "--auth-probes"),
          timeoutMs: Math.floor(timeoutMs),
          writeReport: parseOptionValue(argv, "--write-report") ?? parseOptionValue(argv, "--file"),
          json: parseFlag(argv, "--json"),
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
          allowMissingLocalRelease: parseFlag(argv, "--allow-missing-local-release"),
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
            framework: parseOptionValue(argv, "--framework") as "vite" | "next" | "nuxt" | undefined,
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
        errors.push("forge test requires subcommand: plan, run, explain, or authz");
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
            changed: parseFlag(argv, "--changed") || (!parseFlag(argv, "--staged") && !parseOptionValue(argv, "--since") && !parseOptionValue(argv, "--feature") && !parseOptionValue(argv, "--refactor") && !parseOptionValue(argv, "--upgrade") && !parseOptionValue(argv, "--plan") && subcommand !== "explain" && subcommand !== "authz"),
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
            tenant: parseOptionValue(argv, "--tenant") ?? "acme",
            otherTenant: parseOptionValue(argv, "--other-tenant") ?? "globex",
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
    case "cair": {
      const subcommand = rest[0] as CairSubcommand | undefined;
      if (!subcommand || !CAIR_SUBCOMMANDS.includes(subcommand)) {
        errors.push("forge cair requires subcommand: snapshot, query, or action");
        return { command: null, workspaceRoot, errors };
      }
      const formatRaw = parseOptionValue(argv, "--format");
      if (formatRaw !== undefined && formatRaw !== "text" && formatRaw !== "json") {
        errors.push("--format must be text or json");
      }
      const query = subcommand === "query" ? rest.slice(1).join(" ").trim() : undefined;
      if (subcommand === "query" && !query) {
        errors.push("forge cair query requires a CAIR query, for example: forge cair query \"Q STATUS\"");
      }
      const inputPath = parseOptionValue(argv, "--input");
      const action = subcommand === "action"
        ? rest.slice(1).filter((part, index, parts) => {
          const previous = parts[index - 1];
          if (part === "--dry-run" || part === "--plan" || part === "--json" || part === "--include-generated") {
            return false;
          }
          if (part === "--format" || part === "--input") {
            return false;
          }
          if (previous === "--format" || previous === "--input") {
            return false;
          }
          return true;
        }).join(" ").trim()
        : undefined;
      if (subcommand === "action" && !action && !inputPath) {
        errors.push("forge cair action requires a CAIR action, for example: forge cair action \"A CREATE.FILE path=src/example.ts\"");
      }
      return {
        command: {
          kind: "cair",
          options: {
            subcommand,
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            format: formatRaw === "json" ? "json" : "text",
            ...(query ? { query } : {}),
            ...(action ? { action } : {}),
            ...(inputPath ? { inputPath } : {}),
            dryRun: parseFlag(argv, "--dry-run"),
            plan: parseFlag(argv, "--plan"),
            allowGenerated: parseFlag(argv, "--include-generated"),
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "status":
      return {
        command: {
          kind: "status",
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    case "changed":
      return {
        command: {
          kind: "changed",
          json: parseFlag(argv, "--json"),
          authoredOnly: parseFlag(argv, "--authored"),
          reviewOnly: parseFlag(argv, "--review"),
          commitReady: parseFlag(argv, "--commit-ready"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    case "diff": {
      const target = (rest[0] ?? "authored") as "authored" | "generated" | "full";
      if (!["authored", "generated", "full"].includes(target)) {
        errors.push("forge diff requires target: authored, generated, or full");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "diff",
          target,
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "handoff":
      return {
        command: {
          kind: "handoff",
          json: parseFlag(argv, "--json"),
          commitReady: parseFlag(argv, "--commit-ready"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    case "studio": {
      const subcommand = rest[0];
      if (
        subcommand !== "attach" &&
        subcommand !== "snapshot" &&
        subcommand !== "watch" &&
        subcommand !== "open" &&
        subcommand !== "doctor" &&
        subcommand !== "bridge" &&
        subcommand !== "codex-server"
      ) {
        errors.push("forge studio requires subcommand: attach, snapshot, watch, open, doctor, bridge, or codex-server");
        return { command: null, workspaceRoot, errors };
      }
      const previewPortRaw = parseOptionValue(argv, "--preview-port");
      const previewPort = previewPortRaw !== undefined ? Number(previewPortRaw) : undefined;
      if (
        previewPortRaw !== undefined &&
        (!Number.isInteger(previewPort) || previewPort! < 1)
      ) {
        errors.push("--preview-port must be an integer >= 1");
      }
      const intervalRaw = parseOptionValue(argv, "--interval-ms");
      const intervalMs = intervalRaw !== undefined ? Number(intervalRaw) : undefined;
      if (intervalRaw !== undefined && (!Number.isFinite(intervalMs) || intervalMs! < 1000)) {
        errors.push("--interval-ms must be a number >= 1000");
      }
      const targets = parseOptionValues(argv, "--target");
      const ignoredOptionValues = new Set(
        [
          ...targets,
          parseOptionValue(argv, "--preview-url"),
          parseOptionValue(argv, "--studio-url"),
          parseOptionValue(argv, "--workspace-id"),
          parseOptionValue(argv, "--tenant-id"),
          parseOptionValue(argv, "--user-id"),
          parseOptionValue(argv, "--role"),
          previewPortRaw,
          intervalRaw,
        ].filter((value): value is string => typeof value === "string"),
      );
      const studioPath = rest.slice(1).find((item) => !ignoredOptionValues.has(item));
      return {
        command: {
          kind: "studio",
          subcommand,
          path: studioPath,
          previewUrl: parseOptionValue(argv, "--preview-url"),
          previewPort: previewPort ? Math.floor(previewPort) : undefined,
          studioUrl: parseOptionValue(argv, "--studio-url"),
          intervalMs: intervalMs ? Math.floor(intervalMs) : undefined,
          once: parseFlag(argv, "--once"),
          workspaceId: parseOptionValue(argv, "--workspace-id"),
          tenantId: parseOptionValue(argv, "--tenant-id"),
          userId: parseOptionValue(argv, "--user-id"),
          role: parseOptionValue(argv, "--role"),
          targets: targets.length > 0 ? targets : ["codex"],
          install: parseFlag(argv, "--install"),
          start: !parseFlag(argv, "--no-start"),
          bridge: !parseFlag(argv, "--no-bridge"),
          writeSchemas: parseFlag(argv, "--write"),
          probeAppServer: parseFlag(argv, "--probe") || parseFlag(argv, "--probe-codex-server"),
          json: parseFlag(argv, "--json"),
          dryRun: parseFlag(argv, "--dry-run"),
          force: parseFlag(argv, "--force"),
          workspaceRoot,
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
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "delta": {
      const subcommand = rest[0];
      if (subcommand !== "status" && subcommand !== "repair" && subcommand !== "compact" && subcommand !== "prune" && subcommand !== "export") {
        errors.push("forge delta requires subcommand: status, repair, compact, prune, or export");
        return { command: null, workspaceRoot, errors };
      }
      const limitRaw = parseOptionValue(argv, "--limit");
      const limit = limitRaw ? Number(limitRaw) : undefined;
      return {
        command: {
          kind: "delta",
          subcommand,
          json: parseFlag(argv, "--json"),
          dryRun: parseFlag(argv, "--dry-run"),
          yes: parseFlag(argv, "--yes"),
          verbose: parseFlag(argv, "--verbose"),
          olderThan: parseOptionValue(argv, "--older-than"),
          output: parseOptionValue(argv, "--output"),
          limit: Number.isFinite(limit) ? limit : undefined,
          redacted: parseFlag(argv, "--redacted"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "session": {
      const subcommand = rest[0];
      if (subcommand !== "list" && subcommand !== "show" && subcommand !== "rename" && subcommand !== "merge" && subcommand !== "split" && subcommand !== "detach") {
        errors.push("forge session requires subcommand: list, show, rename, merge, split, or detach");
        return { command: null, workspaceRoot, errors };
      }
      const limitRaw = parseOptionValue(argv, "--limit");
      const limit = limitRaw ? Number(limitRaw) : undefined;
      if (limitRaw !== undefined && (!Number.isFinite(limit) || limit! < 1)) {
        errors.push("--limit must be a number >= 1");
      }
      const sessionId = rest[1];
      return {
        command: {
          kind: "session",
          subcommand,
          sessionId: subcommand === "detach" ? undefined : sessionId,
          sourceSessionId: subcommand === "merge" ? rest[2] : undefined,
          operationId: subcommand === "split" ? rest[2] : subcommand === "detach" ? rest[1] : undefined,
          title: subcommand === "rename" ? rest.slice(2).join(" ") : undefined,
          limit: limit ? Math.floor(limit) : undefined,
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
      const sessionId = parseOptionValue(argv, "--session");
      const rebuild = rest[0] === "rebuild";
      const optionValues = new Set([limitRaw, kindFilter, sessionId].filter((value): value is string => typeof value === "string"));
      const target = rebuild
        ? undefined
        : rest.find((item) => !item.startsWith("--") && !optionValues.has(item));
      const limit = limitRaw ? Number(limitRaw) : undefined;
      if (limitRaw !== undefined && (!Number.isFinite(limit) || limit! < 1)) {
        errors.push("--limit must be a number >= 1");
      }
      return {
        command: {
          kind: "timeline",
          target,
            kindFilter,
            sessionId,
            limit: limit ? Math.floor(limit) : undefined,
            json: parseFlag(argv, "--json"),
            rebuild,
            forAgent: parseFlag(argv, "--for-agent"),
            causal: parseFlag(argv, "--causal"),
            staleProofs: parseFlag(argv, "--stale-proofs"),
            workspaceRoot,
          },
        workspaceRoot,
        errors,
      };
    }
    case "explain": {
      const thing = rest[0] === "session" ? `session:${rest[1] ?? "current"}` : rest[0];
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
    case "import": {
      const subcommand = rest[0];
      if (subcommand !== "analyze" && subcommand !== "inspect") {
        errors.push("forge import requires subcommand analyze or inspect");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "import",
          options: {
            subcommand,
            json: parseFlag(argv, "--json"),
            dryRun: parseFlag(argv, "--dry-run"),
            workspaceRoot,
            entry: parseOptionValue(argv, "--entry"),
            target: parseOptionValue(argv, "--target"),
          },
        },
        workspaceRoot,
        errors,
      };
    }
    case "add": {
      const subcommand = rest[0];
      const explicitMode =
        subcommand === "package"
          ? "package"
          : subcommand === "integration" || subcommand === "auth"
            ? "integration"
            : "auto";
      const alias = explicitMode === "auto" ? rest[0] : rest[1];
      if (!alias) {
        errors.push(
          explicitMode === "auto"
            ? "forge add requires a package name or integration alias"
            : `forge add ${subcommand} requires a target`,
        );
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "add",
          alias,
          options: parseAddOptions(argv, workspaceRoot, explicitMode),
        },
        workspaceRoot,
        errors,
      };
    }
    case "inspect": {
      const target = (rest[0] as InspectTarget | undefined) ?? "summary";
      if (!INSPECT_TARGETS.includes(target)) {
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
          full: parseFlag(argv, "--full"),
          brief: parseFlag(argv, "--brief"),
          ergonomics: parseFlag(argv, "--ergonomics"),
          workspaceRoot,
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
        const verifyOptionValues = new Set(
          [scriptTimeoutRaw, testJobsRaw, typechecker]
            .filter((value): value is string => typeof value === "string"),
        );
        const profileAlias = rest.find((item) => !verifyOptionValues.has(item));
        const verifyProfiles = new Set([
          "quick",
          "smoke",
          "agent",
          "standard",
          "release",
          "strict",
          "changed",
          "framework",
          "internal",
          "maintainer",
        ]);
        if (profileAlias && !verifyProfiles.has(profileAlias)) {
          errors.push(
            `unknown forge verify profile '${profileAlias}'; expected quick, smoke, agent, standard, release, strict, changed, framework, internal, or maintainer`,
          );
        }
        const internal =
          parseFlag(argv, "--internal") ||
          profileAlias === "framework" ||
          profileAlias === "internal" ||
          profileAlias === "maintainer";
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
          typechecker !== "native" &&
          typechecker !== "ts7" &&
          typechecker !== "tsgo" &&
          typechecker !== "auto"
        ) {
          errors.push("--typechecker must be one of: tsc, native, ts7, tsgo, auto");
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
            strict: internal || parseFlag(argv, "--strict") || profileAlias === "release" || profileAlias === "strict",
            changed: parseFlag(argv, "--changed") || profileAlias === "changed",
            fast: parseFlag(argv, "--fast") || profileAlias === "quick",
            smoke: parseFlag(argv, "--smoke") || profileAlias === "smoke",
            standard: parseFlag(argv, "--standard") || profileAlias === "agent" || profileAlias === "standard",
            scriptTimeoutMs: scriptTimeoutMs ? Math.floor(scriptTimeoutMs) : undefined,
            testJobs: testJobs ? Math.floor(testJobs) : undefined,
            typechecker: typechecker as "tsc" | "native" | "ts7" | "tsgo" | "auto" | undefined,
            fullTests: parseFlag(argv, "--full"),
            testPlan: parseFlag(argv, "--test-plan"),
            internal,
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
      const lifecycle = rest[0] === "status" || rest[0] === "stop" ? rest[0] : undefined;
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
          detach: parseFlag(argv, "--detach"),
          lifecycle,
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "db": {
      const subcommand = rest[0] as DbSubcommand | undefined;
      if (!subcommand || !["diff", "migrate", "reset", "status", "doctor", "repair", "rls-check"].includes(subcommand)) {
        errors.push("forge db requires subcommand: diff, migrate, reset, status, doctor, repair, or rls-check");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "db",
          subcommand,
          db: parseAdapterKind(parseOptionValue(argv, "--adapter") ?? parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          local: parseFlag(argv, "--local"),
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
    "--human",
    "--for-agent",
    "--causal",
    "--stale-proofs",
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
    "--frontend",
    "--backend",
    "--yes",
    "--force",
    "--no-generate",
    "--no-verify",
    "--keep-failed",
    "--keep",
    "--runtime-probes",
    "--auth-probes",
    "--write-report",
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
    "--entry",
    "--change",
    "--proof",
    "--handoff",
    "--current",
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
    "--workspace",
    "--reuse-servers",
    "--start-servers",
    "--scenario",
    "--all",
    "--ci",
    "--timeout",
    "--name",
    "--auth-token",
    "--auth",
    "--update",
    "--allow-high-risk",
    "--to",
    "--changed",
    "--authored",
    "--review",
    "--env",
    "--input",
    "--provider",
    "--target",
    "--release",
    "--allow-dirty",
    "--allow-public-sourcemaps",
    "--allow-missing-local-release",
    "--prepared-only",
    "--build",
    "--install-venv",
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
    "--adapter",
    "--local",
    "--database-url",
    "--worker",
    "--no-worker",
    "--no-start",
    "--no-bridge",
    "--probe",
    "--probe-codex-server",
    "--once",
    "--limit",
    "--kind",
    "--session",
    "--input",
    "--args",
    "--step",
    "--sink",
    "--file",
    "--telemetry",
    "--user-id",
    "--tenant-id",
    "--tenant",
    "--other-tenant",
    "--role",
    "--strict-policies",
    "--strict",
    "--strict-secrets",
    "--internal",
    "--env-file",
    "--skip-startup-console",
    "--redacted",
    "--older-than",
    "--output",
    "--mock-ai",
    "--ai",
    "--provider",
    "--model",
    "--prompt",
    "--url",
    "--template",
    "--templates",
    "--package-manager",
    "--package-managers",
    "--forge-spec",
    "--local-forge",
    "--install",
    "--no-install",
    "--git",
    "--no-git",
    "--field-test",
    "--commit-ready",
    "--detach",
    "--ergonomics",
    "--with-web",
    "--no-web",
    "--api-only",
    "--web-only",
    "--open",
    "--postgres-version",
    "--runtime-port",
    "--web-port",
    "--preview-port",
    "--preview-url",
    "--studio-url",
    "--interval-ms",
    "--workspace-id",
    "--poll-interval",
    "--allow-dev-auth",
    "--token",
    "--prod",
    "--production",
    "--scenario",
    "--reason",
    "--no-preserve-user-sections",
    "--no-skills",
    "--no-rules",
    "--full",
    "--brief",
    "--verbose",
    "--run-tests",
    "--model-level",
    "--live",
    "--no-delta",
    "--format",
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
        arg === "--entry" ||
        arg === "--change" ||
        arg === "--proof" ||
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
        arg === "--workspace" ||
        arg === "--scenario" ||
        arg === "--timeout" ||
        arg === "--timeout-ms" ||
        arg === "--test-jobs" ||
        arg === "--typechecker" ||
        arg === "--name" ||
        arg === "--reason" ||
        arg === "--auth-token" ||
        arg === "--auth" ||
        arg === "--sandbox-backend" ||
        arg === "--port" ||
        arg === "--host" ||
        arg === "--db" ||
        arg === "--adapter" ||
        arg === "--database-url" ||
        arg === "--limit" ||
        arg === "--older-than" ||
        arg === "--output" ||
        arg === "--kind" ||
        arg === "--session" ||
        arg === "--input" ||
        arg === "--args" ||
        arg === "--step" ||
        arg === "--sink" ||
        arg === "--file" ||
        arg === "--write-report" ||
        arg === "--telemetry" ||
        arg === "--user-id" ||
        arg === "--tenant" ||
        arg === "--other-tenant" ||
        arg === "--tenant-id" ||
        arg === "--role" ||
        arg === "--strict-policies" ||
        arg === "--env-file" ||
        arg === "--ai" ||
        arg === "--provider" ||
        arg === "--model" ||
        arg === "--prompt" ||
        arg === "--format" ||
        arg === "--url" ||
        arg === "--template" ||
        arg === "--package-manager" ||
        arg === "--forge-spec" ||
        arg === "--postgres-version" ||
        arg === "--runtime-port" ||
        arg === "--web-port" ||
        arg === "--preview-port" ||
        arg === "--preview-url" ||
        arg === "--studio-url" ||
        arg === "--interval-ms" ||
        arg === "--workspace-id" ||
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
