import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";

export type WorkOSSubcommand = "install" | "doctor" | "seed" | "setup" | "prove";

export interface WorkOSCommandOptions {
  subcommand: WorkOSSubcommand;
  workspaceRoot: string;
  json: boolean;
  file?: string;
  yes: boolean;
  dryRun: boolean;
  real?: boolean;
  commandRunner?: WorkOSCommandRunner;
}

export interface WorkOSCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface WorkOSCommandResult {
  ok: boolean;
  kind: "workos-install" | "workos-doctor" | "workos-seed" | "workos-setup" | "workos-prove";
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
  },
) => { status: number | null; stdout: string; stderr: string };

const DEFAULT_SEED_FILE = "workos-seed.yml";
const GENERATED_SEED_FILE = `${GENERATED_DIR}/integrations/workos/workos-seed.yml`;
const WORKOS_SEED_STATE_FILE = ".workos-seed-state.json";

function runExternalCommand(
  command: string[],
  options: WorkOSCommandOptions,
): { status: number | null; stdout: string; stderr: string } {
  const runner = options.commandRunner ?? spawnSync;
  const result = runner(command[0]!, command.slice(1), {
    cwd: options.workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
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

export interface WorkOSDoctorData {
  seed: WorkOSSeedSummary;
  seedState: WorkOSSeedStateSummary;
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
  seedStateFile?: string;
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
    ...(input.seedStateFile ? { seedStateFile: input.seedStateFile } : {}),
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
          seedFileSanitized: preparedSeed.sanitized,
          configActions,
        }),
        exitCode: 1,
      };
    }
    const child = runExternalCommand(delegatedCommand, options);
    const seedAlreadyApplied =
      child.status !== 0 && isWorkOSSeedAlreadyApplied(child.stdout, child.stderr);
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
        seedFileSanitized: preparedSeed.sanitized,
        seedAlreadyApplied,
        seedStateFile,
        configActions,
      }),
      stdout: child.stdout,
      stderr: child.stderr,
      exitCode: child.status === 0 || seedAlreadyApplied ? 0 : 1,
    };
  } finally {
    preparedSeed.cleanup();
  }
}

export function runWorkOSSetupCommand(options: WorkOSCommandOptions): WorkOSCommandResult {
  const file = options.file ?? DEFAULT_SEED_FILE;
  const checks = collectWorkOSChecks(options.workspaceRoot);
  const localOk = checks.every((check) => check.ok);
  const seed = parseSeedFile(options.workspaceRoot, file);
  const seedState = readWorkOSSeedState(options.workspaceRoot, seed);
  const setupDryRun = options.dryRun || !options.real;
  const configActions = runWorkOSConfigActions(seed, options, true);
  const command = ["npx", "--yes", "workos@latest", "seed", "--file", file];
  if (!localOk) {
    return {
      ok: false,
      kind: "workos-setup",
      checks,
      command,
      applied: false,
      data: {
        dryRun: setupDryRun,
        real: options.real ?? false,
        seed,
        seedState,
        configActions,
        nextCommand: "forge workos doctor --json",
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
    checks: seedResult.checks,
    command: seedResult.command,
    applied: seedResult.ok,
    data: {
      real: true,
      seed,
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
  const checks: WorkOSCheck[] = [
    ...doctor.checks.map((check) => ({ ...check, name: `doctor:${check.name}` })),
    {
      name: "seed:dry-run",
      ok: seed.ok,
      detail: seed.ok
        ? `${file} is valid, app-aware, and ready for hosted application`
        : `${file} failed seed validation before hosted application`,
    },
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

export function runWorkOSCommand(options: WorkOSCommandOptions): WorkOSCommandResult {
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
  return `${lines.join("\n")}\n`;
}
