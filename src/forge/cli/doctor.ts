import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { run as runGenerate } from "../compiler/orchestrator/run.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { TableMapEntry } from "../compiler/data-graph/sql/serialize.ts";
import type { FrontendGraph } from "../compiler/types/frontend-graph.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import {
  DEFAULT_PGLITE_DIR,
  inspectPgliteStore,
  type PgliteStoreInspection,
} from "../runtime/db/pglite-adapter.ts";
import { normalizeForgeCliCommandsInValue } from "../workspace/forge-cli.ts";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  severity: "error" | "warning";
  message?: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
  exitCode: 0 | 1;
}

export interface PgliteDoctorResult {
  ok: boolean;
  inspection: PgliteStoreInspection;
  checks: DoctorCheck[];
  dbGuide: LocalDbModeGuide;
  nextActions: string[];
  exitCode: 0 | 1;
}

export interface LocalDbModeGuide {
  recommendedForCurrentState: "pglite" | "memory" | "stop-active-process" | "repair-pglite";
  memory: {
    command: string;
    useWhen: string[];
    tradeoff: string;
  };
  pglite: {
    command: string;
    useWhen: string[];
    tradeoff: string;
  };
  repair?: {
    command: string;
    safeWhen: string;
    preservesDataByArchiving: boolean;
  };
}

export interface RuntimeDoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
  dev: {
    pidFile: string;
    logFile: string;
    running: boolean;
    pid?: number;
  };
  pglite: PgliteStoreInspection;
  dbGuide: LocalDbModeGuide;
  nextActions: string[];
  exitCode: 0 | 1;
}

function present(workspaceRoot: string, name: string, relative: string): DoctorCheck {
  const ok = nodeFileSystem.exists(join(workspaceRoot, relative));
  return {
    name,
    ok,
    severity: "error",
    message: ok ? undefined : `missing ${relative}`,
  };
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  try {
    return JSON.parse(stripDeterministicHeader(nodeFileSystem.readText(absolute) ?? "")) as T;
  } catch {
    return null;
  }
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasUuidTenantColumns(tableMap: Record<string, TableMapEntry>): boolean {
  return Object.values(tableMap).some((entry) => {
    if (!entry.tenantScoped || !entry.tenantIdColumn) {
      return false;
    }
    return entry.columns.some(
      (column) => column.name === entry.tenantIdColumn && column.sqlType === "uuid",
    );
  });
}

function frontendDiagnosticChecks(frontendGraph: FrontendGraph | null): DoctorCheck[] {
  return (frontendGraph?.diagnostics ?? []).map((diagnostic, index) => ({
    name: `frontend-diagnostic-${index + 1}`,
    ok: false,
    severity: diagnostic.severity === "error" ? "error" : "warning",
    message: `${diagnostic.code}: ${diagnostic.fixHint ?? diagnostic.message}`,
  }));
}

function capabilityDiagnosticChecks(capabilityMap: { diagnostics?: Diagnostic[] } | null): DoctorCheck[] {
  return (capabilityMap?.diagnostics ?? []).map((diagnostic, index) => ({
    name: `capability-diagnostic-${index + 1}`,
    ok: false,
    severity: diagnostic.severity === "error" ? "error" as const : "warning" as const,
    message: `${diagnostic.code}: ${diagnostic.fixHint ?? diagnostic.message}`,
  }));
}

function frontendDevAuthChecks(
  frontendGraph: FrontendGraph | null,
  tableMap: Record<string, TableMapEntry>,
): DoctorCheck[] {
  if (!frontendGraph || !hasUuidTenantColumns(tableMap)) {
    return [];
  }
  return frontendGraph.providers
    .filter((provider) => provider.devAuthTenantId && !isUuidLike(provider.devAuthTenantId))
    .map((provider) => ({
      name: "frontend-dev-auth-tenant",
      ok: false,
      severity: "warning" as const,
      message: `${provider.file} devAuth tenantId '${provider.devAuthTenantId}' is not UUID-like, but tenant tables use uuid tenant ids`,
    }));
}

function buildLocalDbModeGuide(workspaceRoot: string, pglite: PgliteStoreInspection): LocalDbModeGuide {
  const memoryCommand = "forge dev --db memory --json";
  const pgliteCommand = "forge dev --db pglite --json";
  const repairCommand = "forge db repair --local --adapter pglite --json";
  const recommendedForCurrentState: LocalDbModeGuide["recommendedForCurrentState"] =
    pglite.state === "active"
      ? "stop-active-process"
      : pglite.state === "aborted" || pglite.state === "unhealthy"
        ? "repair-pglite"
        : pglite.openable
          ? "pglite"
          : "memory";
  return normalizeForgeCliCommandsInValue(workspaceRoot, {
    recommendedForCurrentState,
    memory: {
      command: memoryCommand,
      useWhen: [
        "you need a clean isolated smoke test",
        "PGlite is active, aborted, or suspected corrupt",
        "you do not need local data to persist after the process exits",
      ],
      tradeoff: "Fast and isolated, but data disappears when the dev process exits.",
    },
    pglite: {
      command: pgliteCommand,
      useWhen: [
        "you want local data to persist between dev runs",
        "you are reproducing real database behavior more closely than memory",
        "doctor pglite reports the store is missing or healthy",
      ],
      tradeoff: "Persists local state, but a stale/corrupt .forge/pglite store can require repair.",
    },
    ...(pglite.state === "aborted" || pglite.state === "unhealthy"
      ? {
          repair: {
            command: repairCommand,
            safeWhen: "PGlite is not owned by a live forge dev process and doctor reports aborted/unhealthy.",
            preservesDataByArchiving: true,
          },
        }
      : {}),
  }) as LocalDbModeGuide;
}

export async function runDoctorCommand(options: {
  workspaceRoot: string;
}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [
    present(options.workspaceRoot, "agents-md", "AGENTS.md"),
    present(options.workspaceRoot, "forge-lock", "forge.lock"),
    present(options.workspaceRoot, "agent-contract", `${GENERATED_DIR}/agentContract.json`),
    present(options.workspaceRoot, "capability-map", `${GENERATED_DIR}/capabilityMap.json`),
    present(options.workspaceRoot, "runtime-matrix", `${GENERATED_DIR}/runtimeMatrix.json`),
    present(options.workspaceRoot, "data-graph", `${GENERATED_DIR}/dataGraph.json`),
    present(options.workspaceRoot, "policies", `${GENERATED_DIR}/policyRegistry.json`),
    present(options.workspaceRoot, "secrets", `${GENERATED_DIR}/secretRegistry.json`),
    present(options.workspaceRoot, "client", `${GENERATED_DIR}/clientManifest.json`),
    present(options.workspaceRoot, "frontend", `${GENERATED_DIR}/frontendGraph.json`),
    present(options.workspaceRoot, "live-query", `${GENERATED_DIR}/liveQueryRegistry.json`),
  ];

  const generateCheck = await runGenerate({
    workspaceRoot: options.workspaceRoot,
    check: true,
    dryRun: false,
    json: false,
    concurrency: 4,
  });
  checks.push({
    name: "generated",
    ok: generateCheck.exitCode === 0,
    severity: "error",
    message:
      generateCheck.exitCode === 0
        ? undefined
        : "generated artifacts are stale; run forge generate",
  });

  const deployManifest = join(options.workspaceRoot, "deploy", "deployManifest.json");
  if (nodeFileSystem.exists(deployManifest)) {
    checks.push(
      present(options.workspaceRoot, "self-host-compose", "deploy/docker-compose.yml"),
      present(options.workspaceRoot, "self-host-env", "deploy/.env.example"),
    );
  }

  const webRoot = join(options.workspaceRoot, "web");
  if (nodeFileSystem.exists(webRoot)) {
    const frontendGraph = readGeneratedJson<FrontendGraph>(
      options.workspaceRoot,
      `${GENERATED_DIR}/frontendGraph.json`,
    );
    const dbJson = readGeneratedJson<{ tableMap: Record<string, TableMapEntry> }>(
      options.workspaceRoot,
      `${GENERATED_DIR}/db.json`,
    );
    checks.push({
      name: "frontend-root",
      ok: frontendGraph?.present === true,
      severity: "error",
      message: frontendGraph?.present === true ? undefined : "web/ exists but frontendGraph does not detect it",
    });
    checks.push({
      name: "frontend-bridge",
      ok: (frontendGraph?.bridgeFiles.length ?? 0) > 0,
      severity: "warning",
      message:
        (frontendGraph?.bridgeFiles.length ?? 0) > 0
          ? undefined
          : "missing web/lib/forge.ts bridge to generated client",
    });
    checks.push({
      name: "frontend-provider",
      ok: (frontendGraph?.providers.length ?? 0) > 0 || frontendGraph?.framework === "static",
      severity: "warning",
      message:
        (frontendGraph?.providers.length ?? 0) > 0 || frontendGraph?.framework === "static"
          ? undefined
          : "missing ForgeProvider in web app",
    });
    checks.push({
      name: "frontend-routes",
      ok: (frontendGraph?.routes.length ?? 0) > 0,
      severity: "warning",
      message:
        (frontendGraph?.routes.length ?? 0) > 0
          ? undefined
          : "no frontend routes detected in web/",
    });
    checks.push(...frontendDiagnosticChecks(frontendGraph));
    checks.push(...capabilityDiagnosticChecks(readGeneratedJson<{ diagnostics?: Diagnostic[] }>(
      options.workspaceRoot,
      `${GENERATED_DIR}/capabilityMap.json`,
    )));
    checks.push(...frontendDevAuthChecks(frontendGraph, dbJson?.tableMap ?? {}));
  }

  const ok = checks.every((check) => check.ok || check.severity === "warning");
  return {
    ok,
    checks,
    exitCode: ok ? 0 : 1,
  };
}

export async function runPgliteDoctorCommand(options: {
  workspaceRoot: string;
}): Promise<PgliteDoctorResult> {
  const dataDir = join(options.workspaceRoot, DEFAULT_PGLITE_DIR);
  const inspection = await inspectPgliteStore(dataDir);
  const ok = inspection.state === "missing" || inspection.state === "healthy";
  const checks: DoctorCheck[] = [
    {
      name: "pglite-store",
      ok,
      severity: inspection.state === "active" ? "warning" : "error",
      message: ok
        ? `PGlite store is ${inspection.state}`
        : inspection.error ?? `PGlite store is ${inspection.state}`,
    },
    {
      name: "pglite-openable",
      ok: inspection.openable,
      severity: inspection.state === "active" ? "warning" : "error",
      message: inspection.openable
        ? undefined
        : "local PGlite store cannot be opened by Forge dev",
    },
  ];

  if (inspection.lockFiles.length > 0) {
    checks.push({
      name: "pglite-lock-files",
      ok: inspection.state === "healthy",
      severity: inspection.state === "active" ? "warning" : "error",
      message: `lock files present: ${inspection.lockFiles.join(", ")}`,
    });
  }

  const exitOk = checks.every((check) => check.ok || check.severity === "warning");
  const dbGuide = buildLocalDbModeGuide(options.workspaceRoot, inspection);
  return normalizeForgeCliCommandsInValue(options.workspaceRoot, {
    ok: exitOk,
    inspection,
    checks,
    dbGuide,
    nextActions: inspection.nextActions,
    exitCode: exitOk ? 0 : 1,
  });
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function readPid(path: string): number | undefined {
  const text = nodeFileSystem.readText(path);
  if (text === null) return undefined;
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export async function runRuntimeDoctorCommand(options: {
  workspaceRoot: string;
}): Promise<RuntimeDoctorResult> {
  const checks: DoctorCheck[] = [];
  const generated = await runGenerate({
    workspaceRoot: options.workspaceRoot,
    check: true,
    dryRun: false,
    json: false,
    concurrency: 4,
  });
  checks.push({
    name: "generated",
    ok: generated.exitCode === 0,
    severity: "error",
    message: generated.exitCode === 0 ? "generated artifacts are fresh" : "generated artifacts are stale; run forge generate",
  });

  const devDir = join(options.workspaceRoot, ".forge", "dev");
  const pidFile = join(devDir, "dev.pid");
  const logFile = join(devDir, "dev.log");
  const pid = readPid(pidFile);
  const running = pid !== undefined && isProcessRunning(pid);
  checks.push({
    name: "dev-lifecycle",
    ok: true,
    severity: "warning",
    message: running
      ? `detached forge dev is running with pid ${pid}`
      : "no detached forge dev server is running",
  });

  const pglite = await inspectPgliteStore(join(options.workspaceRoot, DEFAULT_PGLITE_DIR));
  const pgliteOk = pglite.state === "missing" || pglite.state === "healthy" || pglite.state === "active";
  checks.push({
    name: "pglite-store",
    ok: pgliteOk,
    severity: pglite.state === "active" ? "warning" : "error",
    message: pglite.error ?? `PGlite store is ${pglite.state}`,
  });
  checks.push({
    name: "pglite-openable",
    ok: pglite.openable || pglite.state === "active",
    severity: pglite.state === "active" ? "warning" : "error",
    message: pglite.openable
      ? "PGlite store is openable"
      : pglite.state === "active"
        ? "PGlite store is owned by a live process"
        : "PGlite store cannot be opened",
  });

  const ok = checks.every((check) => check.ok || check.severity === "warning");
  const dbGuide = buildLocalDbModeGuide(options.workspaceRoot, pglite);
  const nextActions = ok
    ? ["forge dev --once --json", "forge dev status --json"]
    : [
        ...(generated.exitCode === 0 ? [] : ["forge generate"]),
        ...(pglite.state === "active"
          ? ["stop the running forge dev process that owns .forge/pglite", "forge doctor pglite --json"]
          : []),
        ...(pglite.state === "aborted" || pglite.state === "unhealthy"
          ? ["forge doctor pglite --json", "forge db repair --local --adapter pglite --json", "forge dev --db memory --json"]
          : []),
        ...(!pglite.openable && pglite.state !== "active" && pglite.state !== "aborted" && pglite.state !== "unhealthy"
          ? ["forge doctor pglite --json", "forge dev --db memory --json"]
          : []),
      ];
  return normalizeForgeCliCommandsInValue(options.workspaceRoot, {
    ok,
    checks,
    dev: {
      pidFile,
      logFile,
      running,
      ...(pid !== undefined ? { pid } : {}),
    },
    pglite,
    dbGuide,
    nextActions: [...new Set(nextActions)],
    exitCode: ok ? 0 : 1,
  });
}

export function formatDoctorJson(result: DoctorResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatDoctorHuman(result: DoctorResult): string {
  const lines = ["Forge Doctor", ""];
  for (const check of result.checks) {
    const marker = check.ok ? "OK" : check.severity === "warning" ? "WARN" : "FAIL";
    lines.push(`${marker} ${check.name}${check.message ? ` - ${check.message}` : ""}`);
  }
  lines.push("");
  lines.push(result.ok ? "Project is coherent." : "Project needs attention.");
  return `${lines.join("\n")}\n`;
}

export function formatPgliteDoctorJson(result: PgliteDoctorResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatPgliteDoctorHuman(result: PgliteDoctorResult): string {
  const lines = ["Forge PGlite Doctor", ""];
  for (const check of result.checks) {
    const marker = check.ok ? "OK" : check.severity === "warning" ? "WARN" : "FAIL";
    lines.push(`${marker} ${check.name}${check.message ? ` - ${check.message}` : ""}`);
  }
  lines.push("");
  lines.push(`Store: ${result.inspection.dataDir}`);
  lines.push(`State: ${result.inspection.state}`);
  lines.push(`Recommended DB mode: ${result.dbGuide.recommendedForCurrentState}`);
  lines.push(`Memory: ${result.dbGuide.memory.command} - ${result.dbGuide.memory.tradeoff}`);
  lines.push(`PGlite: ${result.dbGuide.pglite.command} - ${result.dbGuide.pglite.tradeoff}`);
  if (result.dbGuide.repair) {
    lines.push(`Repair: ${result.dbGuide.repair.command}`);
  }
  if (result.nextActions.length > 0) {
    lines.push("");
    lines.push("Next actions:");
    for (const action of result.nextActions) {
      lines.push(`  ${action}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function formatRuntimeDoctorJson(result: RuntimeDoctorResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatRuntimeDoctorHuman(result: RuntimeDoctorResult): string {
  const lines = ["Forge Runtime Doctor", ""];
  for (const check of result.checks) {
    const marker = check.ok ? "OK" : check.severity === "warning" ? "WARN" : "FAIL";
    lines.push(`${marker} ${check.name}${check.message ? ` - ${check.message}` : ""}`);
  }
  lines.push("");
  lines.push(`Dev pid file: ${result.dev.pidFile}`);
  lines.push(`Dev log file: ${result.dev.logFile}`);
  lines.push(`PGlite state: ${result.pglite.state}`);
  lines.push(`Recommended DB mode: ${result.dbGuide.recommendedForCurrentState}`);
  lines.push(`Memory: ${result.dbGuide.memory.command} - ${result.dbGuide.memory.tradeoff}`);
  lines.push(`PGlite: ${result.dbGuide.pglite.command} - ${result.dbGuide.pglite.tradeoff}`);
  if (result.dbGuide.repair) {
    lines.push(`Repair: ${result.dbGuide.repair.command}`);
  }
  if (result.nextActions.length > 0) {
    lines.push("");
    lines.push("Next actions:");
    for (const action of result.nextActions) {
      lines.push(`  ${action}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
