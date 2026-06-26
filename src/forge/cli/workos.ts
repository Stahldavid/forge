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

const DEFAULT_SEED_FILE = `${GENERATED_DIR}/integrations/workos/workos-seed.yml`;

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
  const seedFile = readText(workspaceRoot, DEFAULT_SEED_FILE);
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
      ok: exists(workspaceRoot, DEFAULT_SEED_FILE),
      detail: `${DEFAULT_SEED_FILE} exists`,
    },
    {
      name: "seed-organizations",
      ok: includesAll(seedFile, ["Acme Corp", "Globex", "acme.test", "globex.test"]),
      detail: "seed file contains Acme/Globex demo organizations and domains",
    },
    {
      name: "seed-roles-permissions",
      ok: includesAll(seedFile, [
        "owner",
        "manager",
        "member",
        "onboarding:read",
        "invitations:create",
        "tasks:update",
      ]),
      detail: "seed file contains owner/manager/member roles and onboarding permissions",
    },
    {
      name: "seed-resource-types",
      ok: includesAll(seedFile, ["resource_types:", "organization", "project", "taskGroup", "task"]),
      detail: "seed file contains WorkOS FGA resource types for the Forge app graph",
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
        includesAll(fga, ["forgeWorkOSResourceTypes", "organization", "project", "task"]),
      detail: "WorkOS FGA resource-map bridge exists with sync, cache, telemetry, official check shape, and cross-tenant guard",
    },
    {
      name: "policies",
      ok: exists(workspaceRoot, "src/policies.workos.ts") &&
        includesAll(policies, ["canPermission", "invitations:create", "tasks:update"]),
      detail: "WorkOS-derived Forge policy template exists and is permission-first",
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
  const checks = [
    {
      name: "seed-file",
      ok: exists(options.workspaceRoot, file),
      detail: `${file} exists`,
    },
  ];
  const command = ["npx", "--yes", "workos@latest", "seed", "--file", file];
  if (!checks.every((check) => check.ok)) {
    return { ok: false, kind: "workos-seed", checks, command, applied: false, exitCode: 1 };
  }
  if (!options.yes || options.dryRun) {
    return { ok: true, kind: "workos-seed", checks, command, applied: false, exitCode: 0 };
  }
  const child = runExternalCommand(command, options);
  return {
    ok: child.status === 0,
    kind: "workos-seed",
    checks,
    command,
    applied: child.status === 0,
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
