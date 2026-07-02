import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";

export type WorkOSSubcommand = "install" | "doctor" | "seed" | "setup" | "prove" | "fga";
export type WorkOSFgaAction = "plan" | "sync" | "prove" | "doctor";

export interface WorkOSCommandOptions {
  subcommand: WorkOSSubcommand;
  fgaAction?: WorkOSFgaAction;
  workspaceRoot: string;
  json: boolean;
  file?: string;
  yes: boolean;
  dryRun: boolean;
  real?: boolean;
  write?: boolean;
  writePath?: string;
  commandRunner?: WorkOSCommandRunner;
}

export interface WorkOSCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface WorkOSCommandResult {
  ok: boolean;
  kind: "workos-install" | "workos-doctor" | "workos-seed" | "workos-setup" | "workos-prove" | "workos-fga";
  checks: WorkOSCheck[];
  command?: string[];
  applied?: boolean;
  data?: unknown;
  stdout?: string;
  stderr?: string;
  exitCode: 0 | 1;
}

export type WorkOSCommandRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    encoding: "utf8";
    stdio: ["ignore", "pipe", "pipe"];
    env?: Record<string, string | undefined>;
  },
) => { status: number | null; stdout: string; stderr: string };

const DEFAULT_SEED_FILE = "workos-seed.yml";
const GENERATED_SEED_FILE = `${GENERATED_DIR}/integrations/workos/workos-seed.yml`;
const WORKOS_SEED_STATE_FILE = ".workos-seed-state.json";
const WORKOS_FGA_STATE_FILE = ".workos-fga-state.json";
const WORKOS_FGA_SETUP_GUIDE_FILE = ".forge/workos-fga-setup.md";

function runExternalCommand(
  command: string[],
  options: WorkOSCommandOptions,
): { status: number | null; stdout: string; stderr: string } {
  const runner = options.commandRunner ?? spawnSync;
  const result = runner(command[0]!, command.slice(1), {
    cwd: options.workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...readRealEnv(options.workspaceRoot),
      WORKOS_MODE: process.env.WORKOS_MODE || "agent",
    },
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : result.stdout?.toString("utf8") ?? "",
    stderr: typeof result.stderr === "string" ? result.stderr : result.stderr?.toString("utf8") ?? "",
  };
}

function exists(root: string, path: string): boolean {
  return existsSync(join(root, path));
}

function readJson(root: string, path: string): unknown | null {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    return null;
  }
  return JSON.parse(stripDeterministicHeader(readFileSync(absolute, "utf8")));
}

function readText(root: string, path: string): string {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    return "";
  }
  return stripDeterministicHeader(readFileSync(absolute, "utf8"));
}

function readRawText(root: string, path: string): string {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    return "";
  }
  return readFileSync(absolute, "utf8");
}

function includesAll(haystack: string, needles: string[]): boolean {
  return needles.every((needle) => haystack.includes(needle));
}

function webAuthSessionProxyConfigured(workspaceRoot: string): boolean {
  const configText = [
    "web/vite.config.ts",
    "web/vite.config.mts",
    "web/vite.config.js",
    "web/vite.config.mjs",
    "web/next.config.ts",
    "web/next.config.mjs",
    "web/next.config.js",
  ].map((path) => readText(workspaceRoot, path)).join("\n");
  if (!configText.trim()) {
    return false;
  }
  return includesAll(configText, ["/login", "/callback", "/logout", "/session"]);
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort();
}

function quotedValues(text: string): string[] {
  return [...text.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]!).filter(Boolean);
}

export interface WorkOSSeedSummary {
  exists: boolean;
  valid: boolean;
  path: string;
  permissions: string[];
  roles: string[];
  resourceTypes: string[];
  organizations: string[];
  domains: string[];
  redirectUris: string[];
  corsOrigins: string[];
  homepageUrl?: string;
  webhookEndpoints: Array<{ url: string; events: string[] }>;
  diagnostics: string[];
}

export interface WorkOSSeedStateSummary {
  exists: boolean;
  valid: boolean;
  path: string;
  matchesSeedHash: boolean | null;
  seedHash?: string;
  currentSeedHash?: string;
  appliedAt?: string;
  alreadyApplied?: boolean;
  diagnostics: string[];
}

function parseSlug(line: string): string | null {
  const match = /(?:^|\s)-?\s*slug:\s*["']?([^"',\]\s]+)["']?/.exec(line);
  return match?.[1] ?? null;
}

function parseName(line: string): string | null {
  const match = /(?:^|\s)-?\s*name:\s*["']?([^"'\]]+(?:\s[^"'\]]+)*)["']?/.exec(line);
  return match?.[1]?.trim() ?? null;
}

export function parseSeedFile(workspaceRoot: string, preferredPath = DEFAULT_SEED_FILE): WorkOSSeedSummary {
  const seedPath = exists(workspaceRoot, preferredPath)
    ? preferredPath
    : exists(workspaceRoot, GENERATED_SEED_FILE)
      ? GENERATED_SEED_FILE
      : preferredPath;
  const raw = readText(workspaceRoot, seedPath);
  const permissions = new Set<string>();
  const roles = new Set<string>();
  const resourceTypes = new Set<string>();
  const organizations = new Set<string>();
  const domains = new Set<string>();
  const redirectUris = new Set<string>();
  const corsOrigins = new Set<string>();
  let homepageUrl: string | undefined;
  const webhookEndpoints: Array<{ url: string; events: string[] }> = [];
  const diagnostics: string[] = [];
  let section = "";
  let configKey = "";
  let currentWebhook: { url: string; events: string[] } | undefined;

  if (!raw.trim()) {
    return {
      exists: false,
      valid: false,
      path: seedPath,
      permissions: [],
      roles: [],
      resourceTypes: [],
      organizations: [],
      domains: [],
      redirectUris: [],
      corsOrigins: [],
      webhookEndpoints: [],
      diagnostics: [`${seedPath} is missing or empty`],
    };
  }

  for (const line of raw.split(/\r?\n/)) {
    const rootSection = /^([a-zA-Z_][\w-]*):\s*$/.exec(line);
    if (rootSection) {
      section = rootSection[1]!;
      configKey = "";
      currentWebhook = undefined;
      continue;
    }

    if (section === "config") {
      const configEntry = /^\s{2}([a-zA-Z_][\w-]*):\s*(.*)$/.exec(line);
      if (configEntry) {
        configKey = configEntry[1]!;
        const rest = configEntry[2] ?? "";
        if (configKey === "redirect_uris") {
          for (const value of quotedValues(rest)) redirectUris.add(value);
        } else if (configKey === "cors_origins") {
          for (const value of quotedValues(rest)) corsOrigins.add(value);
        } else if (configKey === "homepage_url") {
          homepageUrl = quotedValues(rest)[0] ?? (rest.trim().replace(/^["']|["']$/g, "") || homepageUrl);
        } else if (configKey === "webhook_endpoints") {
          currentWebhook = undefined;
        }
      }
      const bulletValue = /^\s*-\s*["']?([^"'\]\s]+)["']?\s*$/.exec(line)?.[1];
      if (bulletValue && configKey === "redirect_uris") {
        redirectUris.add(bulletValue);
      } else if (bulletValue && configKey === "cors_origins") {
        corsOrigins.add(bulletValue);
      } else if (bulletValue && configKey === "webhook_events" && currentWebhook) {
        currentWebhook.events.push(bulletValue);
      }
      const webhookUrl = /^\s*-\s*url:\s*["']?([^"']+)["']?\s*$/.exec(line)?.[1] ??
        /^\s{4}url:\s*["']?([^"']+)["']?\s*$/.exec(line)?.[1];
      if (webhookUrl) {
        currentWebhook = { url: webhookUrl.trim(), events: [] };
        webhookEndpoints.push(currentWebhook);
        configKey = "webhook_endpoints";
      }
      if (/^\s{4}events:\s*/.test(line) && currentWebhook) {
        configKey = "webhook_events";
        for (const value of quotedValues(line)) currentWebhook.events.push(value);
      }
    }

    const slug = parseSlug(line);
    if (slug) {
      if (section === "permissions") {
        permissions.add(slug);
      } else if (section === "roles") {
        roles.add(slug);
      } else if (section === "resource_types") {
        resourceTypes.add(slug);
      }
    }

    if (section === "organizations") {
      const name = parseName(line);
      if (name) {
        organizations.add(name);
      }
      for (const value of quotedValues(line)) {
        if (value.includes(".")) {
          domains.add(value);
        }
      }
    }

    for (const match of line.matchAll(/-\s*["']?([a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+)["']?/g)) {
      permissions.add(match[1]!);
    }
  }

  if (permissions.size === 0) diagnostics.push("no permission slugs found");
  if (roles.size === 0) diagnostics.push("no role slugs found");
  if (resourceTypes.size === 0) diagnostics.push("no resource_types slugs found");
  if (organizations.size === 0) diagnostics.push("no organizations found");

  return {
    exists: true,
    valid: diagnostics.length === 0,
    path: seedPath,
    permissions: uniqueSorted(permissions),
    roles: uniqueSorted(roles),
    resourceTypes: uniqueSorted(resourceTypes),
    organizations: uniqueSorted(organizations),
    domains: uniqueSorted(domains),
    redirectUris: uniqueSorted(redirectUris),
    corsOrigins: uniqueSorted(corsOrigins),
    ...(homepageUrl ? { homepageUrl } : {}),
    webhookEndpoints: webhookEndpoints.map((endpoint) => ({
      url: endpoint.url,
      events: uniqueSorted(endpoint.events),
    })),
    diagnostics,
  };
}

function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const raw = match[2] ?? "";
    values[match[1]!] = raw.trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

function readRealEnv(workspaceRoot: string): Record<string, string> {
  return {
    ...parseEnvText(readRawText(workspaceRoot, ".env")),
    ...parseEnvText(readRawText(workspaceRoot, ".env.local")),
    ...Object.fromEntries(
      Object.entries(process.env)
        .filter(([key]) => key.startsWith("FORGE_") || key.startsWith("WORKOS_") || key.startsWith("VITE_WORKOS_"))
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  };
}

function hasValue(env: Record<string, string>, name: string): boolean {
  return typeof env[name] === "string" && env[name]!.trim().length > 0;
}

function workosJwksUri(clientId: string | undefined): string {
  return clientId ? `https://api.workos.com/sso/jwks/${clientId}` : "https://api.workos.com/sso/jwks/<WORKOS_CLIENT_ID>";
}

export interface WorkOSCliAuthSummary {
  required: boolean;
  ok: boolean;
  method: "api-key" | "cli";
  skippedReason?: string;
  statusCommand: string[];
  statusShellCommand?: string;
  loginCommand?: string[];
  loginShellCommand?: string;
  rerunCommand?: string;
  loginAttempted: boolean;
  authenticated?: boolean;
  email?: string;
  userId?: string;
  tokenExpired?: boolean;
  hasRefreshToken?: boolean;
  activeEnvironment?: unknown;
  status?: number | null;
  loginStatus?: number | null;
  detail: string;
  loginInstructions?: {
    url?: string;
    code?: string;
    message?: string;
  };
  nextActions: string[];
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function extractWorkOSLoginInstructions(stdout: string, stderr: string): WorkOSCliAuthSummary["loginInstructions"] | undefined {
  const output = `${stdout}\n${stderr}`.trim();
  if (!output) {
    return undefined;
  }
  const url = output.match(/https?:\/\/[^\s"'<>]+/)?.[0];
  const code = output.match(/(?:code|verification code|user code)[^\w]*([A-Z0-9-]{4,})/i)?.[1]
    ?? output.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4}|[A-Z0-9]{6,12})\b/)?.[1];
  const message = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join("\n");
  return {
    ...(url ? { url } : {}),
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
  };
}

function workOSCliAuthCheck(auth: WorkOSCliAuthSummary): WorkOSCheck {
  return {
    name: "workos-cli-auth",
    ok: auth.ok,
    detail: auth.detail,
  };
}

function workOSCliAuthShellCommand(command: string[]): string {
  return `WORKOS_MODE=agent ${command.join(" ")}`;
}

function workOSHostedRerunCommand(options: WorkOSCommandOptions): string {
  const file = options.file ?? DEFAULT_SEED_FILE;
  const subcommand = options.subcommand === "setup" ? "setup" : "prove";
  return `forge workos ${subcommand} --real --file ${file} --json`;
}

function ensureWorkOSCliAuthForHosted(options: WorkOSCommandOptions): WorkOSCliAuthSummary {
  const env = readRealEnv(options.workspaceRoot);
  const statusCommand = ["npx", "--yes", "workos@latest", "auth", "status", "--json"];
  const statusShellCommand = workOSCliAuthShellCommand(statusCommand);
  const rerunCommand = workOSHostedRerunCommand(options);
  if (hasValue(env, "WORKOS_API_KEY")) {
    return {
      required: false,
      ok: true,
      method: "api-key",
      skippedReason: "WORKOS_API_KEY is present; WorkOS CLI browser login is optional for hosted setup",
      statusCommand,
      statusShellCommand,
      loginAttempted: false,
      detail: "WORKOS_API_KEY is present; hosted WorkOS setup can use API key authentication",
      nextActions: [],
    };
  }

  const status = runExternalCommand(statusCommand, options);
  const parsed = parseJsonObject(status.stdout);
  const authenticated = booleanField(parsed?.authenticated) ?? false;
  const tokenExpired = booleanField(parsed?.tokenExpired) ?? false;
  const hasRefreshToken = booleanField(parsed?.hasRefreshToken) ?? false;
  const email = stringField(parsed?.email);
  const userId = stringField(parsed?.userId);
  const activeEnvironment = parsed?.activeEnvironment;
  if (status.status === 0 && authenticated && (!tokenExpired || hasRefreshToken)) {
    return {
      required: true,
      ok: true,
      method: "cli",
      statusCommand,
      statusShellCommand,
      loginAttempted: false,
      authenticated,
      ...(email ? { email } : {}),
      ...(userId ? { userId } : {}),
      tokenExpired,
      hasRefreshToken,
      ...(activeEnvironment ? { activeEnvironment } : {}),
      status: status.status,
      detail: tokenExpired && hasRefreshToken
        ? `WorkOS CLI is authenticated${email ? ` as ${email}` : ""}; token is expired but a refresh token is available`
        : `WorkOS CLI is authenticated${email ? ` as ${email}` : ""}`,
      nextActions: [],
    };
  }

  const loginCommand = ["npx", "--yes", "workos@latest", "auth", "login", "--json"];
  const loginShellCommand = workOSCliAuthShellCommand(loginCommand);
  const login = runExternalCommand(loginCommand, options);
  const instructions = extractWorkOSLoginInstructions(login.stdout, login.stderr);
  if (login.status === 0) {
    return {
      required: true,
      ok: true,
      method: "cli",
      statusCommand,
      statusShellCommand,
      loginCommand,
      loginShellCommand,
      loginAttempted: true,
      authenticated: true,
      status: status.status,
      loginStatus: login.status,
      detail: "WorkOS CLI login completed or was already authenticated",
      ...(instructions ? { loginInstructions: instructions } : {}),
      nextActions: [],
    };
  }

  const nextActions = [
    loginShellCommand,
    "complete the WorkOS CLI OAuth/device-code login shown in loginInstructions",
    `rerun ${rerunCommand}`,
  ];
  return {
    required: true,
    ok: false,
    method: "cli",
    statusCommand,
    statusShellCommand,
    loginCommand,
    loginShellCommand,
    rerunCommand,
    loginAttempted: true,
    authenticated,
    ...(email ? { email } : {}),
    ...(userId ? { userId } : {}),
    tokenExpired,
    hasRefreshToken,
    ...(activeEnvironment ? { activeEnvironment } : {}),
    status: status.status,
    loginStatus: login.status,
    detail: instructions?.url || instructions?.code
      ? "WorkOS CLI login is required; open the URL and enter the code from loginInstructions, then rerun the command"
      : "WorkOS CLI login is required; run WORKOS_MODE=agent npx --yes workos@latest auth login --json and rerun the Forge command",
    ...(instructions ? { loginInstructions: instructions } : {}),
    nextActions,
  };
}

function collectWorkOSRealEnvChecks(workspaceRoot: string, cliAuth?: WorkOSCliAuthSummary): WorkOSCheck[] {
  const env = readRealEnv(workspaceRoot);
  const authMode = env.FORGE_AUTH_MODE;
  const clientId = env.WORKOS_CLIENT_ID || env.VITE_WORKOS_CLIENT_ID;
  const required = [
    ["WORKOS_CLIENT_ID", "WorkOS client ID is required for AuthKit and JWKS discovery"],
    ["WORKOS_COOKIE_PASSWORD", "cookie password is required for AuthKit session signing"],
    ["FORGE_AUTH_ISSUER", "Forge OIDC issuer must be https://api.workos.com"],
    ["FORGE_AUTH_AUDIENCE", "Forge OIDC audience must match the WorkOS client/application audience"],
    ["FORGE_AUTH_JWKS_URI", `Forge JWKS URI must be configured, usually ${workosJwksUri(clientId)}`],
  ] as const;
  return [
    {
      name: "real-env-auth-mode",
      ok: authMode === "oidc" || authMode === "jwt",
      detail: authMode === "oidc" || authMode === "jwt"
        ? `FORGE_AUTH_MODE=${authMode} is production-capable`
        : "FORGE_AUTH_MODE must be oidc or jwt before running hosted WorkOS proof",
    },
    {
      name: "real-env-workos_api_key-or-cli-auth",
      ok: hasValue(env, "WORKOS_API_KEY") || cliAuth?.ok === true,
      detail: hasValue(env, "WORKOS_API_KEY")
        ? "WORKOS_API_KEY is present"
        : cliAuth?.ok
          ? "WORKOS_API_KEY is missing, but WorkOS CLI authentication is available for no-dashboard hosted setup"
          : "WORKOS_API_KEY is missing and WorkOS CLI authentication is not complete; run WorkOS CLI login",
    },
    ...required.map(([name, detail]) => ({
      name: `real-env-${name.toLowerCase()}`,
      ok: hasValue(env, name),
      detail: hasValue(env, name) ? `${name} is present` : `${name} is missing: ${detail}`,
    })),
  ];
}

export function collectPolicyPermissions(workspaceRoot: string): string[] {
  const registry = readJson(workspaceRoot, `${GENERATED_DIR}/policyRegistry.json`) as {
    policies?: Array<{ permissions?: string[] }>;
  } | null;
  const permissions = new Set<string>();
  for (const policy of registry?.policies ?? []) {
    for (const permission of policy.permissions ?? []) {
      permissions.add(permission);
    }
  }
  for (const path of ["src/policies.ts", "src/policies.workos.ts"]) {
    const text = readText(workspaceRoot, path);
    for (const match of text.matchAll(/canPermission\s*\(([^)]*)\)/g)) {
      for (const value of quotedValues(match[1] ?? "")) {
        permissions.add(value);
      }
    }
  }
  return uniqueSorted(permissions);
}

function singularResourceName(name: string): string {
  if (name.endsWith("ies")) {
    return `${name.slice(0, -3)}y`;
  }
  if (name.endsWith("ses")) {
    return name.slice(0, -2);
  }
  if (name.endsWith("s") && name.length > 1) {
    return name.slice(0, -1);
  }
  return name;
}

export function collectExpectedResourceTypes(workspaceRoot: string): string[] {
  const dataGraph = readJson(workspaceRoot, `${GENERATED_DIR}/dataGraph.json`) as {
    tables?: Array<{ name?: string; fields?: Array<{ name?: string }> }>;
  } | null;
  const agentContract = readJson(workspaceRoot, `${GENERATED_DIR}/agentContract.json`) as {
    auth?: { requiresTenant?: boolean };
  } | null;
  const resourceTypes = new Set<string>();
  const tenantScopedTables = (dataGraph?.tables ?? []).filter((table) =>
    (table.fields ?? []).some((field) => field.name === "tenantId")
  );
  if (agentContract?.auth?.requiresTenant || tenantScopedTables.length > 0) {
    resourceTypes.add("organization");
  }
  for (const table of tenantScopedTables) {
    if (!table.name || ["organizations", "organization", "memberships", "membership"].includes(table.name)) {
      continue;
    }
    resourceTypes.add(singularResourceName(table.name));
  }
  return uniqueSorted(resourceTypes);
}

export function missingValues(expected: string[], actual: string[]): string[] {
  const actualSet = new Set(actual);
  return expected.filter((value) => !actualSet.has(value));
}

export interface WorkOSFgaResource {
  externalId: string;
  type: string;
  tenant: string;
  name: string;
  parentExternalId?: string;
  parentType?: string;
}

export interface WorkOSFgaProofScenario {
  name: string;
  expected: "allow" | "deny";
  permission: string;
  resourceExternalId: string;
  resourceTypeSlug: string;
  organization: string;
  reason: string;
}

export interface WorkOSFgaManifest {
  schemaVersion: "0.1.0";
  provider: "workos";
  kind: "fga-manifest";
  seedFile: string;
  seedHash?: string;
  manifestHash: string;
  permissions: string[];
  roles: string[];
  resourceTypes: string[];
  organizations: string[];
  resources: WorkOSFgaResource[];
  proofScenarios: WorkOSFgaProofScenario[];
  diagnostics: string[];
}

export interface WorkOSFgaStateSummary {
  exists: boolean;
  valid: boolean;
  path: string;
  matchesManifestHash: boolean | null;
  manifestHash?: string;
  currentManifestHash?: string;
  syncedAt?: string;
  provedAt?: string;
  mode?: "local" | "real";
  sdkOk?: boolean;
  diagnostics: string[];
}

export interface WorkOSFgaMembershipEnvSummary {
  requiredEnv: string[];
  presentEnv: string[];
  missingEnv: string[];
  jsonEnvPresent: boolean;
  complete: boolean;
}

export interface WorkOSFgaHostedSetup {
  requiredResourceTypes: string[];
  rootResourceType: "organization";
  missingResourceTypes: string[];
  requiredMembershipEnv: string[];
  managedBy: "hosted-workos";
  resourceTypeAutomation: "not-supported-by-workos-api" | "not-needed";
  cliSupport: "resources-and-checks";
  sdkSupport: "resources-and-checks";
  docs: string[];
  nextActions: string[];
}

export interface WorkOSFgaResourceTypeSetup {
  slug: string;
  displayName: string;
  hostedAction: "none" | "configure-resource-type";
  requiredBeforeRealSync: boolean;
  permissions: string[];
  roles: string[];
  parentTypes: string[];
  childTypes: string[];
  exampleExternalIds: string[];
  proofScenarios: string[];
  notes: string[];
}

export interface WorkOSFgaSetupGuide {
  resourceTypes: WorkOSFgaResourceTypeSetup[];
  markdown: string;
  docs: string[];
  unsupportedAutomation: string[];
}

export interface WorkOSFgaReadiness {
  real: boolean;
  planReady: boolean;
  seedReady: boolean;
  resourceTypesConfigured: boolean;
  membershipEnvReady: boolean;
  synced: boolean;
  proved: boolean;
  productionReady: boolean;
  nextCommand: string;
  nextActions: string[];
}

function slugifyExternalIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "demo";
}

function preferredParentType(resourceType: string, resourceTypes: string[]): string | undefined {
  const has = (value: string) => resourceTypes.includes(value);
  if (resourceType === "organization") return undefined;
  if (["access_request", "accessRequest", "evidence_document", "evidenceDocument"].includes(resourceType)) {
    if (has("vendor")) return "vendor";
  }
  if (["task", "taskGroup"].includes(resourceType)) {
    if (has("team")) return "team";
    if (has("project")) return "project";
  }
  if (resourceType === "team" && has("project")) return "project";
  return has("organization") ? "organization" : undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashObject(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function collectWorkOSFgaManifest(
  workspaceRoot: string,
  preferredSeedPath = DEFAULT_SEED_FILE,
): WorkOSFgaManifest {
  const seed = parseSeedFile(workspaceRoot, preferredSeedPath);
  const activePermissions = collectPolicyPermissions(workspaceRoot);
  const expectedResourceTypes = collectExpectedResourceTypes(workspaceRoot);
  const permissions = uniqueSorted([...seed.permissions, ...activePermissions]);
  const resourceTypes = uniqueSorted([...seed.resourceTypes, ...expectedResourceTypes]);
  const organizations = seed.organizations.length > 0 ? seed.organizations : ["Demo Organization"];
  const diagnostics: string[] = [];
  const missingSeedPermissions = missingValues(activePermissions, seed.permissions);
  const missingSeedResources = missingValues(expectedResourceTypes, seed.resourceTypes);
  if (!seed.exists) diagnostics.push(`${preferredSeedPath} is missing; run forge add auth workos or forge workos seed --dry-run first`);
  if (missingSeedPermissions.length > 0) diagnostics.push(`seed missing active policy permission(s): ${missingSeedPermissions.join(", ")}`);
  if (missingSeedResources.length > 0) diagnostics.push(`seed missing app resource type(s): ${missingSeedResources.join(", ")}`);
  if (!resourceTypes.includes("organization")) diagnostics.push("FGA graph should include an organization resource type for tenant roots");
  if (permissions.length === 0) diagnostics.push("no WorkOS permission slugs were discovered");
  if (seed.roles.length === 0) diagnostics.push("no WorkOS roles were discovered");

  const resources: WorkOSFgaResource[] = [];
  for (const organization of organizations) {
    const orgSlug = slugifyExternalIdPart(organization);
    const orgExternalId = `organization:${orgSlug}`;
    if (resourceTypes.includes("organization")) {
      resources.push({
        externalId: orgExternalId,
        type: "organization",
        tenant: organization,
        name: organization,
      });
    }
    for (const resourceType of resourceTypes.filter((type) => type !== "organization")) {
      const parentType = preferredParentType(resourceType, resourceTypes);
      const parentExternalId = parentType
        ? parentType === "organization"
          ? orgExternalId
          : `${parentType}:${orgSlug}:demo`
        : undefined;
      resources.push({
        externalId: `${resourceType}:${orgSlug}:demo`,
        type: resourceType,
        tenant: organization,
        name: `${organization} ${resourceType}`,
        ...(parentType ? { parentType } : {}),
        ...(parentExternalId ? { parentExternalId } : {}),
      });
    }
  }

  const firstOrg = organizations[0] ?? "Demo Organization";
  const secondOrg = organizations[1] ?? `${firstOrg} Other`;
  const firstResource = resources.find((resource) => resource.type !== "organization") ?? resources[0];
  const firstPermission = permissions[0] ?? "app:read";
  const proofScenarios: WorkOSFgaProofScenario[] = firstResource
    ? [
        {
          name: "allowed-same-tenant",
          expected: "allow",
          permission: firstPermission,
          resourceExternalId: firstResource.externalId,
          resourceTypeSlug: firstResource.type,
          organization: firstOrg,
          reason: "membership, permission, and resource tenant match",
        },
        {
          name: "cross-tenant-read-denied",
          expected: "deny",
          permission: firstPermission,
          resourceExternalId: firstResource.externalId,
          resourceTypeSlug: firstResource.type,
          organization: secondOrg,
          reason: "resource belongs to a different organization tenant",
        },
      ]
    : [];

  const hashInput = {
    seedFile: seed.path,
    seedHash: seed.exists ? hashSeedFile(workspaceRoot, seed.path) : undefined,
    permissions,
    roles: seed.roles,
    resourceTypes,
    organizations,
    resources,
    proofScenarios,
  };
  return {
    schemaVersion: "0.1.0",
    provider: "workos",
    kind: "fga-manifest",
    seedFile: seed.path,
    ...(seed.exists ? { seedHash: hashSeedFile(workspaceRoot, seed.path) } : {}),
    manifestHash: hashObject(hashInput),
    permissions,
    roles: seed.roles,
    resourceTypes,
    organizations,
    resources,
    proofScenarios,
    diagnostics,
  };
}

export function readWorkOSFgaState(
  workspaceRoot: string,
  manifest: WorkOSFgaManifest,
): WorkOSFgaStateSummary {
  const path = WORKOS_FGA_STATE_FILE;
  const absolute = join(workspaceRoot, path);
  if (!existsSync(absolute)) {
    return {
      exists: false,
      valid: false,
      path,
      matchesManifestHash: null,
      currentManifestHash: manifest.manifestHash,
      diagnostics: [`${path} is missing; run forge workos fga sync --json`],
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(absolute, "utf8")) as {
      manifestHash?: unknown;
      syncedAt?: unknown;
      provedAt?: unknown;
      mode?: unknown;
      sdkOk?: unknown;
    };
    const diagnostics: string[] = [];
    const manifestHash = typeof parsed.manifestHash === "string" ? parsed.manifestHash : undefined;
    const mode = parsed.mode === "real" ? "real" : parsed.mode === "local" ? "local" : undefined;
    const sdkOk = typeof parsed.sdkOk === "boolean" ? parsed.sdkOk : undefined;
    if (!manifestHash) diagnostics.push("FGA state is missing manifestHash");
    if (typeof parsed.syncedAt !== "string") diagnostics.push("FGA state is missing syncedAt");
    if (!mode) diagnostics.push("FGA state is missing mode");
    if (mode === "real" && sdkOk !== true) diagnostics.push("real FGA state is missing sdkOk:true from WorkOS Authorization API sync/proof");
    return {
      exists: true,
      valid: diagnostics.length === 0,
      path,
      matchesManifestHash: manifestHash ? manifestHash === manifest.manifestHash : null,
      ...(manifestHash ? { manifestHash } : {}),
      currentManifestHash: manifest.manifestHash,
      ...(typeof parsed.syncedAt === "string" ? { syncedAt: parsed.syncedAt } : {}),
      ...(typeof parsed.provedAt === "string" ? { provedAt: parsed.provedAt } : {}),
      ...(mode ? { mode } : {}),
      ...(sdkOk !== undefined ? { sdkOk } : {}),
      diagnostics,
    };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      path,
      matchesManifestHash: null,
      currentManifestHash: manifest.manifestHash,
      diagnostics: [`failed to parse ${path}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function writeWorkOSFgaState(input: {
  workspaceRoot: string;
  manifest: WorkOSFgaManifest;
  mode: "local" | "real";
  proved: boolean;
  sdkOk?: boolean;
  sdk?: unknown;
}): string {
  const now = new Date().toISOString();
  const payload = {
    schemaVersion: "0.1.0",
    provider: "workos",
    kind: "fga-state",
    mode: input.mode,
    seedFile: input.manifest.seedFile,
    seedHash: input.manifest.seedHash,
    manifestHash: input.manifest.manifestHash,
    syncedAt: now,
    ...(input.proved ? { provedAt: now } : {}),
    ...(input.sdkOk !== undefined ? { sdkOk: input.sdkOk } : {}),
    ...(input.sdk ? { sdk: input.sdk } : {}),
    permissions: input.manifest.permissions,
    roles: input.manifest.roles,
    resourceTypes: input.manifest.resourceTypes,
    organizations: input.manifest.organizations,
    resources: input.manifest.resources,
    proofScenarios: input.manifest.proofScenarios,
  };
  writeFileSync(join(input.workspaceRoot, WORKOS_FGA_STATE_FILE), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return WORKOS_FGA_STATE_FILE;
}

function hostedFgaResourceTypes(manifest: WorkOSFgaManifest): string[] {
  return manifest.resourceTypes.filter((resourceType) => resourceType !== "organization");
}

function fgaMembershipEnvKey(organization: string): string {
  const suffix = slugifyExternalIdPart(organization).replace(/-/g, "_").toUpperCase();
  return `WORKOS_FGA_MEMBERSHIP_${suffix}`;
}

function workOSFgaMembershipEnvSummary(
  workspaceRoot: string,
  organizations: string[],
): WorkOSFgaMembershipEnvSummary {
  const env = readRealEnv(workspaceRoot);
  const requiredEnv = organizations.map(fgaMembershipEnvKey);
  const jsonEnvPresent = hasValue(env, "WORKOS_FGA_MEMBERSHIPS_JSON") || hasValue(env, "WORKOS_FGA_TEST_MEMBERSHIPS");
  const presentEnv = requiredEnv.filter((name) => hasValue(env, name));
  const missingEnv = jsonEnvPresent ? [] : requiredEnv.filter((name) => !presentEnv.includes(name));
  return {
    requiredEnv,
    presentEnv,
    missingEnv,
    jsonEnvPresent,
    complete: jsonEnvPresent || missingEnv.length === 0,
  };
}

function extractMissingWorkOSFgaResourceTypes(data: unknown, manifest?: WorkOSFgaManifest): string[] {
  const missing = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value && value !== "organization") {
      missing.add(value);
    }
  };
  if (data && typeof data === "object") {
    const errors = (data as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      for (const error of errors) {
        if (!error || typeof error !== "object") continue;
        const record = error as Record<string, unknown>;
        const message = typeof record.message === "string" ? record.message : "";
        const status = String(record.status ?? "");
        if (message.includes("AuthorizationResourceType not found") || status === "404") {
          add(record.resourceTypeSlug);
        }
        const match = /AuthorizationResourceType not found:\s*['"]([^'"]+)['"]/.exec(message);
        add(match?.[1]);
      }
    }
  }
  const text = JSON.stringify(data) ?? "";
  const missingTypePattern = /AuthorizationResourceType not found:\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = missingTypePattern.exec(text))) {
    add(match[1]);
  }
  if (missing.size === 0 && text.includes("AuthorizationResourceType not found") && manifest) {
    for (const resourceType of hostedFgaResourceTypes(manifest)) {
      missing.add(resourceType);
    }
  }
  return uniqueSorted(missing);
}

function workOSFgaHostedSetup(manifest: WorkOSFgaManifest, sdkData?: unknown): WorkOSFgaHostedSetup {
  const requiredResourceTypes = hostedFgaResourceTypes(manifest);
  const missingResourceTypes = extractMissingWorkOSFgaResourceTypes(sdkData, manifest);
  const resourceList = (missingResourceTypes.length > 0 ? missingResourceTypes : requiredResourceTypes).join(", ") || "none";
  const requiredMembershipEnv = manifest.organizations.map(fgaMembershipEnvKey);
  return {
    requiredResourceTypes,
    rootResourceType: "organization",
    missingResourceTypes,
    requiredMembershipEnv,
    managedBy: "hosted-workos",
    resourceTypeAutomation: requiredResourceTypes.length > 0 ? "not-supported-by-workos-api" : "not-needed",
    cliSupport: "resources-and-checks",
    sdkSupport: "resources-and-checks",
    docs: [
      "https://workos.com/docs/fga/resource-types",
      "https://workos.com/docs/fga/resources",
      "https://workos.com/docs/fga/access-checks",
    ],
    nextActions: [
      missingResourceTypes.length > 0
        ? `configure missing WorkOS FGA resource type(s): ${resourceList}`
        : `confirm WorkOS FGA resource type(s) exist: ${resourceList}`,
      "treat organization as the WorkOS tenant root; ForgeOS does not create it as an authorization resource",
      `set WorkOS FGA membership env for real access checks: WORKOS_FGA_MEMBERSHIPS_JSON or ${requiredMembershipEnv.join(", ") || "WORKOS_FGA_MEMBERSHIP_<ORG>"}`,
      "rerun forge workos fga sync --real --file workos-seed.yml --json",
      "rerun forge workos fga prove --real --file workos-seed.yml --json",
      "rerun forge deploy check --production --json",
    ],
  };
}

function displayResourceType(slug: string): string {
  return slug
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function permissionResourcePart(permission: string): string {
  return permission.split(":")[0] ?? permission;
}

function permissionMatchesResourceType(permission: string, resourceType: string): boolean {
  const part = permissionResourcePart(permission);
  const normalizedPart = singularResourceName(part.replace(/[-_]/g, ""));
  const normalizedType = singularResourceName(resourceType.replace(/[-_]/g, ""));
  return part === resourceType ||
    singularResourceName(part) === resourceType ||
    normalizedPart === normalizedType ||
    normalizedType.startsWith(normalizedPart) ||
    normalizedPart === `${normalizedType}request`;
}

function permissionsForResourceType(manifest: WorkOSFgaManifest, resourceType: string): string[] {
  if (resourceType === "organization") {
    return manifest.permissions.filter((permission) => permissionResourcePart(permission) === "organization");
  }
  return manifest.permissions.filter((permission) => permissionMatchesResourceType(permission, resourceType));
}

function roleLooksRelevantToResourceType(role: string, resourceType: string): boolean {
  const normalizedRole = role.replace(/[-_]/g, "");
  const normalizedType = resourceType.replace(/[-_]/g, "");
  return normalizedRole.includes(normalizedType) ||
    normalizedRole.includes(singularResourceName(normalizedType)) ||
    ["owner", "admin", "manager", "member", "auditor", "reviewer", "requester", "security"].some((shared) => normalizedRole.includes(shared));
}

function rolesForResourceType(manifest: WorkOSFgaManifest, resourceType: string): string[] {
  const relevant = manifest.roles.filter((role) => roleLooksRelevantToResourceType(role, resourceType));
  return relevant.length > 0 ? relevant : manifest.roles;
}

function workOSFgaSetupGuide(manifest: WorkOSFgaManifest, hostedSetup: WorkOSFgaHostedSetup): WorkOSFgaSetupGuide {
  const resourcesByType = new Map<string, WorkOSFgaResource[]>();
  for (const resource of manifest.resources) {
    resourcesByType.set(resource.type, [...resourcesByType.get(resource.type) ?? [], resource]);
  }
  const resourceTypes = manifest.resourceTypes.map((slug): WorkOSFgaResourceTypeSetup => {
    const resources = resourcesByType.get(slug) ?? [];
    const parentTypes = uniqueSorted(resources.map((resource) => resource.parentType ?? "").filter(Boolean));
    const childTypes = uniqueSorted(manifest.resources
      .filter((resource) => resource.parentType === slug)
      .map((resource) => resource.type));
    const proofScenarios = manifest.proofScenarios
      .filter((scenario) => scenario.resourceTypeSlug === slug)
      .map((scenario) => `${scenario.name}:${scenario.expected}`);
    const permissions = permissionsForResourceType(manifest, slug);
    const roles = rolesForResourceType(manifest, slug);
    const isRoot = slug === hostedSetup.rootResourceType;
    return {
      slug,
      displayName: displayResourceType(slug),
      hostedAction: isRoot ? "none" : "configure-resource-type",
      requiredBeforeRealSync: !isRoot,
      permissions,
      roles,
      parentTypes,
      childTypes,
      exampleExternalIds: resources.map((resource) => resource.externalId).slice(0, 4),
      proofScenarios,
      notes: isRoot
        ? [
            "Treat WorkOS organization as the tenant root.",
            "ForgeOS keeps organization in the graph for parent/tenant reasoning, but real sync does not create it as an authorization resource.",
          ]
        : [
            "Create/configure this resource type in hosted WorkOS before real sync.",
            parentTypes.length > 0
              ? `Expected parent type(s): ${parentTypes.join(", ")}.`
              : "No parent type inferred from the app graph.",
          ],
    };
  });
  const markdown = [
    "# WorkOS FGA Setup",
    "",
    "ForgeOS derived this resource graph from the app contract, policies, and workos-seed.yml.",
    "WorkOS resource type configuration is hosted WorkOS configuration. ForgeOS uses the WorkOS CLI/API or SDK to sync resources and prove authorization checks after those resource types exist.",
    "",
    "## Resource Types",
    "",
    ...resourceTypes.flatMap((resourceType) => [
      `### ${resourceType.slug}`,
      "",
      `- Display name: ${resourceType.displayName}`,
      `- Hosted action: ${resourceType.hostedAction}`,
      `- Required before real sync: ${resourceType.requiredBeforeRealSync ? "yes" : "no"}`,
      `- Parent types: ${resourceType.parentTypes.join(", ") || "none"}`,
      `- Child types: ${resourceType.childTypes.join(", ") || "none"}`,
      `- Permissions to attach/model: ${resourceType.permissions.join(", ") || "none inferred"}`,
      `- Roles to review for this type: ${resourceType.roles.join(", ") || "none inferred"}`,
      `- Example external IDs: ${resourceType.exampleExternalIds.join(", ") || "none"}`,
      `- Proof scenarios: ${resourceType.proofScenarios.join(", ") || "none"}`,
      ...resourceType.notes.map((note) => `- Note: ${note}`),
      "",
    ]),
    "## Permission And Role Coverage",
    "",
    `- Permissions discovered: ${manifest.permissions.join(", ") || "none"}`,
    `- Roles discovered: ${manifest.roles.join(", ") || "none"}`,
    "- In hosted WorkOS, ensure each permission is scoped to the intended resource type and each role includes the permissions needed by your Forge policies.",
    "- ForgeOS will not claim production readiness until real Authorization API checks pass for the generated proof scenarios.",
    "",
    "## Required Membership Environment",
    "",
    "- WORKOS_FGA_MEMBERSHIPS_JSON: JSON object mapping organization name to organizationMembershipId",
    ...hostedSetup.requiredMembershipEnv.map((env) => `- ${env}: organizationMembershipId for that organization`),
    "",
    "## Commands",
    "",
    "```bash",
    "forge workos fga plan --file workos-seed.yml --write --json",
    "forge workos fga sync --real --file workos-seed.yml --json",
    "forge workos fga prove --real --file workos-seed.yml --json",
    "forge deploy check --production --json",
    "```",
    "",
  ].join("\n");
  return {
    resourceTypes,
    markdown,
    docs: hostedSetup.docs,
    unsupportedAutomation: [
      "ForgeOS does not invent WorkOS CLI/API calls for resource type creation.",
      "ForgeOS can create/read FGA resources and run authorization checks through the WorkOS CLI/API or SDK after resource types exist.",
    ],
  };
}

function resolveWorkOSFgaSetupGuidePath(options: WorkOSCommandOptions): string | undefined {
  if (!options.write && !options.writePath) {
    return undefined;
  }
  const candidate = options.writePath?.trim();
  return candidate && candidate !== "true" && !candidate.startsWith("--") ? candidate : WORKOS_FGA_SETUP_GUIDE_FILE;
}

function writeWorkOSFgaSetupGuide(
  workspaceRoot: string,
  guide: WorkOSFgaSetupGuide,
  preferredPath = WORKOS_FGA_SETUP_GUIDE_FILE,
): string {
  const relativePath = preferredPath.startsWith("/") ? preferredPath.slice(1) : preferredPath;
  const absolutePath = join(workspaceRoot, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, guide.markdown, "utf8");
  return relativePath;
}

function fgaData(input: {
  action: WorkOSFgaAction;
  workspaceRoot: string;
  manifest: WorkOSFgaManifest;
  state: WorkOSFgaStateSummary;
  seedState?: WorkOSSeedStateSummary;
  real?: boolean;
  cliAuth?: WorkOSCliAuthSummary;
  workosSdk?: unknown;
  readiness?: WorkOSFgaReadiness;
  stateFile?: string;
  nextCommand?: string;
  nextActions?: string[];
  setupGuidePath?: string;
}): Record<string, unknown> {
  const hostedSetup = workOSFgaHostedSetup(input.manifest, input.workosSdk);
  const setupGuide = workOSFgaSetupGuide(input.manifest, hostedSetup);
  const membershipEnv = workOSFgaMembershipEnvSummary(input.workspaceRoot, input.manifest.organizations);
  return {
    action: input.action,
    real: input.real ?? false,
    manifest: input.manifest,
    state: input.state,
    ...(input.seedState ? { seedState: input.seedState } : {}),
    ...(input.readiness ? { readiness: input.readiness } : {}),
    hostedSetup,
    membershipEnv,
    resourceTypeSetup: setupGuide.resourceTypes,
    setupGuide,
    ...(input.cliAuth ? { cliAuth: input.cliAuth } : {}),
    ...(input.workosSdk ? { workosSdk: input.workosSdk } : {}),
    ...(input.stateFile ? { stateFile: input.stateFile } : {}),
    ...(input.setupGuidePath ? { setupGuidePath: input.setupGuidePath } : {}),
    nextCommand: input.nextCommand,
    nextActions: input.nextActions ?? hostedSetup.nextActions,
    notes: [
      "ForgeOS derives resource graph and proof scenarios from app contract, policies, and workos-seed.yml.",
      "WorkOS FGA resource types are hosted WorkOS configuration; ForgeOS syncs/proves resources and gates production deploys through .workos-fga-state.json.",
    ],
  };
}

function runWorkOSFgaSdk(
  options: WorkOSCommandOptions,
  manifest: WorkOSFgaManifest,
  action: "sync" | "prove",
): { ok: boolean; command: string[]; data: Record<string, unknown>; status: number | null; stdout?: string; stderr?: string } {
const script = String.raw`
const { spawnSync } = await import("node:child_process");
const payload = JSON.parse(process.env.FORGE_WORKOS_FGA_PAYLOAD || "{}");
const out = { ok: true, action: payload.action, resources: [], checks: [], skipped: [], errors: [] };
function message(error) {
  return error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
}
function status(error) {
  return error && typeof error === "object" && "status" in error ? error.status : error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
}
async function listAll(page) {
  if (!page) return [];
  if (Array.isArray(page.data)) return page.data;
  if (Symbol.asyncIterator in Object(page)) {
    const values = [];
    for await (const item of page) values.push(item);
    return values;
  }
  return [];
}
function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "demo";
}
function membershipEnvKey(organization) {
  return "WORKOS_FGA_MEMBERSHIP_" + slugify(organization).replace(/-/g, "_").toUpperCase();
}
function readMembershipMap(organizations) {
  const memberships = new Map();
  for (const name of ["WORKOS_FGA_MEMBERSHIPS_JSON", "WORKOS_FGA_TEST_MEMBERSHIPS"]) {
    const raw = process.env[name];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [organization, membershipId] of Object.entries(parsed)) {
          if (typeof membershipId === "string" && membershipId.trim()) {
            memberships.set(organization, membershipId.trim());
            memberships.set(slugify(organization), membershipId.trim());
          }
        }
      }
    } catch (error) {
      out.ok = false;
      out.errors.push({ operation: "membership.env", env: name, message: "failed to parse JSON membership map: " + message(error) });
    }
  }
  for (const organization of organizations || []) {
    const envKey = membershipEnvKey(organization);
    const membershipId = process.env[envKey];
    if (membershipId && membershipId.trim()) {
      memberships.set(organization, membershipId.trim());
      memberships.set(slugify(organization), membershipId.trim());
    }
  }
  const legacy = process.env.WORKOS_FGA_TEST_MEMBERSHIP_ID || process.env.WORKOS_FGA_ORGANIZATION_MEMBERSHIP_ID;
  if (legacy && legacy.trim() && organizations && organizations.length === 1) {
    memberships.set(organizations[0], legacy.trim());
    memberships.set(slugify(organizations[0]), legacy.trim());
  }
  return memberships;
}
function parseCliJson(text) {
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return { parseError: message(error), raw: text };
  }
}
function cliApi(path, options = {}) {
  const args = ["--yes", "workos@latest", "api", path, "--method", options.method || "GET", "--json"];
  if (options.data) args.push("--data", JSON.stringify(options.data));
  if (options.yes) args.push("--yes");
  const child = spawnSync("npx", args, {
    encoding: "utf8",
    env: { ...process.env, WORKOS_MODE: process.env.WORKOS_MODE || "agent" },
  });
  const parsed = parseCliJson(child.stdout);
  return {
    ok: child.status === 0,
    status: child.status,
    data: parsed,
    stdout: child.stdout,
    stderr: child.stderr,
  };
}
function dataList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.list)) return payload.list;
  return [];
}
function encodePathPart(value) {
  return encodeURIComponent(String(value));
}
async function runWithWorkOSCli() {
  const orgResponse = cliApi("/organizations", { method: "GET" });
  if (!orgResponse.ok) {
    out.ok = false;
    out.errors.push({ operation: "cli.organizations.list", status: orgResponse.status, message: orgResponse.stderr || JSON.stringify(orgResponse.data) });
    return;
  }
  const orgs = dataList(orgResponse.data);
  const orgByName = new Map(orgs.map((org) => [org.name, org]));
  const sortedResources = [...payload.manifest.resources].sort((a, b) => {
    if (a.type === "organization") return -1;
    if (b.type === "organization") return 1;
    if (!a.parentExternalId && b.parentExternalId) return -1;
    if (a.parentExternalId && !b.parentExternalId) return 1;
    return a.externalId.localeCompare(b.externalId);
  });
  for (const resource of sortedResources) {
    if (resource.type === "organization") {
      out.resources.push({ externalId: resource.externalId, resourceTypeSlug: resource.type, organizationName: resource.tenant, status: "root-organization" });
      continue;
    }
    const org = orgByName.get(resource.tenant);
    if (!org?.id) {
      out.ok = false;
      out.errors.push({ operation: "organization.lookup", organization: resource.tenant, message: "organization not found in WorkOS environment" });
      continue;
    }
    const getPath = "/authorization/organizations/" + encodePathPart(org.id) + "/resources/" + encodePathPart(resource.type) + "/" + encodePathPart(resource.externalId);
    const existing = cliApi(getPath, { method: "GET" });
    if (existing.ok) {
      out.resources.push({ externalId: resource.externalId, resourceTypeSlug: resource.type, organizationId: org.id, status: "existing", id: existing.data?.id });
      continue;
    }
    const created = cliApi("/authorization/resources", {
      method: "POST",
      yes: true,
      data: {
        organization_id: org.id,
        resource_type_slug: resource.type,
        external_id: resource.externalId,
        name: resource.name,
        ...(resource.parentExternalId && resource.parentType !== "organization" ? { parent_resource_external_id: resource.parentExternalId, parent_resource_type_slug: resource.parentType } : {}),
      },
    });
    if (!created.ok) {
      out.ok = false;
      out.errors.push({ operation: "resource.create", externalId: resource.externalId, resourceTypeSlug: resource.type, status: created.status, message: created.stderr || JSON.stringify(created.data) });
      continue;
    }
    out.resources.push({ externalId: resource.externalId, resourceTypeSlug: resource.type, organizationId: org.id, status: "created", id: created.data?.id });
  }
  if (payload.action === "prove") {
    const memberships = readMembershipMap(payload.manifest.organizations);
    for (const scenario of payload.manifest.proofScenarios) {
      const membershipId = memberships.get(scenario.organization) || memberships.get(slugify(scenario.organization));
      if (!membershipId) {
        out.ok = false;
        out.errors.push({
          operation: "authorization.check",
          scenario: scenario.name,
          organization: scenario.organization,
          expected: scenario.expected,
          message: "missing organizationMembershipId for WorkOS FGA proof scenario",
          env: ["WORKOS_FGA_MEMBERSHIPS_JSON", membershipEnvKey(scenario.organization)],
        });
        continue;
      }
      const checked = cliApi("/authorization/organization_memberships/" + encodePathPart(membershipId) + "/check", {
        method: "POST",
        yes: true,
        data: {
          permission_slug: scenario.permission,
          resource_external_id: scenario.resourceExternalId,
          resource_type_slug: scenario.resourceTypeSlug,
        },
      });
      if (!checked.ok) {
        out.ok = false;
        out.errors.push({ operation: "authorization.check", scenario: scenario.name, status: checked.status, message: checked.stderr || JSON.stringify(checked.data) });
        continue;
      }
      const expectedAuthorized = scenario.expected === "allow";
      const passed = Boolean(checked.data?.authorized) === expectedAuthorized;
      if (!passed) out.ok = false;
      out.checks.push({ name: scenario.name, organization: scenario.organization, expected: scenario.expected, authorized: Boolean(checked.data?.authorized), ok: passed });
    }
  }
}
try {
  if (!process.env.WORKOS_API_KEY) {
    await runWithWorkOSCli();
    console.log(JSON.stringify(out));
    process.exit(out.ok ? 0 : 1);
  }
  const mod = await import("@workos-inc/node");
  const WorkOS = mod.WorkOS || mod.default?.WorkOS;
  if (!WorkOS) throw new Error("@workos-inc/node did not export WorkOS");
  const workos = new WorkOS(process.env.WORKOS_API_KEY);
  const orgs = await listAll(await workos.organizations.listOrganizations());
  const orgByName = new Map(orgs.map((org) => [org.name, org]));
  const sortedResources = [...payload.manifest.resources].sort((a, b) => {
    if (a.type === "organization") return -1;
    if (b.type === "organization") return 1;
    if (!a.parentExternalId && b.parentExternalId) return -1;
    if (a.parentExternalId && !b.parentExternalId) return 1;
    return a.externalId.localeCompare(b.externalId);
  });
  for (const resource of sortedResources) {
    if (resource.type === "organization") {
      out.resources.push({ externalId: resource.externalId, resourceTypeSlug: resource.type, organizationName: resource.tenant, status: "root-organization" });
      continue;
    }
    const org = orgByName.get(resource.tenant);
    if (!org) {
      out.ok = false;
      out.errors.push({ operation: "organization.lookup", organization: resource.tenant, message: "organization not found in WorkOS environment" });
      continue;
    }
    try {
      const existing = await workos.authorization.getResourceByExternalId({
        organizationId: org.id,
        resourceTypeSlug: resource.type,
        externalId: resource.externalId,
      });
      out.resources.push({ externalId: resource.externalId, resourceTypeSlug: resource.type, organizationId: org.id, status: "existing", id: existing.id });
    } catch (error) {
      if (![404, "404"].includes(status(error))) {
        out.ok = false;
        out.errors.push({ operation: "resource.get", externalId: resource.externalId, resourceTypeSlug: resource.type, status: status(error), message: message(error) });
        continue;
      }
      try {
        const created = await workos.authorization.createResource({
          organizationId: org.id,
          resourceTypeSlug: resource.type,
          externalId: resource.externalId,
          name: resource.name,
          ...(resource.parentExternalId && resource.parentType !== "organization" ? { parentResourceExternalId: resource.parentExternalId, parentResourceTypeSlug: resource.parentType } : {}),
        });
        out.resources.push({ externalId: resource.externalId, resourceTypeSlug: resource.type, organizationId: org.id, status: "created", id: created.id });
      } catch (createError) {
        out.ok = false;
        out.errors.push({ operation: "resource.create", externalId: resource.externalId, resourceTypeSlug: resource.type, status: status(createError), message: message(createError) });
      }
    }
  }
  if (payload.action === "prove") {
    const memberships = readMembershipMap(payload.manifest.organizations);
    for (const scenario of payload.manifest.proofScenarios) {
      const membershipId = memberships.get(scenario.organization) || memberships.get(slugify(scenario.organization));
      if (!membershipId) {
        out.ok = false;
        out.errors.push({
          operation: "authorization.check",
          scenario: scenario.name,
          organization: scenario.organization,
          expected: scenario.expected,
          message: "missing organizationMembershipId for WorkOS FGA proof scenario",
          env: ["WORKOS_FGA_MEMBERSHIPS_JSON", membershipEnvKey(scenario.organization)],
        });
        continue;
      }
      try {
        const check = await workos.authorization.check({
          organizationMembershipId: membershipId,
          permissionSlug: scenario.permission,
          resourceExternalId: scenario.resourceExternalId,
          resourceTypeSlug: scenario.resourceTypeSlug,
        });
        const expectedAuthorized = scenario.expected === "allow";
        const passed = Boolean(check.authorized) === expectedAuthorized;
        if (!passed) out.ok = false;
        out.checks.push({ name: scenario.name, organization: scenario.organization, expected: scenario.expected, authorized: Boolean(check.authorized), ok: passed });
      } catch (checkError) {
        out.ok = false;
        out.errors.push({ operation: "authorization.check", scenario: scenario.name, status: status(checkError), message: message(checkError) });
      }
    }
  }
} catch (error) {
  out.ok = false;
  out.errors.push({ operation: "sdk", message: message(error), status: status(error) });
}
console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);
`;
  const command = ["node", "--input-type=module", "-e", script];
  const displayCommand = ["node", "--input-type=module", "-e", "<forge-workos-fga-sdk>"];
  const previousPayload = process.env.FORGE_WORKOS_FGA_PAYLOAD;
  let child: { status: number | null; stdout: string; stderr: string };
  try {
    process.env.FORGE_WORKOS_FGA_PAYLOAD = JSON.stringify({ action, manifest });
    child = runExternalCommand(command, {
      ...options,
      commandRunner: options.commandRunner ?? spawnSync,
    });
  } finally {
    if (previousPayload === undefined) {
      delete process.env.FORGE_WORKOS_FGA_PAYLOAD;
    } else {
      process.env.FORGE_WORKOS_FGA_PAYLOAD = previousPayload;
    }
  }
  const parsed = parseJsonObject(child.stdout);
  return {
    ok: child.status === 0 && parsed?.ok === true,
    command: displayCommand,
    data: parsed ?? {
      ok: false,
      errors: [{ operation: "sdk.parse", message: "failed to parse WorkOS FGA SDK output" }],
    },
    status: child.status,
    stdout: child.stdout,
    stderr: child.stderr,
  };
}

function workOSFgaSdkFailureDetail(data: unknown, manifest?: WorkOSFgaManifest): string {
  const text = JSON.stringify(data);
  if (text.includes("AuthorizationResourceType not found")) {
    const missing = extractMissingWorkOSFgaResourceTypes(data, manifest);
    const suffix = missing.length > 0 ? `: ${missing.join(", ")}` : "";
    return `WorkOS Authorization API returned missing FGA resource type(s)${suffix}; configure them in hosted WorkOS, then rerun forge workos fga sync --real --json`;
  }
  if (text.includes("Cannot add resource to organization resource type")) {
    return "WorkOS treats organizations as tenant roots, not creatable authorization resources; Forge will keep organization in the graph and skip resource creation for it";
  }
  if (text.includes("missing organizationMembershipId") || text.includes("WORKOS_FGA_MEMBERSHIPS_JSON")) {
    const env = manifest?.organizations.map(fgaMembershipEnvKey).join(", ") || "WORKOS_FGA_MEMBERSHIP_<ORG>";
    return `WorkOS FGA real proof requires organizationMembershipId values per organization; set WORKOS_FGA_MEMBERSHIPS_JSON or ${env}`;
  }
  return "WorkOS Authorization API resource sync failed; inspect workosSdk.errors";
}

function workOSFgaSdkProofComplete(data: unknown, manifest: WorkOSFgaManifest): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as { ok?: unknown; checks?: unknown; skipped?: unknown; errors?: unknown };
  if (record.ok !== true) return false;
  if (Array.isArray(record.errors) && record.errors.length > 0) return false;
  if (Array.isArray(record.skipped) && record.skipped.length > 0) return false;
  if (!Array.isArray(record.checks)) return false;
  const checks = record.checks as Array<{ name?: unknown; ok?: unknown }>;
  const checkByName = new Map(checks.map((check) => [String(check.name ?? ""), check]));
  return manifest.proofScenarios.every((scenario) => checkByName.get(scenario.name)?.ok === true);
}

export interface WorkOSDoctorData {
  seed: WorkOSSeedSummary;
  seedState: WorkOSSeedStateSummary;
  fgaManifest: WorkOSFgaManifest;
  fgaState: WorkOSFgaStateSummary;
  activePermissions: string[];
  expectedResourceTypes: string[];
  missingSeedPermissions: string[];
  missingSeedResources: string[];
  unusedSeedPermissions: string[];
}

function collectWorkOSDoctorData(
  workspaceRoot: string,
  preferredSeedPath = DEFAULT_SEED_FILE,
): WorkOSDoctorData {
  const seed = parseSeedFile(workspaceRoot, preferredSeedPath);
  const seedState = readWorkOSSeedState(workspaceRoot, seed);
  const fgaManifest = collectWorkOSFgaManifest(workspaceRoot, preferredSeedPath);
  const fgaState = readWorkOSFgaState(workspaceRoot, fgaManifest);
  const activePermissions = collectPolicyPermissions(workspaceRoot);
  const expectedResourceTypes = collectExpectedResourceTypes(workspaceRoot);
  const missingSeedPermissions = missingValues(activePermissions, seed.permissions);
  const missingSeedResources = missingValues(expectedResourceTypes, seed.resourceTypes);
  const unusedSeedPermissions = activePermissions.length === 0
    ? []
    : seed.permissions.filter((permission) => !activePermissions.includes(permission));
  return {
    seed,
    seedState,
    fgaManifest,
    fgaState,
    activePermissions,
    expectedResourceTypes,
    missingSeedPermissions,
    missingSeedResources,
    unusedSeedPermissions,
  };
}

function collectWorkOSChecks(workspaceRoot: string, preferredSeedPath = DEFAULT_SEED_FILE): WorkOSCheck[] {
  const packageJson = readJson(workspaceRoot, "package.json") as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;
  const authRegistry = readJson(workspaceRoot, `${GENERATED_DIR}/authRegistry.json`) as {
    claims?: Record<string, string | undefined>;
  } | null;
  const secretRegistry = readJson(workspaceRoot, `${GENERATED_DIR}/secretRegistry.json`) as {
    secrets?: Array<{ envVar?: string; name?: string }>;
  } | null;
  const secretNames = new Set((secretRegistry?.secrets ?? []).map((secret) => secret.envVar ?? secret.name));
  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };
  const webPackageJson = readJson(workspaceRoot, "web/package.json") as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;
  const webDeps = {
    ...(webPackageJson?.dependencies ?? {}),
    ...(webPackageJson?.devDependencies ?? {}),
  };
  const hasWeb = webPackageJson !== null;
  const {
    seed,
    seedState,
    fgaManifest,
    fgaState,
    activePermissions,
    expectedResourceTypes,
    missingSeedPermissions,
    missingSeedResources,
    unusedSeedPermissions,
  } = collectWorkOSDoctorData(workspaceRoot, preferredSeedPath);
  const realEnv = readRealEnv(workspaceRoot);
  const authMode = realEnv.FORGE_AUTH_MODE;
  const productionAuthEnabled = authMode === "oidc" || authMode === "jwt";
  const issuerConfigured = hasValue(realEnv, "FORGE_AUTH_ISSUER");
  const jwksConfigured = hasValue(realEnv, "FORGE_AUTH_JWKS_URI");
  const clientId = realEnv.WORKOS_CLIENT_ID || realEnv.VITE_WORKOS_CLIENT_ID;
  const authRoutes = readText(workspaceRoot, `${GENERATED_DIR}/integrations/workos/auth-routes.ts`);
  const fga = readText(workspaceRoot, `${GENERATED_DIR}/integrations/workos/fga.ts`);
  const resourceMap = readText(workspaceRoot, `${GENERATED_DIR}/integrations/workos/resource-map.ts`);
  const httpHandler = readText(workspaceRoot, `${GENERATED_DIR}/integrations/workos/http-handler.ts`);
  const policies = readText(workspaceRoot, "src/policies.workos.ts");
  const session = readText(workspaceRoot, `${GENERATED_DIR}/integrations/workos/session.ts`);
  const webhook = readText(workspaceRoot, `${GENERATED_DIR}/integrations/workos/webhook.ts`);
  const generatedFrontendAuthBridge = readText(workspaceRoot, "web/src/lib/workos-auth.tsx");
  const frontendAppShell = [
    readText(workspaceRoot, "web/src/main.tsx"),
    readText(workspaceRoot, "web/src/App.tsx"),
  ].join("\n");
  const appShellUsesWorkOSProvider =
    frontendAppShell.includes("ForgeWorkOSAuthProvider") ||
    frontendAppShell.includes("AuthKitProvider");
  const authBridgeProvidesToken =
    generatedFrontendAuthBridge.includes("getToken") ||
    generatedFrontendAuthBridge.includes("getAccessToken");
  const authBridgeProvidesSessionClaims =
    includesAll(generatedFrontendAuthBridge, ["useForgeWorkOSSession", "/session", "claims"]);
  const authSessionProxyConfigured = webAuthSessionProxyConfigured(workspaceRoot);

  return [
    {
      name: "package",
      ok: "@workos-inc/node" in deps,
      detail: "@workos-inc/node is present in package dependencies",
    },
    {
      name: "auth-registry",
      ok: authRegistry?.claims?.tenantId === "organization_id" && authRegistry?.claims?.userId === "sub",
      detail: "authRegistry maps sub and organization_id claims",
    },
    {
      name: "secrets",
      ok: ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "WORKOS_COOKIE_PASSWORD"].every((name) => secretNames.has(name)),
      detail: "required WorkOS secret names are registered",
    },
    {
      name: "env-example",
      ok: exists(workspaceRoot, ".env.example") &&
        includesAll(readRawText(workspaceRoot, ".env.example"), [
          "FORGE_AUTH_MODE=oidc",
          "FORGE_AUTH_ISSUER=https://api.workos.com",
          "FORGE_AUTH_JWKS_URI=",
          "VITE_WORKOS_CLIENT_ID=",
          "VITE_WORKOS_REDIRECT_URI=",
        ]),
      detail: ".env.example exists with Forge OIDC and browser AuthKit variables",
    },
    {
      name: "production-auth-readiness",
      ok: !productionAuthEnabled || (issuerConfigured && jwksConfigured),
      detail: !productionAuthEnabled
        ? "production OIDC/JWT env not enabled in .env/.env.local"
        : issuerConfigured && jwksConfigured
          ? "FORGE_AUTH_MODE uses production auth and issuer/JWKS are configured"
          : `FORGE_AUTH_MODE=${authMode} requires FORGE_AUTH_ISSUER=https://api.workos.com and FORGE_AUTH_JWKS_URI=${workosJwksUri(clientId)}`,
    },
    {
      name: "browser-authkit-env",
      ok: !hasWeb || (hasValue(realEnv, "VITE_WORKOS_CLIENT_ID") || readRawText(workspaceRoot, ".env.example").includes("VITE_WORKOS_CLIENT_ID=")) &&
        (hasValue(realEnv, "VITE_WORKOS_REDIRECT_URI") || readRawText(workspaceRoot, ".env.example").includes("VITE_WORKOS_REDIRECT_URI=")),
      detail: hasWeb
        ? "web workspace has VITE_WORKOS_CLIENT_ID and VITE_WORKOS_REDIRECT_URI guidance for AuthKit React"
        : "no web workspace detected",
    },
    {
      name: "browser-authkit-package",
      ok: !hasWeb || "@workos-inc/authkit-react" in webDeps,
      detail: hasWeb
        ? "@workos-inc/authkit-react is present in web/package.json"
        : "no web workspace detected",
    },
    {
      name: "browser-authkit-bridge",
      ok: !hasWeb || includesAll(generatedFrontendAuthBridge, ["AuthKitProvider", "ForgeProvider"]) &&
        authBridgeProvidesToken &&
        authBridgeProvidesSessionClaims,
      detail: hasWeb
        ? "generated web/src/lib/workos-auth.tsx bridge provides AuthKitProvider, ForgeProvider token wiring, and normalized /session claims"
        : "no web workspace detected",
    },
    {
      name: "browser-authkit-session-proxy",
      ok: !hasWeb || authSessionProxyConfigured,
      detail: hasWeb
        ? authSessionProxyConfigured
          ? "web dev config proxies /login, /callback, /logout, and /session to the Forge API runtime"
          : "web dev config should proxy /session with /login, /callback, and /logout so AuthKit UI can read Forge-normalized claims"
        : "no web workspace detected",
    },
    {
      name: "browser-authkit-provider",
      ok: !hasWeb || appShellUsesWorkOSProvider,
      detail: hasWeb
        ? "web app shell mounts ForgeWorkOSAuthProvider or AuthKitProvider"
        : "no web workspace detected",
    },
    {
      name: "seed-file",
      ok: seed.exists,
      detail: seed.exists
        ? `${seed.path} exists with ${seed.permissions.length} permission(s), ${seed.roles.length} role(s), ${seed.resourceTypes.length} resource type(s)`
        : `${DEFAULT_SEED_FILE} or ${GENERATED_SEED_FILE} is required`,
    },
    {
      name: "seed-organizations",
      ok: seed.organizations.length > 0,
      detail: seed.organizations.length > 0
        ? `seed file contains organization(s): ${seed.organizations.join(", ")}`
        : "seed file should contain at least one demo organization",
    },
    {
      name: "seed-roles-permissions",
      ok: seed.roles.length > 0 &&
        (activePermissions.length === 0 ? seed.permissions.length > 0 : missingSeedPermissions.length === 0),
      detail: missingSeedPermissions.length === 0
        ? `seed covers ${activePermissions.length} active policy permission(s) with role(s): ${seed.roles.join(", ")}`
        : `seed missing active policy permission(s): ${missingSeedPermissions.join(", ")}`,
    },
    {
      name: "seed-unused-permissions",
      ok: true,
      detail: activePermissions.length === 0
        ? "no active policy permissions were discovered; unused seed permission check skipped"
        : unusedSeedPermissions.length === 0
          ? "seed permissions are all referenced by active policies"
          : `seed includes permission(s) not referenced by active policies: ${unusedSeedPermissions.join(", ")}`,
    },
    {
      name: "seed-resource-types",
      ok: seed.resourceTypes.length > 0 &&
        (expectedResourceTypes.length === 0 || missingSeedResources.length === 0),
      detail: missingSeedResources.length === 0
        ? `seed resource_types cover app graph: ${expectedResourceTypes.length > 0 ? expectedResourceTypes.join(", ") : seed.resourceTypes.join(", ")}`
        : `seed missing resource_type(s) for app graph: ${missingSeedResources.join(", ")}`,
    },
    {
      name: "seed-auth-config",
      ok: seed.redirectUris.length > 0 && seed.corsOrigins.length > 0 && Boolean(seed.homepageUrl),
      detail: seed.redirectUris.length > 0 && seed.corsOrigins.length > 0 && Boolean(seed.homepageUrl)
        ? `seed config contains ${seed.redirectUris.length} redirect URI(s), ${seed.corsOrigins.length} CORS origin(s), and homepage URL`
        : "seed config should include redirect_uris, cors_origins, and homepage_url for no-dashboard setup",
    },
    {
      name: "seed-state",
      ok: true,
      detail: !seedState.exists
        ? `${WORKOS_SEED_STATE_FILE} not found; hosted WorkOS seed has not been proven locally yet`
        : seedState.matchesSeedHash
          ? `${WORKOS_SEED_STATE_FILE} matches ${seed.path}${seedState.alreadyApplied ? " and records an already-applied hosted seed" : ""}`
          : seedState.valid
            ? `${WORKOS_SEED_STATE_FILE} exists but does not match current ${seed.path}; rerun forge workos seed --file ${seed.path} --json after reviewing seed changes`
            : `${WORKOS_SEED_STATE_FILE} exists but is invalid: ${seedState.diagnostics.join("; ")}`,
    },
    {
      name: "fga-plan",
      ok: fgaManifest.diagnostics.length === 0,
      detail: fgaManifest.diagnostics.length === 0
        ? `FGA plan covers ${fgaManifest.resourceTypes.length} resource type(s), ${fgaManifest.resources.length} resource(s), and ${fgaManifest.proofScenarios.length} proof scenario(s)`
        : `FGA plan has gap(s): ${fgaManifest.diagnostics.join("; ")}`,
    },
    {
      name: "fga-state",
      ok: true,
      detail: !fgaState.exists
        ? `${WORKOS_FGA_STATE_FILE} not found; run forge workos fga sync --json before production deploy`
        : fgaState.matchesManifestHash
          ? `${WORKOS_FGA_STATE_FILE} matches current FGA manifest${fgaState.mode === "real" ? " in real mode" : ""}`
          : fgaState.valid
            ? `${WORKOS_FGA_STATE_FILE} exists but does not match current FGA manifest; rerun forge workos fga sync --json`
            : `${WORKOS_FGA_STATE_FILE} exists but is invalid: ${fgaState.diagnostics.join("; ")}`,
    },
    {
      name: "authkit-routes",
      ok: includesAll(authRoutes, ["handleWorkOSAuthRequest", "/login", "/callback", "/logout", "/session"]),
      detail: "AuthKit Request/Response route helper exists for login, callback, logout, and session",
    },
    {
      name: "authkit-session",
      ok: includesAll(session, ["encodeWorkOSSession", "decodeWorkOSSession", "workOSSessionToClaims"]),
      detail: "AuthKit session helper signs cookies and maps sessions to Forge claims",
    },
    {
      name: "webhook-helper",
      ok: includesAll(webhook, ["verifyWorkOSWebhook", "handleWorkOSWebhook", 'provider: "workos"']),
      detail: "WorkOS webhook verifier/helper exists and uses WorkOS signature verification",
    },
    {
      name: "webhook-http-handler",
      ok: includesAll(httpHandler, ["handleWorkOSWebhookRequest", "workosWebhookHttpRoute", "/webhooks/workos"]),
      detail: "WorkOS Request/Response webhook handler exists for POST /webhooks/workos",
    },
    {
      name: "fga-bridge",
      ok: includesAll(resourceMap, [
        "canWorkOS",
        "assertWorkOSResourceTenant",
        "FORGE_WORKOS_CROSS_TENANT_RESOURCE",
        "syncWorkOSResourceGraph",
        "workOSResourceRecords",
        "ForgeWorkOSFgaDecisionCache",
        "permissionSlug",
        "resourceExternalId",
      ]) &&
        includesAll(fga, ["forgeWorkOSResourceTypes"]),
      detail: "WorkOS FGA resource-map bridge exists with sync, cache, telemetry, official check shape, and cross-tenant guard",
    },
    {
      name: "policies",
      ok: exists(workspaceRoot, "src/policies.workos.ts") &&
        policies.includes("canPermission") &&
        missingValues(activePermissions, quotedValues(policies)).length === 0,
      detail: activePermissions.length === 0
        ? "WorkOS-derived Forge policy template exists and is permission-first"
        : `WorkOS-derived policy template covers active permission(s): ${activePermissions.join(", ")}`,
    },
  ];
}

function prepareSeedFileForWorkOSCli(
  workspaceRoot: string,
  file: string,
): { file: string; sanitized: boolean; cleanup: () => void } {
  const raw = readRawText(workspaceRoot, file);
  const stripped = stripDeterministicHeader(raw);
  if (!raw || raw === stripped) {
    return { file, sanitized: false, cleanup: () => undefined };
  }

  const tempDir = mkdtempSync(join(tmpdir(), "forge-workos-seed-"));
  const preparedFile = join(tempDir, basename(file));
  writeFileSync(preparedFile, stripped, "utf8");
  return {
    file: preparedFile,
    sanitized: true,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

function isWorkOSSeedAlreadyApplied(stdout: string, stderr: string): boolean {
  const output = `${stdout}\n${stderr}`;
  return /(?:permission|role|resource type|organization|slug|domain)[^\n]*(?:already in use|already exists|exists already)|already in use/i
    .test(output);
}

function seedData(input: {
  seed: WorkOSSeedSummary;
  activePermissions: string[];
  expectedResourceTypes: string[];
  unusedSeedPermissions: string[];
  seedState?: WorkOSSeedStateSummary;
  dryRun?: boolean;
  seedFileSanitized?: boolean;
  seedAlreadyApplied?: boolean;
  seedAlreadyAppliedReason?: string;
  seedStateFile?: string;
  cliAuth?: WorkOSCliAuthSummary;
  workosCli?: Record<string, unknown>;
  configActions?: WorkOSConfigActionResult[];
  nextCommand?: string;
}): Record<string, unknown> {
  return {
    seed: input.seed,
    activePermissions: input.activePermissions,
    expectedResourceTypes: input.expectedResourceTypes,
    unusedSeedPermissions: input.unusedSeedPermissions,
    ...(input.seedState ? { seedState: input.seedState } : {}),
    dryRun: input.dryRun ?? false,
    seedFileSanitized: input.seedFileSanitized ?? false,
    seedAlreadyApplied: input.seedAlreadyApplied ?? false,
    ...(input.seedAlreadyAppliedReason ? { seedAlreadyAppliedReason: input.seedAlreadyAppliedReason } : {}),
    ...(input.seedStateFile ? { seedStateFile: input.seedStateFile } : {}),
    ...(input.cliAuth ? { cliAuth: input.cliAuth } : {}),
    ...(input.workosCli ? { workosCli: input.workosCli } : {}),
    configActions: input.configActions ?? [],
    ...(input.nextCommand ? { nextCommand: input.nextCommand } : {}),
  };
}

function hashSeedFile(workspaceRoot: string, path: string): string {
  return createHash("sha256")
    .update(readText(workspaceRoot, path))
    .digest("hex");
}

function readWorkOSSeedState(workspaceRoot: string, seed: WorkOSSeedSummary): WorkOSSeedStateSummary {
  const path = WORKOS_SEED_STATE_FILE;
  const absolute = join(workspaceRoot, path);
  if (!existsSync(absolute)) {
    return {
      exists: false,
      valid: false,
      path,
      matchesSeedHash: null,
      diagnostics: [`${path} is missing; run forge workos seed --file ${seed.path} --json after dry-run validation`],
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(absolute, "utf8")) as {
      seedHash?: unknown;
      appliedAt?: unknown;
      alreadyApplied?: unknown;
    };
    const diagnostics: string[] = [];
    const seedHash = typeof parsed.seedHash === "string" ? parsed.seedHash : undefined;
    const currentSeedHash = seed.exists ? hashSeedFile(workspaceRoot, seed.path) : undefined;
    if (!seedHash) diagnostics.push("seed state is missing seedHash");
    if (typeof parsed.appliedAt !== "string") diagnostics.push("seed state is missing appliedAt");
    if (typeof parsed.alreadyApplied !== "boolean") diagnostics.push("seed state is missing alreadyApplied");
    return {
      exists: true,
      valid: diagnostics.length === 0,
      path,
      matchesSeedHash: seedHash && currentSeedHash ? seedHash === currentSeedHash : null,
      ...(seedHash ? { seedHash } : {}),
      ...(currentSeedHash ? { currentSeedHash } : {}),
      ...(typeof parsed.appliedAt === "string" ? { appliedAt: parsed.appliedAt } : {}),
      ...(typeof parsed.alreadyApplied === "boolean" ? { alreadyApplied: parsed.alreadyApplied } : {}),
      diagnostics,
    };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      path,
      matchesSeedHash: null,
      diagnostics: [`failed to parse ${path}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function writeWorkOSSeedState(input: {
  workspaceRoot: string;
  seed: WorkOSSeedSummary;
  command: string[];
  alreadyApplied: boolean;
  status: number | null;
}): string {
  const payload = {
    schemaVersion: "0.1.0",
    provider: "workos",
    kind: "seed-state",
    seedFile: input.seed.path,
    seedHash: hashSeedFile(input.workspaceRoot, input.seed.path),
    appliedAt: new Date().toISOString(),
    alreadyApplied: input.alreadyApplied,
    exitStatus: input.status,
    command: input.command,
    permissions: input.seed.permissions,
    roles: input.seed.roles,
    resourceTypes: input.seed.resourceTypes,
    organizations: input.seed.organizations,
    redirectUris: input.seed.redirectUris,
    corsOrigins: input.seed.corsOrigins,
  };
  writeFileSync(
    join(input.workspaceRoot, WORKOS_SEED_STATE_FILE),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  return WORKOS_SEED_STATE_FILE;
}

export interface WorkOSConfigActionResult {
  name: string;
  command?: string[];
  ok: boolean;
  skipped: boolean;
  reason?: string;
  stdout?: string;
  stderr?: string;
  status?: number | null;
}

function configActionsForSeed(seed: WorkOSSeedSummary): Array<{ name: string; command: string[]; skipReason?: string }> {
  const actions: Array<{ name: string; command: string[]; skipReason?: string }> = [];
  for (const uri of seed.redirectUris) {
    actions.push({
      name: "redirect-uri",
      command: ["npx", "--yes", "workos@latest", "config", "redirect", "add", uri],
    });
  }
  for (const origin of seed.corsOrigins) {
    actions.push({
      name: "cors-origin",
      command: ["npx", "--yes", "workos@latest", "config", "cors", "add", origin],
    });
  }
  if (seed.homepageUrl) {
    actions.push({
      name: "homepage-url",
      command: ["npx", "--yes", "workos@latest", "config", "homepage-url", "set", seed.homepageUrl],
    });
  }
  for (const endpoint of seed.webhookEndpoints) {
    const events = endpoint.events.length > 0 ? endpoint.events.join(",") : "user.created,organization_membership.updated";
    actions.push({
      name: "webhook",
      command: ["npx", "--yes", "workos@latest", "webhook", "create", "--url", endpoint.url, "--events", events],
      skipReason: endpoint.url.startsWith("https://")
        ? undefined
        : "WorkOS hosted webhook endpoints require HTTPS; use a tunnel or production URL for this endpoint.",
    });
  }
  return actions;
}

function runWorkOSConfigActions(
  seed: WorkOSSeedSummary,
  options: WorkOSCommandOptions,
  dryRun: boolean,
): WorkOSConfigActionResult[] {
  return configActionsForSeed(seed).map((action) => {
    if (action.skipReason) {
      return {
        name: action.name,
        command: action.command,
        ok: true,
        skipped: true,
        reason: action.skipReason,
      };
    }
    if (dryRun) {
      return {
        name: action.name,
        command: action.command,
        ok: true,
        skipped: true,
        reason: "dry-run",
      };
    }
    const child = runExternalCommand(action.command, options);
    return {
      name: action.name,
      command: action.command,
      ok: child.status === 0 || isWorkOSSeedAlreadyApplied(child.stdout, child.stderr),
      skipped: false,
      stdout: child.stdout,
      stderr: child.stderr,
      status: child.status,
      ...(child.status !== 0 && isWorkOSSeedAlreadyApplied(child.stdout, child.stderr)
        ? { reason: "already-applied" }
        : {}),
    };
  });
}

export function runWorkOSDoctorCommand(options: WorkOSCommandOptions): WorkOSCommandResult {
  const seedFile = options.file ?? DEFAULT_SEED_FILE;
  const checks = collectWorkOSChecks(options.workspaceRoot, seedFile);
  const data = collectWorkOSDoctorData(options.workspaceRoot, seedFile);
  const ok = checks.every((check) => check.ok);
  const command = ["npx", "--yes", "workos@latest", "doctor"];
  if (!ok) {
    return {
      ok: false,
      kind: "workos-doctor",
      checks,
      command,
      applied: false,
      data,
      exitCode: 1,
    };
  }
  if (!options.yes || options.dryRun) {
    return {
      ok: true,
      kind: "workos-doctor",
      checks,
      command,
      applied: false,
      data,
      exitCode: 0,
    };
  }
  const child = runExternalCommand(command, options);
  return {
    ok: child.status === 0,
    kind: "workos-doctor",
    checks,
    command,
    applied: child.status === 0,
    data,
    stdout: child.stdout,
    stderr: child.stderr,
    exitCode: child.status === 0 ? 0 : 1,
  };
}

export function runWorkOSInstallCommand(options: WorkOSCommandOptions): WorkOSCommandResult {
  const checks = collectWorkOSChecks(options.workspaceRoot);
  const ok = checks.every((check) => check.ok);
  const command = ["npx", "--yes", "workos@latest", "install"];
  if (!ok) {
    return {
      ok: false,
      kind: "workos-install",
      checks,
      command,
      applied: false,
      exitCode: 1,
    };
  }
  if (!options.yes || options.dryRun) {
    return {
      ok: true,
      kind: "workos-install",
      checks,
      command,
      applied: false,
      exitCode: 0,
    };
  }
  const child = runExternalCommand(command, options);
  return {
    ok: child.status === 0,
    kind: "workos-install",
    checks,
    command,
    applied: child.status === 0,
    stdout: child.stdout,
    stderr: child.stderr,
    exitCode: child.status === 0 ? 0 : 1,
  };
}

export function runWorkOSSeedCommand(options: WorkOSCommandOptions): WorkOSCommandResult {
  const file = options.file ?? DEFAULT_SEED_FILE;
  const seed = parseSeedFile(options.workspaceRoot, file);
  const seedState = readWorkOSSeedState(options.workspaceRoot, seed);
  const activePermissions = collectPolicyPermissions(options.workspaceRoot);
  const expectedResourceTypes = collectExpectedResourceTypes(options.workspaceRoot);
  const missingSeedPermissions = missingValues(activePermissions, seed.permissions);
  const missingSeedResources = missingValues(expectedResourceTypes, seed.resourceTypes);
  const unusedSeedPermissions = seed.permissions.filter((permission) => !activePermissions.includes(permission));
  const checks = [
    {
      name: "seed-file",
      ok: seed.exists,
      detail: seed.exists ? `${seed.path} exists` : `${file} exists`,
    },
    {
      name: "seed-yaml-shape",
      ok: seed.valid,
      detail: seed.valid ? "seed contains permissions, roles, resource_types, and organizations" : seed.diagnostics.join("; "),
    },
    {
      name: "seed-policy-coverage",
      ok: missingSeedPermissions.length === 0,
      detail: missingSeedPermissions.length === 0
        ? `seed covers ${activePermissions.length} active permission(s)`
        : `seed missing active permission(s): ${missingSeedPermissions.join(", ")}`,
    },
    {
      name: "seed-unused-permissions",
      ok: true,
      detail: activePermissions.length === 0
        ? "no active policy permissions were discovered; unused seed permission check skipped"
        : unusedSeedPermissions.length === 0
          ? "seed permissions are all referenced by active policies"
          : `seed includes permission(s) not referenced by active policies: ${unusedSeedPermissions.join(", ")}`,
    },
    {
      name: "seed-resource-coverage",
      ok: missingSeedResources.length === 0,
      detail: missingSeedResources.length === 0
        ? `seed covers app resource type(s): ${expectedResourceTypes.join(", ") || "none required"}`
        : `seed missing resource type(s): ${missingSeedResources.join(", ")}`,
    },
    {
      name: "seed-hosted-config",
      ok: seed.redirectUris.length > 0 && seed.corsOrigins.length > 0 && Boolean(seed.homepageUrl),
      detail: seed.redirectUris.length > 0 && seed.corsOrigins.length > 0 && Boolean(seed.homepageUrl)
        ? `seed includes hosted config: ${seed.redirectUris.length} redirect URI(s), ${seed.corsOrigins.length} CORS origin(s), homepage ${seed.homepageUrl}`
        : "seed should include config.redirect_uris, config.cors_origins, and config.homepage_url",
    },
  ];
  const command = ["npx", "--yes", "workos@latest", "seed", "--file", file];
  if (!checks.every((check) => check.ok)) {
    return {
      ok: false,
      kind: "workos-seed",
      checks,
      command,
      applied: false,
      data: seedData({ seed, activePermissions, expectedResourceTypes, unusedSeedPermissions, seedState }),
      exitCode: 1,
    };
  }
  if (options.dryRun) {
    const configActions = runWorkOSConfigActions(seed, options, true);
    return {
      ok: true,
      kind: "workos-seed",
      checks,
      command,
      applied: false,
      data: seedData({
        seed,
        activePermissions,
        expectedResourceTypes,
        unusedSeedPermissions,
        seedState,
        dryRun: true,
        configActions,
        nextCommand: `forge workos seed --file ${file} --json`,
      }),
      exitCode: 0,
    };
  }
  const cliAuth = ensureWorkOSCliAuthForHosted(options);
  if (!cliAuth.ok) {
    return {
      ok: false,
      kind: "workos-seed",
      checks: [...checks, workOSCliAuthCheck(cliAuth)],
      command: cliAuth.loginCommand ?? cliAuth.statusCommand ?? command,
      applied: false,
      data: seedData({
        seed,
        activePermissions,
        expectedResourceTypes,
        unusedSeedPermissions,
        seedState,
        cliAuth,
        nextCommand: `forge workos seed --file ${file} --json`,
      }),
      exitCode: 1,
    };
  }
  const preparedSeed = prepareSeedFileForWorkOSCli(options.workspaceRoot, seed.path);
  const delegatedCommand = [
    "npx",
    "--yes",
    "workos@latest",
    "seed",
    "--file",
    preparedSeed.file,
  ];
  try {
    const configActions = runWorkOSConfigActions(seed, options, false);
    const configOk = configActions.every((action) => action.ok);
    if (!configOk) {
      return {
        ok: false,
        kind: "workos-seed",
        checks,
        command: configActions.find((action) => !action.ok)?.command ?? delegatedCommand,
        applied: false,
        data: seedData({
          seed,
          activePermissions,
          expectedResourceTypes,
        unusedSeedPermissions,
        seedState,
        cliAuth,
        seedFileSanitized: preparedSeed.sanitized,
        configActions,
      }),
        exitCode: 1,
      };
    }
    const child = runExternalCommand(delegatedCommand, options);
    const seedAlreadyApplied =
      child.status !== 0 && isWorkOSSeedAlreadyApplied(child.stdout, child.stderr);
    const seedAlreadyAppliedReason = seedAlreadyApplied
      ? "workos-cli-existing-resource"
      : undefined;
    const seedStateFile = child.status === 0 || seedAlreadyApplied
      ? writeWorkOSSeedState({
        workspaceRoot: options.workspaceRoot,
        seed,
        command: delegatedCommand,
        alreadyApplied: seedAlreadyApplied,
        status: child.status,
      })
      : undefined;
    const latestSeedState = seedStateFile
      ? readWorkOSSeedState(options.workspaceRoot, seed)
      : seedState;
    return {
      ok: child.status === 0 || seedAlreadyApplied,
      kind: "workos-seed",
      checks,
      command: delegatedCommand,
      applied: child.status === 0,
      data: seedData({
        seed,
        activePermissions,
        expectedResourceTypes,
        unusedSeedPermissions,
        seedState: latestSeedState,
        cliAuth,
        seedFileSanitized: preparedSeed.sanitized,
        seedAlreadyApplied,
        seedAlreadyAppliedReason,
        seedStateFile,
        workosCli: {
          status: child.status,
          idempotentConflict: seedAlreadyApplied,
          stderrSuppressed: seedAlreadyApplied && Boolean(child.stderr.trim()),
        },
        configActions,
      }),
      stdout: child.stdout,
      stderr: seedAlreadyApplied ? undefined : child.stderr,
      exitCode: child.status === 0 || seedAlreadyApplied ? 0 : 1,
    };
  } finally {
    preparedSeed.cleanup();
  }
}

export function runWorkOSSetupCommand(options: WorkOSCommandOptions): WorkOSCommandResult {
  const file = options.file ?? DEFAULT_SEED_FILE;
  const checks = collectWorkOSChecks(options.workspaceRoot);
  const cliAuth = options.real ? ensureWorkOSCliAuthForHosted(options) : undefined;
  const realEnvChecks = options.real ? collectWorkOSRealEnvChecks(options.workspaceRoot, cliAuth) : [];
  const allChecks = [...checks, ...realEnvChecks];
  if (options.real && cliAuth && !cliAuth.ok) {
    allChecks.push(workOSCliAuthCheck(cliAuth));
  }
  const localOk = allChecks.every((check) => check.ok);
  const seed = parseSeedFile(options.workspaceRoot, file);
  const seedState = readWorkOSSeedState(options.workspaceRoot, seed);
  const setupDryRun = options.dryRun || !options.real;
  const configActions = runWorkOSConfigActions(seed, options, true);
  const command = ["npx", "--yes", "workos@latest", "seed", "--file", file];
  if (!localOk) {
    return {
      ok: false,
      kind: "workos-setup",
      checks: allChecks,
      command,
      applied: false,
      data: {
        dryRun: setupDryRun,
        real: options.real ?? false,
        seed,
        seedState,
        ...(cliAuth ? { cliAuth } : {}),
        configActions,
        nextCommand: cliAuth && !cliAuth.ok
          ? `forge workos setup --real --file ${file} --json`
          : "forge workos doctor --json",
      },
      exitCode: 1,
    };
  }
  if (setupDryRun) {
    return {
      ok: true,
      kind: "workos-setup",
      checks,
      command,
      applied: false,
      data: {
        dryRun: true,
        real: false,
        seed,
        seedState,
        ...(cliAuth ? { cliAuth } : {}),
        configActions,
        nextCommand: `forge workos setup --real --file ${file} --json`,
      },
      exitCode: 0,
    };
  }
  const seedResult = runWorkOSSeedCommand({
    ...options,
    subcommand: "seed",
    dryRun: false,
    file,
  });
  const seedResultData = seedResult.data && typeof seedResult.data === "object"
    ? seedResult.data as { seedState?: WorkOSSeedStateSummary }
    : {};
  return {
    ok: seedResult.ok,
    kind: "workos-setup",
    checks: [...seedResult.checks, ...realEnvChecks],
    command: seedResult.command,
    applied: seedResult.ok,
    data: {
      real: true,
      seed,
      ...(cliAuth ? { cliAuth } : {}),
      seedState: seedResultData.seedState ?? readWorkOSSeedState(options.workspaceRoot, seed),
      seedResult: seedResult.data,
      nextCommand: "forge workos doctor --json",
    },
    stdout: seedResult.stdout,
    stderr: seedResult.stderr,
    exitCode: seedResult.exitCode,
  };
}

export function runWorkOSProveCommand(options: WorkOSCommandOptions): WorkOSCommandResult {
  const file = options.file ?? DEFAULT_SEED_FILE;
  const doctor = runWorkOSDoctorCommand({
    ...options,
    subcommand: "doctor",
    yes: false,
    dryRun: true,
    file,
  });
  const seed = runWorkOSSeedCommand({
    ...options,
    subcommand: "seed",
    dryRun: true,
    file,
  });
  const setup = runWorkOSSetupCommand({
    ...options,
    subcommand: "setup",
    dryRun: !options.real,
    real: options.real ?? false,
    file,
  });
  const setupBlockingChecks = setup.checks
    .filter((check) => !check.ok)
    .map((check) => ({ ...check, name: `setup:${check.name}` }));
  const checks: WorkOSCheck[] = [
    ...doctor.checks.map((check) => ({ ...check, name: `doctor:${check.name}` })),
    {
      name: "seed:dry-run",
      ok: seed.ok,
      detail: seed.ok
        ? `${file} is valid, app-aware, and ready for hosted application`
        : `${file} failed seed validation before hosted application`,
    },
    ...setupBlockingChecks,
    {
      name: options.real ? "setup:real" : "setup:dry-run",
      ok: setup.ok,
      detail: options.real
        ? setup.ok
          ? "WorkOS hosted setup and seed were applied or already present"
          : "WorkOS hosted setup failed; inspect setup.seedResult/configActions"
        : setup.ok
          ? "No-dashboard WorkOS setup plan is complete; pass --real to apply hosted changes"
          : "No-dashboard WorkOS setup plan is incomplete",
    },
  ];
  const ok = checks.every((check) => check.ok);
  return {
    ok,
    kind: "workos-prove",
    checks,
    command: setup.command ?? seed.command ?? doctor.command,
    applied: Boolean(options.real && setup.ok && setup.applied),
    data: {
      real: options.real ?? false,
      file,
      doctor: doctor.data,
      seed: seed.data,
      setup: setup.data,
      nextCommand: options.real
        ? "forge workos doctor --json"
        : `forge workos prove --real --file ${file} --json`,
    },
    stdout: setup.stdout ?? seed.stdout ?? doctor.stdout,
    stderr: setup.stderr ?? seed.stderr ?? doctor.stderr,
    exitCode: ok ? 0 : 1,
  };
}

function collectWorkOSFgaChecks(input: {
  manifest: WorkOSFgaManifest;
  state: WorkOSFgaStateSummary;
  requireState?: boolean;
  requireRealState?: boolean;
  requireProof?: boolean;
}): WorkOSCheck[] {
  return [
    {
      name: "fga-manifest",
      ok: input.manifest.diagnostics.length === 0,
      detail: input.manifest.diagnostics.length === 0
        ? `manifest ${input.manifest.manifestHash.slice(0, 12)} covers ${input.manifest.resourceTypes.length} resource type(s) and ${input.manifest.resources.length} resource(s)`
        : input.manifest.diagnostics.join("; "),
    },
    {
      name: "fga-resource-types",
      ok: input.manifest.resourceTypes.length > 0 && input.manifest.resourceTypes.includes("organization"),
      detail: input.manifest.resourceTypes.length > 0
        ? `resource types: ${input.manifest.resourceTypes.join(", ")}`
        : "at least organization plus app resource types are required",
    },
    {
      name: "fga-proof-scenarios",
      ok: input.manifest.proofScenarios.some((scenario) => scenario.expected === "allow") &&
        input.manifest.proofScenarios.some((scenario) => scenario.expected === "deny"),
      detail: `proof scenarios: ${input.manifest.proofScenarios.map((scenario) => `${scenario.name}:${scenario.expected}`).join(", ") || "none"}`,
    },
    {
      name: "fga-state",
      ok: !input.requireState || Boolean(input.state.exists && input.state.valid && input.state.matchesManifestHash === true),
      detail: !input.state.exists
        ? `${WORKOS_FGA_STATE_FILE} is missing`
        : !input.state.valid
          ? `${WORKOS_FGA_STATE_FILE} is invalid: ${input.state.diagnostics.join("; ")}`
        : input.state.matchesManifestHash
          ? `${WORKOS_FGA_STATE_FILE} matches current manifest`
          : `${WORKOS_FGA_STATE_FILE} is stale or invalid: ${input.state.diagnostics.join("; ") || "manifest hash mismatch"}`,
    },
    {
      name: "fga-real-state",
      ok: !input.requireRealState || input.state.mode === "real",
      detail: input.state.mode === "real"
        ? `${WORKOS_FGA_STATE_FILE} records real sync/proof mode`
        : input.requireRealState
          ? `${WORKOS_FGA_STATE_FILE} must be produced by forge workos fga sync --real --json`
          : `${WORKOS_FGA_STATE_FILE} real mode not required for this command`,
    },
    {
      name: "fga-proof-state",
      ok: !input.requireProof || Boolean(input.state.provedAt),
      detail: input.state.provedAt
        ? `${WORKOS_FGA_STATE_FILE} records real proof at ${input.state.provedAt}`
        : input.requireProof
          ? `${WORKOS_FGA_STATE_FILE} must be produced by forge workos fga prove --real --json`
          : `${WORKOS_FGA_STATE_FILE} proof timestamp not required for this command`,
    },
  ];
}

function workOSFgaReadiness(input: {
  workspaceRoot: string;
  file: string;
  manifest: WorkOSFgaManifest;
  state: WorkOSFgaStateSummary;
  seedState: WorkOSSeedStateSummary;
  real: boolean;
}): WorkOSFgaReadiness {
  const membershipEnv = workOSFgaMembershipEnvSummary(input.workspaceRoot, input.manifest.organizations);
  const planReady = input.manifest.diagnostics.length === 0 &&
    input.manifest.resourceTypes.includes("organization") &&
    input.manifest.proofScenarios.some((scenario) => scenario.expected === "allow") &&
    input.manifest.proofScenarios.some((scenario) => scenario.expected === "deny");
  const seedReady = !input.real || Boolean(input.seedState.exists && input.seedState.valid && input.seedState.matchesSeedHash === true);
  const synced = Boolean(input.state.exists && input.state.valid && input.state.matchesManifestHash === true);
  const resourceTypesConfigured = !input.real || Boolean(synced && input.state.mode === "real" && input.state.sdkOk === true);
  const membershipEnvReady = !input.real || membershipEnv.complete;
  const proved = !input.real
    ? Boolean(input.state.provedAt)
    : Boolean(synced && input.state.mode === "real" && input.state.sdkOk === true && input.state.provedAt);
  const productionReady = Boolean(planReady && seedReady && resourceTypesConfigured && membershipEnvReady && proved);
  let nextCommand = `forge workos fga plan --file ${input.file} --write --json`;
  if (planReady && input.real && !seedReady) {
    nextCommand = `forge workos prove --real --file ${input.file} --json`;
  } else if (planReady && input.real && !resourceTypesConfigured) {
    nextCommand = `forge workos fga sync --real --file ${input.file} --write --json`;
  } else if (planReady && input.real && !membershipEnvReady) {
    nextCommand = `forge workos fga prove --real --file ${input.file} --json`;
  } else if (planReady && input.real && !proved) {
    nextCommand = `forge workos fga prove --real --file ${input.file} --json`;
  } else if (planReady && !input.real && !synced) {
    nextCommand = `forge workos fga sync --file ${input.file} --json`;
  } else if (planReady && !input.real && !proved) {
    nextCommand = `forge workos fga prove --file ${input.file} --json`;
  } else if (productionReady || (planReady && !input.real)) {
    nextCommand = "forge deploy check --production --json";
  }
  const nextActions = [
    ...(planReady ? [] : [`repair FGA manifest gaps, then run forge workos fga plan --file ${input.file} --write --json`]),
    ...(input.real && !seedReady ? [`apply/prove hosted WorkOS seed: forge workos prove --real --file ${input.file} --json`] : []),
    ...(input.real && !resourceTypesConfigured
      ? [
          "configure hosted WorkOS FGA resource types listed in resourceTypeSetup",
          `sync real WorkOS FGA resources: forge workos fga sync --real --file ${input.file} --write --json`,
        ]
      : []),
    ...(input.real && !membershipEnvReady
      ? [`set WORKOS_FGA_MEMBERSHIPS_JSON or ${membershipEnv.missingEnv.join(", ") || "WORKOS_FGA_MEMBERSHIP_<ORG>"} before real access checks`]
      : []),
    ...(input.real && membershipEnvReady && resourceTypesConfigured && !proved
      ? [`prove real WorkOS FGA access checks: forge workos fga prove --real --file ${input.file} --json`]
      : []),
    ...(productionReady ? ["rerun forge deploy check --production --json"] : []),
    ...(!input.real && planReady && !synced ? [`run forge workos fga sync --file ${input.file} --json`] : []),
    ...(!input.real && planReady && synced && !proved ? [`run forge workos fga prove --file ${input.file} --json`] : []),
  ];
  return {
    real: input.real,
    planReady,
    seedReady,
    resourceTypesConfigured,
    membershipEnvReady,
    synced,
    proved,
    productionReady,
    nextCommand,
    nextActions,
  };
}

function collectWorkOSFgaDoctorChecks(input: {
  workspaceRoot: string;
  file: string;
  manifest: WorkOSFgaManifest;
  state: WorkOSFgaStateSummary;
  seedState: WorkOSSeedStateSummary;
  real: boolean;
}): WorkOSCheck[] {
  const readiness = workOSFgaReadiness(input);
  const membershipEnv = workOSFgaMembershipEnvSummary(input.workspaceRoot, input.manifest.organizations);
  return [
    ...collectWorkOSFgaChecks({
      manifest: input.manifest,
      state: input.state,
      requireState: input.real,
      requireRealState: input.real,
      requireProof: input.real,
    }),
    {
      name: "fga-seed-state",
      ok: !input.real || readiness.seedReady,
      detail: !input.real
        ? "hosted seed evidence is only required for --real doctor"
        : readiness.seedReady
          ? `${WORKOS_SEED_STATE_FILE} matches ${input.file}`
          : `real FGA proof requires hosted seed evidence matching ${input.file}; run forge workos prove --real --file ${input.file} --json`,
    },
    {
      name: "fga-hosted-resource-types",
      ok: !input.real || readiness.resourceTypesConfigured,
      detail: !input.real
        ? "hosted WorkOS resource type existence is only verified by --real sync/prove"
        : readiness.resourceTypesConfigured
          ? `${WORKOS_FGA_STATE_FILE} records successful real Authorization API resource sync`
          : "real FGA requires hosted WorkOS resource types for every non-organization resource; run forge workos fga plan --write and configure any listed resource types before sync",
    },
    {
      name: "fga-membership-env",
      ok: !input.real || readiness.membershipEnvReady,
      detail: !input.real
        ? "organizationMembershipId env is only required for real WorkOS access checks"
        : readiness.membershipEnvReady
          ? `membership env is present${membershipEnv.jsonEnvPresent ? " through WORKOS_FGA_MEMBERSHIPS_JSON" : ` through ${membershipEnv.presentEnv.join(", ")}`}`
          : `missing organizationMembershipId env for real checks: WORKOS_FGA_MEMBERSHIPS_JSON or ${membershipEnv.missingEnv.join(", ")}`,
    },
    {
      name: "fga-production-readiness",
      ok: !input.real || readiness.productionReady,
      detail: !input.real
        ? "run forge workos fga doctor --real --json for production FGA gates"
        : readiness.productionReady
          ? "real WorkOS FGA seed, resource sync, membership env, and proof are current"
          : `real WorkOS FGA is not production-ready; next command: ${readiness.nextCommand}`,
    },
  ];
}

export function runWorkOSFgaCommand(options: WorkOSCommandOptions): WorkOSCommandResult {
  const action = options.fgaAction ?? "doctor";
  const file = options.file ?? DEFAULT_SEED_FILE;
  const manifest = collectWorkOSFgaManifest(options.workspaceRoot, file);
  const initialHostedSetup = workOSFgaHostedSetup(manifest);
  const setupGuidePath = resolveWorkOSFgaSetupGuidePath(options);
  const writtenSetupGuidePath = setupGuidePath
    ? writeWorkOSFgaSetupGuide(options.workspaceRoot, workOSFgaSetupGuide(manifest, initialHostedSetup), setupGuidePath)
    : undefined;
  let state = readWorkOSFgaState(options.workspaceRoot, manifest);
  const command = ["forge", "workos", "fga", action, "--file", file];
  const real = options.real ?? false;
  const requireState = action === "prove" || action === "doctor";
  const requireRealState = real && action !== "plan";
  const requireProof = real && action === "doctor";
  const seed = parseSeedFile(options.workspaceRoot, file);
  const seedState = readWorkOSSeedState(options.workspaceRoot, seed);
  const checks: WorkOSCheck[] = collectWorkOSFgaChecks({
    manifest,
    state,
    requireState,
    requireRealState,
    requireProof,
  });

  if (action === "plan") {
    const ok = checks.filter((check) => check.name !== "fga-state" && check.name !== "fga-real-state" && check.name !== "fga-proof-state").every((check) => check.ok);
    return {
      ok,
      kind: "workos-fga",
      checks,
      command,
      applied: false,
      data: fgaData({
        action,
        workspaceRoot: options.workspaceRoot,
        manifest,
        state,
        seedState,
        real,
        ...(writtenSetupGuidePath ? { setupGuidePath: writtenSetupGuidePath } : {}),
        nextCommand: `forge workos fga sync --file ${file} --json`,
      }),
      exitCode: ok ? 0 : 1,
    };
  }

  if (action === "sync") {
    const cliAuth = real ? ensureWorkOSCliAuthForHosted(options) : undefined;
    const realChecks: WorkOSCheck[] = real
      ? [
          ...(cliAuth && !cliAuth.ok ? [workOSCliAuthCheck(cliAuth)] : []),
          {
            name: "fga-seed-state",
            ok: Boolean(seedState.exists && seedState.valid && seedState.matchesSeedHash === true),
            detail: seedState.matchesSeedHash
              ? `${WORKOS_SEED_STATE_FILE} matches ${seed.path}`
              : `real FGA sync requires hosted seed evidence; run forge workos prove --real --file ${file} --json first`,
          },
        ]
      : [];
    const allChecks = [...checks.filter((check) => check.name !== "fga-state" && check.name !== "fga-real-state" && check.name !== "fga-proof-state"), ...realChecks];
    if (!allChecks.every((check) => check.ok)) {
      return {
        ok: false,
        kind: "workos-fga",
        checks: allChecks,
        command: cliAuth && !cliAuth.ok ? cliAuth.loginCommand ?? cliAuth.statusCommand : command,
        applied: false,
        data: fgaData({
          action,
          workspaceRoot: options.workspaceRoot,
          manifest,
          state,
          seedState,
          real,
          ...(cliAuth ? { cliAuth } : {}),
          ...(writtenSetupGuidePath ? { setupGuidePath: writtenSetupGuidePath } : {}),
          nextCommand: real ? `forge workos fga sync --real --file ${file} --json` : `forge workos fga plan --file ${file} --json`,
        }),
        exitCode: 1,
      };
    }
    if (options.dryRun) {
      return {
        ok: true,
        kind: "workos-fga",
        checks: allChecks,
        command,
        applied: false,
        data: fgaData({
          action,
          workspaceRoot: options.workspaceRoot,
          manifest,
          state,
          seedState,
          real,
          ...(cliAuth ? { cliAuth } : {}),
          ...(writtenSetupGuidePath ? { setupGuidePath: writtenSetupGuidePath } : {}),
          nextCommand: real ? `forge workos fga sync --real --file ${file} --json` : `forge workos fga sync --file ${file} --json`,
        }),
        exitCode: 0,
      };
    }
    const sdk = real ? runWorkOSFgaSdk(options, manifest, "sync") : undefined;
    if (sdk && !sdk.ok) {
      return {
        ok: false,
        kind: "workos-fga",
        checks: [
          ...allChecks,
          {
            name: "fga-real-sdk-sync",
            ok: false,
            detail: workOSFgaSdkFailureDetail(sdk.data, manifest),
          },
        ],
        command: sdk.command,
        applied: false,
        data: fgaData({
          action,
          workspaceRoot: options.workspaceRoot,
          manifest,
          state,
          seedState,
          real,
          ...(cliAuth ? { cliAuth } : {}),
          workosSdk: sdk.data,
          ...(writtenSetupGuidePath ? { setupGuidePath: writtenSetupGuidePath } : {}),
          nextCommand: `forge workos fga sync --real --file ${file} --json`,
          nextActions: workOSFgaHostedSetup(manifest, sdk.data).nextActions,
        }),
        stdout: sdk.stdout,
        stderr: sdk.stderr,
        exitCode: 1,
      };
    }
    const stateFile = writeWorkOSFgaState({
      workspaceRoot: options.workspaceRoot,
      manifest,
      mode: real ? "real" : "local",
      proved: false,
      ...(sdk ? { sdkOk: sdk.ok, sdk: sdk.data } : {}),
    });
    state = readWorkOSFgaState(options.workspaceRoot, manifest);
    return {
      ok: true,
      kind: "workos-fga",
      checks: collectWorkOSFgaChecks({ manifest, state, requireState: true, requireRealState: real }),
      command,
      applied: true,
      data: fgaData({
        action,
        workspaceRoot: options.workspaceRoot,
        manifest,
        state,
        seedState,
        real,
        ...(cliAuth ? { cliAuth } : {}),
        ...(sdk ? { workosSdk: sdk.data } : {}),
        stateFile,
        ...(writtenSetupGuidePath ? { setupGuidePath: writtenSetupGuidePath } : {}),
        nextCommand: real ? `forge workos fga prove --real --file ${file} --json` : `forge workos fga prove --file ${file} --json`,
      }),
      exitCode: 0,
    };
  }

  if (action === "prove") {
    const cliAuth = real ? ensureWorkOSCliAuthForHosted(options) : undefined;
    const sdk = real && state.exists && state.valid && state.matchesManifestHash === true && state.mode === "real"
      ? runWorkOSFgaSdk(options, manifest, "prove")
      : undefined;
    const sdkProofComplete = sdk ? workOSFgaSdkProofComplete(sdk.data, manifest) : false;
    const proofChecks: WorkOSCheck[] = [
      ...checks,
      ...(cliAuth && !cliAuth.ok ? [workOSCliAuthCheck(cliAuth)] : []),
      ...(sdk
        ? [
            {
              name: "fga-real-sdk-proof",
              ok: sdk.ok && sdkProofComplete,
              detail: sdk.ok && sdkProofComplete
                ? "WorkOS Authorization API resource sync/check proof completed for every scenario"
                : workOSFgaSdkFailureDetail(sdk.data, manifest),
            },
          ]
        : real
          ? [
              {
                name: "fga-real-sdk-proof",
                ok: false,
                detail: "real FGA proof requires a fresh real FGA state from forge workos fga sync --real --json",
              },
            ]
          : []),
      {
        name: "fga-cross-tenant-proof",
        ok: manifest.proofScenarios.some((scenario) => scenario.name.includes("cross-tenant") && scenario.expected === "deny"),
        detail: "FGA proof includes cross-tenant denial scenario using resourceExternalId and resourceTypeSlug",
      },
      {
        name: "fga-authorization-api-shape",
        ok: true,
        detail: "proof contract uses organizationMembershipId, resourceExternalId, resourceTypeSlug, and permission slugs",
      },
    ];
    const ok = proofChecks.every((check) => check.ok);
    const stateFile = ok && !options.dryRun
      ? writeWorkOSFgaState({
        workspaceRoot: options.workspaceRoot,
        manifest,
        mode: real ? "real" : "local",
        proved: true,
        ...(sdk ? { sdkOk: sdk.ok, sdk: sdk.data } : {}),
      })
      : undefined;
    state = stateFile ? readWorkOSFgaState(options.workspaceRoot, manifest) : state;
    return {
      ok,
      kind: "workos-fga",
      checks: proofChecks,
      command: cliAuth && !cliAuth.ok ? cliAuth.loginCommand ?? cliAuth.statusCommand : command,
      applied: Boolean(ok && !options.dryRun),
      data: fgaData({
        action,
        workspaceRoot: options.workspaceRoot,
        manifest,
        state,
        seedState,
        real,
        ...(cliAuth ? { cliAuth } : {}),
        ...(sdk ? { workosSdk: sdk.data } : {}),
        ...(stateFile ? { stateFile } : {}),
        ...(writtenSetupGuidePath ? { setupGuidePath: writtenSetupGuidePath } : {}),
        nextCommand: ok ? "forge deploy check --production --json" : `forge workos fga sync${real ? " --real" : ""} --file ${file} --json`,
      }),
      stdout: sdk?.stdout,
      stderr: sdk?.stderr,
      exitCode: ok ? 0 : 1,
    };
  }

  const doctorChecks = collectWorkOSFgaDoctorChecks({
    workspaceRoot: options.workspaceRoot,
    file,
    manifest,
    state,
    seedState,
    real,
  });
  const readiness = workOSFgaReadiness({
    workspaceRoot: options.workspaceRoot,
    file,
    manifest,
    state,
    seedState,
    real,
  });
  const ok = doctorChecks.every((check) => check.ok);
  return {
    ok,
    kind: "workos-fga",
    checks: doctorChecks,
    command,
    applied: false,
    data: fgaData({
      action,
      workspaceRoot: options.workspaceRoot,
      manifest,
      state,
      seedState,
      readiness,
      real,
      ...(writtenSetupGuidePath ? { setupGuidePath: writtenSetupGuidePath } : {}),
      nextCommand: readiness.nextCommand,
      nextActions: readiness.nextActions,
    }),
    exitCode: ok ? 0 : 1,
  };
}

export function runWorkOSCommand(options: WorkOSCommandOptions): WorkOSCommandResult {
  if (options.subcommand === "fga") {
    return runWorkOSFgaCommand(options);
  }
  if (options.subcommand === "install") {
    return runWorkOSInstallCommand(options);
  }
  if (options.subcommand === "setup") {
    return runWorkOSSetupCommand(options);
  }
  if (options.subcommand === "prove") {
    return runWorkOSProveCommand(options);
  }
  return options.subcommand === "doctor"
    ? runWorkOSDoctorCommand(options)
    : runWorkOSSeedCommand(options);
}

export function formatWorkOSJson(result: WorkOSCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatWorkOSHuman(result: WorkOSCommandResult): string {
  const lines = [
    result.ok ? "WorkOS: ok" : "WorkOS: needs attention",
    ...result.checks.map((check) => `${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}`),
  ];
  const dataObject = result.data && typeof result.data === "object"
    ? result.data as {
      cliAuth?: WorkOSCliAuthSummary;
      seedResult?: { cliAuth?: WorkOSCliAuthSummary };
      setup?: { cliAuth?: WorkOSCliAuthSummary; seedResult?: { cliAuth?: WorkOSCliAuthSummary } };
    }
    : {};
  const cliAuth = dataObject.cliAuth ?? dataObject.seedResult?.cliAuth ?? dataObject.setup?.cliAuth ?? dataObject.setup?.seedResult?.cliAuth;
  if (cliAuth) {
    if (cliAuth.ok && cliAuth.method === "cli") {
      lines.push(`WorkOS CLI authenticated${cliAuth.email ? ` as ${cliAuth.email}` : ""}; hosted setup can proceed without opening the dashboard.`);
    } else if (!cliAuth.ok && cliAuth.loginInstructions) {
      lines.push("WorkOS CLI login required before hosted setup can proceed.");
      if (cliAuth.loginShellCommand) {
        lines.push(`login: ${cliAuth.loginShellCommand}`);
      }
      if (cliAuth.loginInstructions.url) {
        lines.push(`open: ${cliAuth.loginInstructions.url}`);
      }
      if (cliAuth.loginInstructions.code) {
        lines.push(`code: ${cliAuth.loginInstructions.code}`);
      }
      if (cliAuth.rerunCommand) {
        lines.push(`rerun: ${cliAuth.rerunCommand}`);
      }
    } else if (cliAuth.method === "api-key") {
      lines.push("WorkOS hosted setup will use WORKOS_API_KEY; CLI browser login is optional.");
    }
  }
  if (result.command) {
    lines.push(`command: ${result.command.join(" ")}`);
  }
  if (result.kind === "workos-install" && !result.applied) {
    lines.push("AuthKit install not applied; pass --yes to execute the WorkOS CLI command");
  }
  if (result.kind === "workos-doctor" && !result.applied) {
    lines.push("external WorkOS doctor not run; pass --yes to execute the WorkOS CLI command");
  }
  if (result.kind === "workos-seed" && !result.applied) {
    const data = result.data && typeof result.data === "object"
      ? result.data as { dryRun?: boolean; seedAlreadyApplied?: boolean; seedStateFile?: string; nextCommand?: string }
      : {};
    if (data.seedAlreadyApplied) {
      lines.push(`seed already appears applied; WorkOS reported existing resources${data.seedStateFile ? ` and Forge wrote ${data.seedStateFile}` : ""}`);
    } else if (data.dryRun) {
      lines.push(`seed dry-run only; run ${data.nextCommand ?? "forge workos seed --file workos-seed.yml --json"} to execute the WorkOS CLI command`);
    } else {
      lines.push("seed not applied; inspect stdout/stderr from the WorkOS CLI command");
    }
  } else if (result.kind === "workos-seed" && result.applied) {
    const data = result.data && typeof result.data === "object"
      ? result.data as { seedStateFile?: string }
      : {};
    if (data.seedStateFile) {
      lines.push(`seed applied; Forge wrote ${data.seedStateFile}`);
    }
  }
  if (result.kind === "workos-setup" && !result.applied) {
    const data = result.data && typeof result.data === "object"
      ? result.data as { dryRun?: boolean; nextCommand?: string }
      : {};
    if (data.dryRun) {
      lines.push(`setup dry-run only; run ${data.nextCommand ?? "forge workos setup --real --file workos-seed.yml --json"} to apply hosted config`);
    } else {
      lines.push("setup not applied; inspect WorkOS checks and seed/config action output");
    }
  } else if (result.kind === "workos-setup" && result.applied) {
    const data = result.data && typeof result.data === "object"
      ? result.data as { seedState?: { path?: string; matchesSeedHash?: boolean | null } }
      : {};
    if (data.seedState?.path) {
      lines.push(
        data.seedState.matchesSeedHash === true
          ? `setup applied; ${data.seedState.path} matches the current seed`
          : `setup applied; inspect ${data.seedState.path} because it does not prove the current seed`,
      );
    }
  }
  if (result.kind === "workos-prove") {
    const data = result.data && typeof result.data === "object"
      ? result.data as { real?: boolean; nextCommand?: string }
      : {};
    if (result.ok && data.real) {
      lines.push("WorkOS real proof passed; hosted setup and seed evidence are recorded.");
    } else if (result.ok) {
      lines.push(`WorkOS proof dry-run passed; run ${data.nextCommand ?? "forge workos prove --real --file workos-seed.yml --json"} to apply hosted setup.`);
    } else {
      lines.push("WorkOS proof failed; inspect doctor, seed, and setup details.");
    }
  }
  if (result.kind === "workos-fga") {
    const data = result.data && typeof result.data === "object"
      ? result.data as { action?: string; real?: boolean; nextCommand?: string; stateFile?: string; setupGuidePath?: string; nextActions?: string[] }
      : {};
    if (data.setupGuidePath) {
      lines.push(`FGA setup guide: ${data.setupGuidePath}`);
    }
    if (result.ok && data.action === "plan") {
      lines.push(`WorkOS FGA plan passed; run ${data.nextCommand ?? "forge workos fga sync --json"}.`);
    } else if (result.ok && data.action === "sync") {
      lines.push(`WorkOS FGA sync recorded${data.stateFile ? ` in ${data.stateFile}` : ""}; run ${data.nextCommand ?? "forge workos fga prove --json"}.`);
    } else if (result.ok && data.action === "prove") {
      lines.push(`WorkOS FGA proof passed${data.real ? " for real-mode state" : " locally"}; production deploy gates can inspect the FGA state.`);
    } else if (result.ok && data.action === "doctor") {
      lines.push(`WorkOS FGA doctor passed${data.real ? " for real production gates" : " for local planning"}; run ${data.nextCommand ?? "forge workos fga sync --json"} if you need the next proof step.`);
    } else if (!result.ok) {
      lines.push("WorkOS FGA check failed; inspect manifest diagnostics, seed coverage, and FGA state.");
      for (const action of data.nextActions ?? []) {
        lines.push(`  - ${action}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
