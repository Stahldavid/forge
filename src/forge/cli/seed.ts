import { join } from "node:path";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { RuntimeEntry, RuntimeGraph } from "../compiler/types/runtime-graph.ts";
import { normalizeForgeCliCommandsInValue } from "../workspace/forge-cli.ts";

export type SeedSubcommand = "status" | "dev" | "reset";

export interface SeedCommandOptions {
  subcommand: SeedSubcommand;
  command?: string;
  args: unknown;
  url?: string;
  userId?: string;
  tenantId?: string;
  role?: string;
  permissions?: string[];
  allTenants?: boolean;
  json: boolean;
  workspaceRoot: string;
}

export interface SeedCommandResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  subcommand: SeedSubcommand;
  url: string;
  readiness: {
    ready: boolean;
    reason: "seed-command-ready" | "requested-command-missing" | "no-seed-command";
    autoSeedOnDev: boolean;
    autoSeedAllTenantsOnDev: boolean;
    autoSeedMode: "none" | "default-tenant" | "all-tenants";
    selectedCommand?: string;
    defaultAuth: {
      userId: string;
      tenantId: string;
      role: string;
      permissions: string[];
    };
    localTenants: Array<{
      tenantId: string;
      label?: string;
      organizationName?: string;
      userId?: string;
      role?: string;
      permissions: string[];
      seedCommand: string;
      resetCommand: string;
    }>;
    emptyWorkspaceRecovery: string[];
  };
  commands: Array<{
    name: string;
    file: string;
    selected: boolean;
  }>;
  selectedCommand?: string;
  request?: {
    endpoint: string;
    args: unknown;
    auth: {
      userId?: string;
      tenantId?: string;
      role?: string;
      permissions: string[];
    };
  };
  response?: {
    status: number;
    ok: boolean;
    body: unknown;
  };
  tenantRuns?: Array<{
    tenantId: string;
    label?: string;
    organizationName?: string;
    ok: boolean;
    request?: SeedCommandResult["request"];
    response?: SeedCommandResult["response"];
    diagnostics: Diagnostic[];
  }>;
  diagnostics: Diagnostic[];
  nextActions: string[];
  exitCode: 0 | 1;
}

const DEFAULT_SEED_USER_ID = "forge-seed";
const DEFAULT_SEED_TENANT_ID = "11111111-1111-4111-8111-111111111111";

function runtimeUrl(options: SeedCommandOptions): string {
  return (options.url ?? process.env.FORGE_DEV_URL ?? "http://127.0.0.1:3765").replace(/\/$/, "");
}

function readRuntimeGraph(workspaceRoot: string): RuntimeGraph | null {
  const path = join(workspaceRoot, GENERATED_DIR, "runtimeGraph.json");
  if (!nodeFileSystem.exists(path)) return null;
  return JSON.parse(stripDeterministicHeader(nodeFileSystem.readText(path) ?? "{}")) as RuntimeGraph;
}

function discoverSeedCommands(workspaceRoot: string): RuntimeEntry[] {
  const graph = readRuntimeGraph(workspaceRoot);
  return (graph?.entries ?? [])
    .filter((entry) => entry.kind === "command" && /(^|[._-])seed|seed[A-Z_\\.-]?/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function defaultPermissions(options: SeedCommandOptions): string[] {
  return options.permissions && options.permissions.length > 0 ? options.permissions : ["demo:seed"];
}

function selectSeedCommand(commands: RuntimeEntry[], requested?: string): RuntimeEntry | undefined {
  if (requested) {
    return commands.find((entry) => entry.name === requested);
  }
  return commands[0];
}

function packageJson(workspaceRoot: string): { scripts?: Record<string, string> } | null {
  const text = nodeFileSystem.readText(join(workspaceRoot, "package.json"));
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as { scripts?: Record<string, string> };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readWorkspaceText(workspaceRoot: string, relativePath: string): string {
  return nodeFileSystem.readText(join(workspaceRoot, relativePath)) ?? "";
}

function quotedProperty(block: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*:\\s*["']([^"']+)["']`).exec(block);
  return match?.[1];
}

function quotedArrayProperty(block: string, name: string): string[] {
  const match = new RegExp(`\\b${name}\\s*:\\s*\\[([\\s\\S]*?)\\]`).exec(block);
  if (!match) return [];
  return [...match[1]!.matchAll(/["']([^"']+)["']/g)].map((item) => item[1]!).filter(Boolean);
}

function shellValue(value: string): string {
  return /^[A-Za-z0-9_@.,/:+-]+$/.test(value)
    ? value
    : JSON.stringify(value);
}

function discoverLocalSeedTenants(
  workspaceRoot: string,
  selectedCommand?: string,
): SeedCommandResult["readiness"]["localTenants"] {
  if (!selectedCommand) return [];
  const source = [
    "web/src/main.tsx",
    "web/src/main.jsx",
    "web/src/App.tsx",
    "web/src/App.jsx",
  ].map((path) => readWorkspaceText(workspaceRoot, path)).join("\n");
  if (!source.trim()) return [];

  const tenants = new Map<string, SeedCommandResult["readiness"]["localTenants"][number]>();
  for (const match of source.matchAll(/\{[\s\S]*?\borganizationId\s*:\s*["'][^"']+["'][\s\S]*?\}/g)) {
    const block = match[0];
    const tenantId = quotedProperty(block, "organizationId") ?? quotedProperty(block, "tenantId");
    if (!tenantId || tenants.has(tenantId)) continue;
    const permissions = quotedArrayProperty(block, "permissions");
    const userId = quotedProperty(block, "email") ?? quotedProperty(block, "userId");
    const role = quotedProperty(block, "role");
    const seedParts = [
      "forge seed dev",
      `--command ${selectedCommand}`,
      `--tenant-id ${shellValue(tenantId)}`,
      ...(userId ? [`--user-id ${shellValue(userId)}`] : []),
      ...(role ? [`--role ${shellValue(role)}`] : []),
      ...(permissions.length > 0 ? [`--permissions ${shellValue(permissions.join(","))}`] : []),
      "--json",
    ];
    const resetParts = [...seedParts];
    resetParts[0] = "forge seed reset";
    tenants.set(tenantId, {
      tenantId,
      ...(quotedProperty(block, "label") ? { label: quotedProperty(block, "label") } : {}),
      ...(quotedProperty(block, "organizationName") ? { organizationName: quotedProperty(block, "organizationName") } : {}),
      ...(userId ? { userId } : {}),
      ...(role ? { role } : {}),
      permissions,
      seedCommand: seedParts.join(" "),
      resetCommand: resetParts.join(" "),
    });
  }
  return [...tenants.values()];
}

function devScriptHasAutoSeed(workspaceRoot: string): boolean {
  const script = packageJson(workspaceRoot)?.scripts?.dev;
  if (!script) return false;
  const normalized = ` ${script.replace(/\s+/g, " ")} `;
  const invokesForgeDev =
    /\bforge(?:\s+--)?\s+dev\b/.test(normalized) ||
    /(?:^|\s)(?:node\s+)?\.?\/?bin\/forge\.mjs\s+dev\b/.test(normalized);
  return invokesForgeDev && /\s--seed(?:[=\s]|$)/.test(normalized);
}

function devScriptHasAutoSeedAllTenants(workspaceRoot: string): boolean {
  const script = packageJson(workspaceRoot)?.scripts?.dev;
  if (!script) return false;
  const normalized = ` ${script.replace(/\s+/g, " ")} `;
  return devScriptHasAutoSeed(workspaceRoot) && /\s--all-tenants(?:[=\s]|$)/.test(normalized);
}

function buildReadiness(options: SeedCommandOptions, commands: RuntimeEntry[]): SeedCommandResult["readiness"] {
  const requestedMissing = Boolean(options.command) && !commands.some((entry) => entry.name === options.command);
  const selected = selectSeedCommand(commands, options.command);
  const permissions = defaultPermissions(options);
  const ready = commands.length > 0 && !requestedMissing;
  const selectedCommand = selected?.name;
  const autoSeedOnDev = devScriptHasAutoSeed(options.workspaceRoot);
  const autoSeedAllTenantsOnDev = devScriptHasAutoSeedAllTenants(options.workspaceRoot);
  const autoSeedMode: SeedCommandResult["readiness"]["autoSeedMode"] = autoSeedAllTenantsOnDev
    ? "all-tenants"
    : autoSeedOnDev
      ? "default-tenant"
      : "none";
  const localTenants = discoverLocalSeedTenants(options.workspaceRoot, selectedCommand);
  const hasMultipleLocalTenants = localTenants.length > 1;
  const bulkTenantRecovery = ready && selectedCommand && localTenants.length > 1
    ? [
        `forge seed dev --command ${selectedCommand} --all-tenants --json`,
        `forge seed reset --command ${selectedCommand} --all-tenants --json`,
      ]
    : [];
  const emptyWorkspaceRecovery = ready && selectedCommand
    ? [
        autoSeedOnDev && (!hasMultipleLocalTenants || autoSeedAllTenantsOnDev)
          ? "npm run dev"
          : hasMultipleLocalTenants
            ? "forge dev --seed --all-tenants"
            : "forge dev --seed",
        ...bulkTenantRecovery,
        `forge seed dev --command ${selectedCommand} --json`,
        `forge seed reset --command ${selectedCommand} --json`,
      ]
    : ["forge generate", "forge seed status --json"];
  return {
    ready,
    reason: ready
      ? "seed-command-ready"
      : requestedMissing
        ? "requested-command-missing"
        : "no-seed-command",
    autoSeedOnDev,
    autoSeedAllTenantsOnDev,
    autoSeedMode,
    ...(selectedCommand ? { selectedCommand } : {}),
    defaultAuth: {
      userId: options.userId ?? DEFAULT_SEED_USER_ID,
      tenantId: options.tenantId ?? DEFAULT_SEED_TENANT_ID,
      role: options.role ?? "owner",
      permissions,
    },
    localTenants,
    emptyWorkspaceRecovery,
  };
}

function readinessDiagnostics(readiness: SeedCommandResult["readiness"]): Diagnostic[] {
  if (
    readiness.ready &&
    readiness.autoSeedOnDev &&
    !readiness.autoSeedAllTenantsOnDev &&
    readiness.localTenants.length > 1
  ) {
    return [
      createDiagnostic({
        severity: "warning",
        code: "FORGE_SEED_DEV_PARTIAL_TENANTS",
        message: "`npm run dev` auto-seeds only the default tenant, but multiple local tenant/persona profiles were discovered.",
        fixHint: "Use forge dev --seed --all-tenants, or update package.json so the dev script warms every local tenant.",
        suggestedCommands: ["forge dev --seed --all-tenants", "forge seed status --json"],
      }),
    ];
  }
  return [];
}

function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const unique: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = JSON.stringify({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      fixHint: diagnostic.fixHint,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(diagnostic);
  }
  return unique;
}

function headers(options: SeedCommandOptions): Record<string, string> {
  const permissions = defaultPermissions(options);
  return {
    "content-type": "application/json",
    "x-forge-user-id": options.userId ?? DEFAULT_SEED_USER_ID,
    "x-forge-tenant-id": options.tenantId ?? DEFAULT_SEED_TENANT_ID,
    ...(options.role ? { "x-forge-role": options.role } : { "x-forge-role": "owner" }),
    "x-forge-permissions": JSON.stringify(permissions),
  };
}

function resultBase(options: SeedCommandOptions, commands: RuntimeEntry[]): Omit<SeedCommandResult, "ok" | "diagnostics" | "nextActions" | "exitCode"> {
  const selected = selectSeedCommand(commands, options.command);
  return {
    schemaVersion: "0.1.0",
    subcommand: options.subcommand,
    url: runtimeUrl(options),
    readiness: buildReadiness(options, commands),
    selectedCommand: selected?.name,
    commands: commands.map((entry) => ({
      name: entry.name,
      file: entry.file,
      selected: entry.name === selected?.name,
    })),
  };
}

function finishSeedResult(options: SeedCommandOptions, result: SeedCommandResult): SeedCommandResult {
  return normalizeForgeCliCommandsInValue(options.workspaceRoot, result);
}

export async function runSeedCommand(options: SeedCommandOptions): Promise<SeedCommandResult> {
  const commands = discoverSeedCommands(options.workspaceRoot);
  const base = resultBase(options, commands);

  if (options.subcommand === "status") {
    const requestedMissing = Boolean(options.command) && !commands.some((entry) => entry.name === options.command);
    const ok = commands.length > 0 && !requestedMissing;
    const diagnostics = ok
      ? readinessDiagnostics(base.readiness)
      : [
          createDiagnostic({
            severity: "warning",
            code: "FORGE_SEED_COMMAND_MISSING",
            message: requestedMissing
              ? `Seed command '${options.command}' was not found in generated runtimeGraph.json.`
              : "No seed command was found in generated runtimeGraph.json.",
            fixHint: requestedMissing
              ? "Run forge seed status --json to list discovered seed commands."
              : "Add a command named seedDemoData or seed<Feature>Demo, then run forge generate.",
            suggestedCommands: ["forge generate", "forge seed status --json"],
          }),
        ];
    return finishSeedResult(options, {
      ...base,
      ok,
      diagnostics,
      nextActions: ok
        ? base.readiness.emptyWorkspaceRecovery
        : ["forge generate", "forge seed status --json"],
      exitCode: ok ? 0 : 1,
    });
  }

  const selected = selectSeedCommand(commands, options.command);
  if (!selected) {
    return finishSeedResult(options, {
      ...base,
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "FORGE_SEED_COMMAND_MISSING",
          message: options.command
            ? `Seed command '${options.command}' was not found.`
            : "No seed command was found in generated runtimeGraph.json.",
          fixHint: "Run forge seed status --json to list discovered seed commands.",
          suggestedCommands: ["forge generate", "forge seed status --json"],
        }),
      ],
      nextActions: ["forge generate", "forge seed status --json"],
      exitCode: 1,
    });
  }

  if (options.allTenants) {
    const localTenants = base.readiness.localTenants;
    if (localTenants.length === 0) {
      return finishSeedResult(options, {
        ...base,
        ok: false,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: "FORGE_SEED_LOCAL_TENANTS_MISSING",
            message: "No local tenant/persona profiles were discovered for --all-tenants.",
            fixHint: "Run forge seed status --json, or pass --tenant-id explicitly for a single tenant.",
            suggestedCommands: ["forge seed status --json"],
          }),
        ],
        nextActions: ["forge seed status --json"],
        exitCode: 1,
      });
    }
    const tenantRuns: NonNullable<SeedCommandResult["tenantRuns"]> = [];
    for (const tenant of localTenants) {
      const result = await runSeedCommand({
        ...options,
        allTenants: false,
        tenantId: tenant.tenantId,
        userId: tenant.userId ?? options.userId,
        role: tenant.role ?? options.role,
        permissions: tenant.permissions.length > 0 ? tenant.permissions : options.permissions,
      });
      tenantRuns.push({
        tenantId: tenant.tenantId,
        ...(tenant.label ? { label: tenant.label } : {}),
        ...(tenant.organizationName ? { organizationName: tenant.organizationName } : {}),
        ok: result.ok,
        ...(result.request ? { request: result.request } : {}),
        ...(result.response ? { response: result.response } : {}),
        diagnostics: result.diagnostics,
      });
    }
    const ok = tenantRuns.every((run) => run.ok);
    const tenantDiagnostics = tenantRuns.flatMap((run) => run.diagnostics);
    const aggregateDiagnostics = dedupeDiagnostics(ok
      ? tenantDiagnostics.filter((diagnostic) => diagnostic.severity !== "error")
      : tenantDiagnostics);
    return finishSeedResult(options, {
      ...base,
      ok,
      tenantRuns,
      diagnostics: aggregateDiagnostics,
      nextActions: ok
        ? ["refresh the app UI", "forge inspect ui --ergonomics --json"]
        : ["forge seed status --json", ...localTenants.map((tenant) =>
          options.subcommand === "reset" ? tenant.resetCommand : tenant.seedCommand
        )],
      exitCode: ok ? 0 : 1,
    });
  }

  const args = options.subcommand === "reset"
    ? { ...(typeof options.args === "object" && options.args !== null ? options.args as Record<string, unknown> : {}), reset: true }
    : options.args;
  const endpoint = `${runtimeUrl(options)}/commands/${encodeURIComponent(selected.name)}`;
  const request = {
    endpoint,
    args,
    auth: {
      userId: options.userId ?? DEFAULT_SEED_USER_ID,
      tenantId: options.tenantId ?? DEFAULT_SEED_TENANT_ID,
      role: options.role ?? "owner",
      permissions: defaultPermissions(options),
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: headers(options),
      body: JSON.stringify({ args }),
    });
    const body = await response.json().catch(async () => response.text().catch(() => null));
    const ok = response.ok;
    const readinessWarnings = readinessDiagnostics(base.readiness);
    return finishSeedResult(options, {
      ...base,
      ok,
      request,
      response: {
        status: response.status,
        ok: response.ok,
        body,
      },
      diagnostics: ok
        ? readinessWarnings
        : [
            createDiagnostic({
              severity: "error",
              code: "FORGE_SEED_FAILED",
              message: `Seed command '${selected.name}' failed with HTTP ${response.status}.`,
              fixHint: "Inspect the command response, policy denial, and dev server logs.",
              suggestedCommands: ["forge dev --once --json", "forge seed status --json"],
            }),
          ],
      nextActions: ok
        ? ["refresh the app UI", "forge inspect ui --ergonomics --json"]
        : ["forge dev --once --json", "forge seed status --json"],
      exitCode: ok ? 0 : 1,
    });
  } catch (error) {
    return finishSeedResult(options, {
      ...base,
      ok: false,
      request,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "FORGE_SEED_RUNTIME_UNREACHABLE",
          message: `Forge dev runtime is not reachable at ${runtimeUrl(options)}: ${error instanceof Error ? error.message : String(error)}`,
          fixHint: "Start the runtime with forge dev, or pass --url to an active Forge API server.",
          suggestedCommands: ["forge dev", "forge seed dev --json"],
        }),
      ],
      nextActions: ["forge dev", "forge seed dev --json"],
      exitCode: 1,
    });
  }
}

export function formatSeedJson(result: SeedCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatSeedHuman(result: SeedCommandResult): string {
  const lines = [
    result.ok ? `seed ${result.subcommand} ok` : `seed ${result.subcommand} failed`,
    `runtime: ${result.url}`,
  ];
  if (result.commands.length === 0) {
    lines.push("seed commands: none");
  } else {
    lines.push("seed commands:");
    for (const command of result.commands) {
      lines.push(`- ${command.selected ? "*" : " "} ${command.name} (${command.file})`);
    }
  }
  if (result.response) {
    lines.push(`response: HTTP ${result.response.status}`);
    lines.push(JSON.stringify(result.response.body, null, 2));
  }
  if (result.tenantRuns && result.tenantRuns.length > 0) {
    lines.push("tenant seed runs:");
    for (const run of result.tenantRuns) {
      lines.push(`- ${run.ok ? "ok" : "failed"} ${run.organizationName ?? run.label ?? run.tenantId}`);
      if (run.response) {
        lines.push(`  response: HTTP ${run.response.status}`);
      }
    }
  }
  for (const diagnostic of result.diagnostics) {
    lines.push(`${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
  }
  if (result.nextActions.length > 0) {
    lines.push("next:");
    for (const action of result.nextActions) {
      lines.push(`- ${action}`);
    }
  }
  lines.push(`seed readiness: ${result.readiness.ready ? "ready" : result.readiness.reason}`);
  if (result.readiness.autoSeedMode !== "none") {
    lines.push(
      result.readiness.autoSeedMode === "all-tenants"
        ? "dev script: auto-seeds all local tenants with forge dev --seed --all-tenants"
        : "dev script: auto-seeds with forge dev --seed",
    );
  }
  if (result.readiness.emptyWorkspaceRecovery.length > 0) {
    lines.push("empty workspace recovery:");
    for (const action of result.readiness.emptyWorkspaceRecovery) {
      lines.push(`- ${action}`);
    }
  }
  if (result.readiness.localTenants.length > 0) {
    lines.push("local tenant seed commands:");
    for (const tenant of result.readiness.localTenants) {
      lines.push(`- ${tenant.organizationName ?? tenant.label ?? tenant.tenantId}: ${tenant.seedCommand}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
