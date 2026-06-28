import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";

export type WorkOSSubcommand = "install" | "doctor" | "seed";

export interface WorkOSCommandOptions {
  subcommand: WorkOSSubcommand;
  workspaceRoot: string;
  json: boolean;
  file?: string;
  yes: boolean;
  dryRun: boolean;
  commandRunner?: WorkOSCommandRunner;
}

export interface WorkOSCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface WorkOSCommandResult {
  ok: boolean;
  kind: "workos-install" | "workos-doctor" | "workos-seed";
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

function includesAll(haystack: string, needles: string[]): boolean {
  return needles.every((needle) => haystack.includes(needle));
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
  const diagnostics: string[] = [];
  let section = "";

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
      diagnostics: [`${seedPath} is missing or empty`],
    };
  }

  for (const line of raw.split(/\r?\n/)) {
    const rootSection = /^([a-zA-Z_][\w-]*):\s*$/.exec(line);
    if (rootSection) {
      section = rootSection[1]!;
      continue;
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
    diagnostics,
  };
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

function collectWorkOSChecks(workspaceRoot: string): WorkOSCheck[] {
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
  const seed = parseSeedFile(workspaceRoot);
  const activePermissions = collectPolicyPermissions(workspaceRoot);
  const expectedResourceTypes = collectExpectedResourceTypes(workspaceRoot);
  const missingSeedPermissions = missingValues(activePermissions, seed.permissions);
  const missingSeedResources = missingValues(expectedResourceTypes, seed.resourceTypes);
  const authRoutes = readText(workspaceRoot, `${GENERATED_DIR}/integrations/workos/auth-routes.ts`);
  const fga = readText(workspaceRoot, `${GENERATED_DIR}/integrations/workos/fga.ts`);
  const resourceMap = readText(workspaceRoot, `${GENERATED_DIR}/integrations/workos/resource-map.ts`);
  const httpHandler = readText(workspaceRoot, `${GENERATED_DIR}/integrations/workos/http-handler.ts`);
  const policies = readText(workspaceRoot, "src/policies.workos.ts");
  const session = readText(workspaceRoot, `${GENERATED_DIR}/integrations/workos/session.ts`);
  const webhook = readText(workspaceRoot, `${GENERATED_DIR}/integrations/workos/webhook.ts`);

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
      ok: exists(workspaceRoot, ".env.example"),
      detail: ".env.example exists",
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
      name: "seed-resource-types",
      ok: seed.resourceTypes.length > 0 &&
        (expectedResourceTypes.length === 0 || missingSeedResources.length === 0),
      detail: missingSeedResources.length === 0
        ? `seed resource_types cover app graph: ${expectedResourceTypes.length > 0 ? expectedResourceTypes.join(", ") : seed.resourceTypes.join(", ")}`
        : `seed missing resource_type(s) for app graph: ${missingSeedResources.join(", ")}`,
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

export function runWorkOSDoctorCommand(options: WorkOSCommandOptions): WorkOSCommandResult {
  const checks = collectWorkOSChecks(options.workspaceRoot);
  const ok = checks.every((check) => check.ok);
  const command = ["npx", "--yes", "workos@latest", "doctor"];
  if (!ok) {
    return {
      ok: false,
      kind: "workos-doctor",
      checks,
      command,
      applied: false,
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
      name: "seed-resource-coverage",
      ok: missingSeedResources.length === 0,
      detail: missingSeedResources.length === 0
        ? `seed covers app resource type(s): ${expectedResourceTypes.join(", ") || "none required"}`
        : `seed missing resource type(s): ${missingSeedResources.join(", ")}`,
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
      data: { seed, activePermissions, expectedResourceTypes, unusedSeedPermissions },
      exitCode: 1,
    };
  }
  if (!options.yes || options.dryRun) {
    return {
      ok: true,
      kind: "workos-seed",
      checks,
      command,
      applied: false,
      data: { seed, activePermissions, expectedResourceTypes, unusedSeedPermissions },
      exitCode: 0,
    };
  }
  const child = runExternalCommand(command, options);
  return {
    ok: child.status === 0,
    kind: "workos-seed",
    checks,
    command,
    applied: child.status === 0,
    data: { seed, activePermissions, expectedResourceTypes, unusedSeedPermissions },
    stdout: child.stdout,
    stderr: child.stderr,
    exitCode: child.status === 0 ? 0 : 1,
  };
}

export function runWorkOSCommand(options: WorkOSCommandOptions): WorkOSCommandResult {
  if (options.subcommand === "install") {
    return runWorkOSInstallCommand(options);
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
    lines.push("seed not applied; pass --yes to execute the WorkOS CLI command");
  }
  return `${lines.join("\n")}\n`;
}
