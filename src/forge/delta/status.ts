import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { normalizePath } from "../compiler/primitives/paths.ts";
import {
  DeltaStore,
  DeltaStoreBusyError,
  describeDeltaStoreBusy,
  getDeltaStorePath,
  probeDeltaStoreBusy,
  summarizeDeltaStoreBusy,
  type DeltaStatus,
  type DeltaStatusDetails,
  type DeltaStoreBusyInfo,
} from "./store.ts";
import { DELTA_SCHEMA_VERSION } from "./schema.ts";
import { redactDeltaPayload } from "./redaction.ts";
import { normalizeForgeCliCommandsInValue } from "../workspace/forge-cli.ts";

export type DeltaStatusResult =
  | (DeltaStatus & { details?: DeltaStatusDetails; exitCode: 0 })
  | {
      ok: false;
      recording: false;
      store: string;
      busy?: DeltaStoreBusyInfo;
      diagnostics: ReturnType<typeof createDiagnostic>[];
      nextActions: string[];
      exitCode: 1;
    };

export interface DeltaStatusOptions {
  verbose?: boolean;
}

export interface DeltaRepairOptions {
  workspaceRoot: string;
  dryRun: boolean;
  yes: boolean;
}

export interface DeltaRepairResult {
  ok: boolean;
  applied: boolean;
  needsConfirmation: boolean;
  store: string;
  backupPath?: string;
  busy?: DeltaStoreBusyInfo;
  actions: Array<{ kind: "backup" | "remove" | "initialize" | "restore"; from?: string; to?: string; skipped?: boolean }>;
  diagnostics: ReturnType<typeof createDiagnostic>[];
  nextActions: string[];
  exitCode: 0 | 1;
}

export interface DeltaCompactOptions {
  workspaceRoot: string;
  dryRun?: boolean;
}

export interface DeltaPruneOptions {
  workspaceRoot: string;
  olderThan?: string;
  dryRun?: boolean;
  yes?: boolean;
}

export interface DeltaExportOptions {
  workspaceRoot: string;
  redacted?: boolean;
  output?: string;
  limit?: number;
}

export interface DeltaMaintenanceFileResult {
  path: string;
  exists: boolean;
  beforeBytes: number;
  afterBytes: number;
  linesBefore: number;
  linesAfter: number;
}

export interface DeltaCompactResult {
  ok: boolean;
  subcommand: "compact";
  applied: boolean;
  dryRun: boolean;
  files: DeltaMaintenanceFileResult[];
  diagnostics: ReturnType<typeof createDiagnostic>[];
  nextActions: string[];
  exitCode: 0 | 1;
}

export interface DeltaPruneResult {
  ok: boolean;
  subcommand: "prune";
  applied: boolean;
  needsConfirmation: boolean;
  olderThan?: string;
  cutoff?: string;
  files: Array<DeltaMaintenanceFileResult & { prunedLines: number }>;
  diagnostics: ReturnType<typeof createDiagnostic>[];
  nextActions: string[];
  exitCode: 0 | 1;
}

export interface DeltaExportResult {
  ok: boolean;
  subcommand: "export";
  redacted: boolean;
  output?: string;
  written: boolean;
  data?: Record<string, unknown>;
  busy?: DeltaStoreBusyInfo;
  diagnostics: ReturnType<typeof createDiagnostic>[];
  nextActions: string[];
  exitCode: 0 | 1;
}

export interface DeltaDoctorCheck {
  name: string;
  ok: boolean;
  severity: "error" | "warning";
  message: string;
  evidence?: Record<string, unknown>;
  suggestedCommands?: string[];
}

export interface DeltaDoctorResult {
  ok: boolean;
  checks: DeltaDoctorCheck[];
  status?: DeltaStatusResult;
  nextActions: string[];
  exitCode: 0 | 1;
}

function normalizeDeltaCliCommandHints<T>(workspaceRoot: string, result: T): T {
  if (!result || typeof result !== "object") {
    return result;
  }
  const value = result as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...value };
  for (const key of ["nextActions", "diagnostics", "checks"]) {
    if (key in normalized) {
      normalized[key] = normalizeForgeCliCommandsInValue(workspaceRoot, normalized[key], key);
    }
  }
  if ("status" in normalized) {
    normalized.status = normalizeDeltaCliCommandHints(workspaceRoot, normalized.status);
  }
  return normalized as T;
}

async function openDeltaStoreForStatus(
  workspaceRoot: string,
): Promise<{ store: DeltaStore | null; openError?: unknown }> {
  let openError: unknown;
  let cleanedOrphanedPgliteLock = false;
  const preflightBusy = probeDeltaStoreBusy(workspaceRoot);
  if (preflightBusy) {
    const busyInfo = describeDeltaStoreBusy(preflightBusy, workspaceRoot);
    if (busyInfo.relativeLockPath.endsWith("postmaster.pid") && busyInfo.processAlive === false) {
      rmSync(busyInfo.lockPath, { force: true });
      cleanedOrphanedPgliteLock = true;
    }
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    openError = undefined;
    const store = await DeltaStore.open(workspaceRoot, { access: "read" }).catch((error: unknown) => {
      openError = error;
      return null;
    });
    if (store) {
      return { store };
    }

    if (!(openError instanceof DeltaStoreBusyError)) {
      break;
    }
    const busyInfo = describeDeltaStoreBusy(openError, workspaceRoot);
    const orphanedPgliteLock =
      busyInfo.relativeLockPath.endsWith("postmaster.pid") &&
      busyInfo.processAlive === false;
    if (orphanedPgliteLock && !cleanedOrphanedPgliteLock && attempt >= 2) {
      rmSync(busyInfo.lockPath, { force: true });
      cleanedOrphanedPgliteLock = true;
      await sleep(100);
      continue;
    }
    const transientPgliteLock =
      orphanedPgliteLock &&
      typeof busyInfo.ageMs === "number" &&
      busyInfo.ageMs < 2_000;
    if (!transientPgliteLock) {
      break;
    }
    await sleep(150 * (attempt + 1));
  }
  return { store: null, openError };
}

function pgliteStatusDetails(workspaceRoot: string, storePath: string): DeltaStatusDetails {
  const lockPath = join(workspaceRoot, ".forge", "delta", "delta.lock");
  const postmasterPath = join(workspaceRoot, ".forge", "delta", "delta.db", "postmaster.pid");
  return {
    schema: {
      expectedVersion: DELTA_SCHEMA_VERSION,
    },
    paths: {
      store: storePath,
      lock: normalizePath(relative(workspaceRoot, lockPath)),
      postmaster: normalizePath(relative(workspaceRoot, postmasterPath)),
    },
    locks: {
      forgeLockPresent: existsSync(lockPath),
      postmasterPresent: existsSync(postmasterPath),
    },
    counts: {
      sessions: 0,
      operations: 0,
      fileChanges: 0,
      commandRuns: 0,
      runtimeCalls: 0,
      proofs: 0,
      artifacts: 0,
      workSessions: 0,
      agentMemoryEvents: 0,
      semanticEvents: 0,
    },
    operational: {
      storeExists: existsSync(join(workspaceRoot, storePath)),
      queuePath: ".forge/agent/events.ndjson",
      queueExists: existsSync(join(workspaceRoot, ".forge", "agent", "events.ndjson")),
      queueSizeBytes: existsSync(join(workspaceRoot, ".forge", "agent", "events.ndjson"))
        ? statSync(join(workspaceRoot, ".forge", "agent", "events.ndjson")).size
        : 0,
      queuePendingEvents: 0,
      queueRedaction: "unknown",
      queueHistoryPath: ".forge/agent/events.ndjson.history",
      queueHistoryExists: existsSync(join(workspaceRoot, ".forge", "agent", "events.ndjson.history")),
      queueHistorySizeBytes: existsSync(join(workspaceRoot, ".forge", "agent", "events.ndjson.history"))
        ? statSync(join(workspaceRoot, ".forge", "agent", "events.ndjson.history")).size
        : 0,
      queueHistoryLines: 0,
      estimatedOverhead: "low",
    },
    health: {
      status: "ok",
      checks: [
        { name: "schema", status: "ok", message: `schema expected ${DELTA_SCHEMA_VERSION}` },
        { name: "locks", status: "ok", message: "PGlite postmaster indicates an active local runtime" },
        { name: "queue-redaction", status: "ok", message: "queue redaction is checked by the active writer" },
      ],
    },
  };
}

function pgliteActiveStatus(workspaceRoot: string, storePath: string, options: DeltaStatusOptions = {}): DeltaStatusResult | null {
  const postmasterPath = join(workspaceRoot, ".forge", "delta", "delta.db", "postmaster.pid");
  const forgeLockPath = join(workspaceRoot, ".forge", "delta", "delta.lock");
  if (!existsSync(postmasterPath) || existsSync(forgeLockPath)) {
    return null;
  }
  return {
    ok: true,
    recording: true,
    store: storePath,
    external: {
      kind: "pglite-active",
      reason: "DeltaDB is open in another local Forge/PGlite process; status is treated as active for Studio observer flows.",
    },
    recentOperations: [],
    ...(options.verbose ? { details: pgliteStatusDetails(workspaceRoot, storePath) } : {}),
    exitCode: 0,
  };
}

async function runDeltaStatusRaw(workspaceRoot: string, options: DeltaStatusOptions = {}): Promise<DeltaStatusResult> {
  const storePath = normalizePath(relative(workspaceRoot, getDeltaStorePath(workspaceRoot)));
  const { store, openError } = await openDeltaStoreForStatus(workspaceRoot);
  if (!store) {
    const errorMessage = openError instanceof Error ? openError.message : "unknown open error";
    const busyError = openError instanceof DeltaStoreBusyError ? openError : undefined;
    const busy = Boolean(busyError);
    const busyInfo = busyError ? describeDeltaStoreBusy(busyError, workspaceRoot) : undefined;
    if (
      busyInfo?.relativeLockPath.endsWith("postmaster.pid") &&
      busyInfo.processAlive === false &&
      !existsSync(join(workspaceRoot, ".forge", "delta", "delta.lock"))
    ) {
      return pgliteActiveStatus(workspaceRoot, storePath, options) ?? {
        ok: true,
        recording: true,
        store: storePath,
        external: {
          kind: "pglite-active",
          reason: "DeltaDB is open in another local Forge/PGlite process; status is treated as active for Studio observer flows.",
        },
        recentOperations: [],
        ...(options.verbose ? { details: pgliteStatusDetails(workspaceRoot, storePath) } : {}),
        exitCode: 0,
      };
    }
    const activePglite = pgliteActiveStatus(workspaceRoot, storePath, options);
    if (activePglite) {
      return activePglite;
    }
    const busySummary = busyInfo ? summarizeDeltaStoreBusy(busyInfo) : undefined;
    return {
      ok: false,
      recording: false,
      store: storePath,
      ...(busyInfo ? { busy: busyInfo } : {}),
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: busy ? "FORGE_DELTA_BUSY" : "FORGE_DELTA_STORE_UNAVAILABLE",
          message: busy
            ? `Forge Delta local store is busy: ${errorMessage}${busySummary ? ` (${busySummary})` : ""}`
            : `Forge Delta local store is unavailable: ${errorMessage}`,
          file: storePath,
          fixHint: busy
            ? busyInfo?.processAlive
              ? `Wait for pid ${busyInfo.pid ?? "shown in the lock file"} to finish, then retry.`
              : `If no Forge/agent process is still running, inspect ${busyInfo?.relativeLockPath ?? ".forge/delta/delta.lock"} and retry.`
            : "Close running Forge/agent processes. If the store remains unavailable, back it up and let ForgeOS recreate local Delta memory.",
          suggestedCommands: [
            "forge delta status --json",
            "forge agent timeline --json",
            "forge delta repair --dry-run --json",
            "forge delta repair --yes --json",
          ],
        }),
      ],
      nextActions: [
        busy
          ? busyInfo?.processAlive
            ? `Wait for pid ${busyInfo.pid ?? "shown in .forge/delta/delta.lock"} to release ${busyInfo.relativeLockPath}`
            : `Inspect ${busyInfo?.relativeLockPath ?? ".forge/delta/delta.lock"}; it may belong to an exited process`
          : "Close any running forge dev or external agent process using .forge/delta/delta.db",
        "forge agent timeline --json",
        "forge delta repair --dry-run --json",
        "forge delta repair --yes --json",
        "forge delta status --json",
      ],
      exitCode: 1,
    };
  }
  try {
    const status = await store.status();
    return {
      ...status,
      ...(options.verbose ? { details: await store.statusDetails() } : {}),
      exitCode: 0,
    };
  } finally {
    await store.close();
  }
}

export async function runDeltaStatus(workspaceRoot: string, options: DeltaStatusOptions = {}): Promise<DeltaStatusResult> {
  return normalizeDeltaCliCommandHints(workspaceRoot, await runDeltaStatusRaw(workspaceRoot, options));
}

function timestampForPath(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function deltaBackupPath(workspaceRoot: string, storePath: string): string {
  return join(workspaceRoot, ".forge", "delta", "backups", `${basename(storePath)}.${timestampForPath()}`);
}

async function runDeltaRepairRaw(options: DeltaRepairOptions): Promise<DeltaRepairResult> {
  const absoluteStorePath = getDeltaStorePath(options.workspaceRoot);
  const store = normalizePath(relative(options.workspaceRoot, absoluteStorePath));
  const backupAbsolute = deltaBackupPath(options.workspaceRoot, absoluteStorePath);
  const backupPath = normalizePath(relative(options.workspaceRoot, backupAbsolute));
  const storeExists = existsSync(absoluteStorePath);
  const actions: DeltaRepairResult["actions"] = [
    ...(storeExists ? [{ kind: "backup" as const, from: store, to: backupPath }] : [{ kind: "backup" as const, from: store, to: backupPath, skipped: true }]),
    { kind: "initialize", to: store },
  ];

  if (options.dryRun || !options.yes) {
    return {
      ok: true,
      applied: false,
      needsConfirmation: !options.yes,
      store,
      ...(storeExists ? { backupPath } : {}),
      actions,
      diagnostics: [],
      nextActions: [
        "forge delta repair --yes --json",
        "forge delta status --json",
      ],
      exitCode: 0,
    };
  }

  const busy = probeDeltaStoreBusy(options.workspaceRoot);
  if (busy) {
    const busyInfo = describeDeltaStoreBusy(busy, options.workspaceRoot);
    const busySummary = summarizeDeltaStoreBusy(busyInfo);
    return {
      ok: false,
      applied: false,
      needsConfirmation: false,
      store,
      ...(storeExists ? { backupPath } : {}),
      busy: busyInfo,
      actions,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "FORGE_DELTA_BUSY",
          message: `Forge Delta repair cannot run while the local store is busy: ${busy.message} (${busySummary})`,
          file: store,
          fixHint: busyInfo.processAlive
            ? `Wait for pid ${busyInfo.pid ?? "shown in the lock file"} to finish before repairing local Delta memory.`
            : `If no Forge/agent process is still running, inspect ${busyInfo.relativeLockPath} before repairing local Delta memory.`,
          suggestedCommands: [
            "forge delta status --json",
            "forge agent timeline --json",
            "forge delta repair --dry-run --json",
          ],
        }),
      ],
      nextActions: [
        busyInfo.processAlive
          ? `Wait for pid ${busyInfo.pid ?? "shown in .forge/delta/delta.lock"} to release ${busyInfo.relativeLockPath}`
          : `Inspect ${busyInfo.relativeLockPath}; it may belong to an exited process`,
        "forge agent timeline --json",
        "forge delta status --json",
        "forge delta repair --dry-run --json",
      ],
      exitCode: 1,
    };
  }

  let moved = false;
  try {
    if (storeExists) {
      mkdirSync(dirname(backupAbsolute), { recursive: true });
      renameSync(absoluteStorePath, backupAbsolute);
      moved = true;
    }

    const fresh = await DeltaStore.open(options.workspaceRoot, { access: "write" });
    await fresh.close();

    return {
      ok: true,
      applied: true,
      needsConfirmation: false,
      store,
      ...(moved ? { backupPath } : {}),
      actions,
      diagnostics: [],
      nextActions: [
        "forge delta status --json",
        "forge agent hooks smoke --target codex --json",
        "forge agent doctor --target codex --json",
      ],
      exitCode: 0,
    };
  } catch (error) {
    const diagnostics = [
      createDiagnostic({
        severity: "error",
        code: "FORGE_DELTA_REPAIR_FAILED",
        message: error instanceof Error ? error.message : "Forge Delta repair failed",
        file: store,
      }),
    ];
    if (moved) {
      try {
        rmSync(absoluteStorePath, { recursive: true, force: true });
        renameSync(backupAbsolute, absoluteStorePath);
        actions.push({ kind: "restore", from: backupPath, to: store });
      } catch (restoreError) {
        diagnostics.push(createDiagnostic({
          severity: "error",
          code: "FORGE_DELTA_REPAIR_RESTORE_FAILED",
          message: restoreError instanceof Error ? restoreError.message : "failed to restore Delta backup after repair failure",
          file: backupPath,
        }));
      }
    }
    return {
      ok: false,
      applied: false,
      needsConfirmation: false,
      store,
      ...(moved ? { backupPath } : {}),
      actions,
      diagnostics,
      nextActions: [
        "Close any running forge dev or external agent process using .forge/delta/delta.db",
        "forge delta repair --dry-run --json",
      ],
      exitCode: 1,
    };
  }
}

export async function runDeltaRepair(options: DeltaRepairOptions): Promise<DeltaRepairResult> {
  return normalizeDeltaCliCommandHints(options.workspaceRoot, await runDeltaRepairRaw(options));
}

async function runDeltaDoctorRaw(workspaceRoot: string): Promise<DeltaDoctorResult> {
  const status = await runDeltaStatus(workspaceRoot, { verbose: true });
  const details = status.exitCode === 0 ? status.details : undefined;
  const checks: DeltaDoctorCheck[] = [
    {
      name: "delta-status",
      ok: status.exitCode === 0,
      severity: "error",
      message: status.exitCode === 0 ? "DeltaDB status is readable" : "DeltaDB status is unavailable",
      evidence: { store: status.store },
      suggestedCommands: status.exitCode === 0 ? undefined : status.nextActions,
    },
  ];

  const busy = probeDeltaStoreBusy(workspaceRoot);
  if (busy) {
    const busyInfo = describeDeltaStoreBusy(busy, workspaceRoot);
    checks.push({
      name: "delta-writable",
      ok: false,
      severity: "warning",
      message: busyInfo.processAlive
        ? `Delta writer lock is held by pid ${busyInfo.pid ?? "unknown"}`
        : `Delta writer lock is present at ${busyInfo.relativeLockPath}`,
      evidence: { busy: busyInfo },
      suggestedCommands: ["forge delta status --verbose --json"],
    });
  } else {
    let writer: DeltaStore | null = null;
    try {
      writer = await DeltaStore.open(workspaceRoot, { access: "write" });
      checks.push({
        name: "delta-writable",
        ok: true,
        severity: "error",
        message: "DeltaDB writer lock can be acquired",
      });
    } catch (error) {
      if (error instanceof DeltaStoreBusyError) {
        const busyInfo = describeDeltaStoreBusy(error, workspaceRoot);
        checks.push({
          name: "delta-writable",
          ok: false,
          severity: "warning",
          message: busyInfo.relativeLockPath.endsWith("postmaster.pid")
            ? "Delta writer is currently held by an active local PGlite runtime"
            : busyInfo.processAlive
              ? `Delta writer lock is held by pid ${busyInfo.pid ?? "unknown"}`
              : `Delta writer lock is present at ${busyInfo.relativeLockPath}`,
          evidence: { busy: busyInfo },
          suggestedCommands: ["forge delta status --verbose --json"],
        });
      } else {
        checks.push({
          name: "delta-writable",
          ok: false,
          severity: "error",
          message: error instanceof Error ? error.message : "DeltaDB writer lock cannot be acquired",
          suggestedCommands: ["forge delta repair --dry-run --json"],
        });
      }
    } finally {
      await writer?.close().catch(() => undefined);
    }
  }

  const schemaOk = !details?.schema.storedVersion || details.schema.storedVersion === details.schema.expectedVersion;
  checks.push({
    name: "schema-current",
    ok: Boolean(details) && schemaOk,
    severity: "error",
    message: details
      ? `schema ${details.schema.storedVersion ?? "not initialized"}; expected ${details.schema.expectedVersion}`
      : "schema details unavailable",
    evidence: details?.schema,
    suggestedCommands: schemaOk ? undefined : ["forge delta repair --dry-run --json"],
  });

  const pendingEvents = details?.operational.queuePendingEvents ?? 0;
  checks.push({
    name: "queue-drain",
    ok: Boolean(details) && pendingEvents === 0,
    severity: "warning",
    message: details
      ? pendingEvents === 0
        ? "agent queue has no pending events"
        : `agent queue has ${pendingEvents} pending event${pendingEvents === 1 ? "" : "s"}`
      : "queue details unavailable",
    evidence: details
      ? {
          queuePath: details.operational.queuePath,
          pendingEvents,
          queueSizeBytes: details.operational.queueSizeBytes,
        }
      : undefined,
    suggestedCommands: pendingEvents > 0 ? ["forge agent ingest codex --file .forge/agent/events.ndjson --json"] : undefined,
  });

  const redaction = details?.operational.queueRedaction ?? "unknown";
  checks.push({
    name: "queue-redaction",
    ok: redaction === "none" || redaction === "redacted",
    severity: "warning",
    message: redaction === "none"
      ? "agent queue is empty or absent"
      : redaction === "redacted"
        ? "agent queue contains redacted payloads"
        : `agent queue redaction status is ${redaction}`,
    evidence: details
      ? {
          queuePath: details.operational.queuePath,
          queueRedaction: redaction,
          queueHistoryPath: details.operational.queueHistoryPath,
          queueHistoryLines: details.operational.queueHistoryLines,
          lastCompactionAt: details.operational.lastCompactionAt,
        }
      : undefined,
    suggestedCommands: redaction === "legacy-raw-present" || redaction === "mixed"
      ? ["forge agent ingest codex --file .forge/agent/events.ndjson --json", "forge delta compact --json"]
      : undefined,
  });

  const gitignore = readGitignore(workspaceRoot);
  const requiredGitignore = [
    ".codex/",
    ".forge/delta/",
    ".forge/agent/",
    ".forge/agent/*.ndjson",
    ".forge/agent/*.history",
    ".forge/last-run.json",
    ".forge/runtime-cache/",
    ".forge/studio",
  ];
  const missingGitignore = requiredGitignore.filter((entry) => !gitignore.includes(entry));
  checks.push({
    name: "gitignore-operational-state",
    ok: missingGitignore.length === 0,
    severity: "warning",
    message: missingGitignore.length === 0
      ? "local Delta, agent queue, and Studio state are ignored"
      : `missing gitignore coverage: ${missingGitignore.join(", ")}`,
    evidence: { required: requiredGitignore, missing: missingGitignore },
  });

  const ok = checks.every((check) => check.ok || check.severity === "warning");
  return {
    ok,
    checks,
    status,
    nextActions: uniqueDeltaDoctorNextActions(checks),
    exitCode: ok ? 0 : 1,
  };
}

export async function runDeltaDoctor(workspaceRoot: string): Promise<DeltaDoctorResult> {
  return normalizeDeltaCliCommandHints(workspaceRoot, await runDeltaDoctorRaw(workspaceRoot));
}

function readGitignore(workspaceRoot: string): string {
  try {
    return readFileSync(join(workspaceRoot, ".gitignore"), "utf8");
  } catch {
    return "";
  }
}

function uniqueDeltaDoctorNextActions(checks: DeltaDoctorCheck[]): string[] {
  const actions = checks.flatMap((check) => check.suggestedCommands ?? []);
  return [...new Set(actions.length > 0 ? actions : ["forge delta status --verbose --json"])];
}

function agentQueueHistoryPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".forge", "agent", "events.ndjson.history");
}

function lineTimestamp(line: string): string | undefined {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    for (const key of ["enqueuedAt", "capturedAt", "timestamp"]) {
      if (typeof parsed[key] === "string") {
        return parsed[key] as string;
      }
    }
    const payload = parsed.payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const event = (payload as Record<string, unknown>).event;
      if (event && typeof event === "object" && !Array.isArray(event) && typeof (event as Record<string, unknown>).timestamp === "string") {
        return (event as Record<string, string>).timestamp;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function redactedJsonLine(line: string): string | undefined {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    return JSON.stringify(redactDeltaPayload(parsed).value);
  } catch {
    return undefined;
  }
}

function compactLines(text: string, maxBytes = 256_000): { text: string; linesBefore: number; linesAfter: number } {
  const redactedLines = text
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map(redactedJsonLine)
    .filter((line): line is string => typeof line === "string");
  const kept: string[] = [];
  let bytes = 0;
  for (const line of [...redactedLines].reverse()) {
    const lineBytes = Buffer.byteLength(`${line}\n`);
    if (kept.length > 0 && bytes + lineBytes > maxBytes) {
      break;
    }
    kept.push(line);
    bytes += lineBytes;
  }
  const lines = kept.reverse();
  return {
    text: lines.length > 0 ? `${lines.join("\n")}\n` : "",
    linesBefore: redactedLines.length,
    linesAfter: lines.length,
  };
}

async function runDeltaCompactRaw(options: DeltaCompactOptions): Promise<DeltaCompactResult> {
  const historyPath = agentQueueHistoryPath(options.workspaceRoot);
  const relativeHistoryPath = normalizePath(relative(options.workspaceRoot, historyPath));
  if (!existsSync(historyPath)) {
    return {
      ok: true,
      subcommand: "compact",
      applied: false,
      dryRun: Boolean(options.dryRun),
      files: [{
        path: relativeHistoryPath,
        exists: false,
        beforeBytes: 0,
        afterBytes: 0,
        linesBefore: 0,
        linesAfter: 0,
      }],
      diagnostics: [],
      nextActions: ["forge delta status --verbose --json"],
      exitCode: 0,
    };
  }
  const before = readFileSync(historyPath, "utf8");
  const compacted = compactLines(before);
  const beforeBytes = Buffer.byteLength(before);
  const afterBytes = Buffer.byteLength(compacted.text);
  if (!options.dryRun && compacted.text !== before) {
    writeFileSync(historyPath, compacted.text, "utf8");
  }
  return {
    ok: true,
    subcommand: "compact",
    applied: !options.dryRun && compacted.text !== before,
    dryRun: Boolean(options.dryRun),
    files: [{
      path: relativeHistoryPath,
      exists: true,
      beforeBytes,
      afterBytes,
      linesBefore: compacted.linesBefore,
      linesAfter: compacted.linesAfter,
    }],
    diagnostics: [],
    nextActions: ["forge delta status --verbose --json"],
    exitCode: 0,
  };
}

export async function runDeltaCompact(options: DeltaCompactOptions): Promise<DeltaCompactResult> {
  return normalizeDeltaCliCommandHints(options.workspaceRoot, await runDeltaCompactRaw(options));
}

function parseOlderThan(value: string | undefined): { cutoff?: Date; error?: string } {
  if (!value) {
    return { error: "forge delta prune requires --older-than <duration>, for example 30d" };
  }
  const match = value.match(/^(\d+)(m|h|d|w)$/u);
  if (!match) {
    return { error: "--older-than supports minutes, hours, days, or weeks, for example 30d" };
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : unit === "d" ? 86_400_000 : 604_800_000;
  return { cutoff: new Date(Date.now() - amount * multiplier) };
}

async function runDeltaPruneRaw(options: DeltaPruneOptions): Promise<DeltaPruneResult> {
  const parsed = parseOlderThan(options.olderThan);
  if (!parsed.cutoff) {
    return {
      ok: false,
      subcommand: "prune",
      applied: false,
      needsConfirmation: false,
      olderThan: options.olderThan,
      files: [],
      diagnostics: [createDiagnostic({
        severity: "error",
        code: "FORGE_DELTA_PRUNE_USAGE",
        message: parsed.error ?? "invalid prune duration",
        suggestedCommands: ["forge delta prune --older-than 30d --dry-run --json"],
      })],
      nextActions: ["forge delta prune --older-than 30d --dry-run --json"],
      exitCode: 1,
    };
  }
  const cutoffIso = parsed.cutoff.toISOString();
  const historyPath = agentQueueHistoryPath(options.workspaceRoot);
  const relativeHistoryPath = normalizePath(relative(options.workspaceRoot, historyPath));
  if (!existsSync(historyPath)) {
    return {
      ok: true,
      subcommand: "prune",
      applied: false,
      needsConfirmation: false,
      olderThan: options.olderThan,
      cutoff: cutoffIso,
      files: [{
        path: relativeHistoryPath,
        exists: false,
        beforeBytes: 0,
        afterBytes: 0,
        linesBefore: 0,
        linesAfter: 0,
        prunedLines: 0,
      }],
      diagnostics: [],
      nextActions: ["forge delta status --verbose --json"],
      exitCode: 0,
    };
  }
  const before = readFileSync(historyPath, "utf8");
  const lines = before.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const kept = lines.filter((line) => {
    const timestamp = lineTimestamp(line);
    return !timestamp || Date.parse(timestamp) >= parsed.cutoff!.getTime();
  });
  const nextText = kept.length > 0 ? `${kept.join("\n")}\n` : "";
  const needsConfirmation = !options.dryRun && !options.yes && kept.length !== lines.length;
  if (!options.dryRun && !needsConfirmation && nextText !== before) {
    writeFileSync(historyPath, nextText, "utf8");
  }
  return {
    ok: true,
    subcommand: "prune",
    applied: !options.dryRun && !needsConfirmation && nextText !== before,
    needsConfirmation,
    olderThan: options.olderThan,
    cutoff: cutoffIso,
    files: [{
      path: relativeHistoryPath,
      exists: true,
      beforeBytes: Buffer.byteLength(before),
      afterBytes: Buffer.byteLength(nextText),
      linesBefore: lines.length,
      linesAfter: kept.length,
      prunedLines: lines.length - kept.length,
    }],
    diagnostics: [],
    nextActions: needsConfirmation
      ? [`forge delta prune --older-than ${options.olderThan} --yes --json`, "forge delta status --verbose --json"]
      : ["forge delta status --verbose --json"],
    exitCode: 0,
  };
}

export async function runDeltaPrune(options: DeltaPruneOptions): Promise<DeltaPruneResult> {
  return normalizeDeltaCliCommandHints(options.workspaceRoot, await runDeltaPruneRaw(options));
}

function resolveExportPath(workspaceRoot: string, output: string): string {
  const absolute = resolve(workspaceRoot, output);
  const rel = relative(resolve(workspaceRoot), absolute);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    throw new Error(`refusing to write Delta export outside workspace: ${output}`);
  }
  return absolute;
}

async function runDeltaExportRaw(options: DeltaExportOptions): Promise<DeltaExportResult> {
  if (!options.redacted) {
    return {
      ok: false,
      subcommand: "export",
      redacted: false,
      written: false,
      diagnostics: [createDiagnostic({
        severity: "error",
        code: "FORGE_DELTA_EXPORT_REDACTED_REQUIRED",
        message: "Delta export only supports redacted output; pass --redacted.",
        suggestedCommands: ["forge delta export --redacted --json"],
      })],
      nextActions: ["forge delta export --redacted --json"],
      exitCode: 1,
    };
  }
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 100), 500));
  const store: DeltaStore | DeltaStoreBusyError | Error = await DeltaStore.open(options.workspaceRoot, { access: "read" }).catch((error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
  );
  if (store instanceof DeltaStoreBusyError) {
    const busy = describeDeltaStoreBusy(store, options.workspaceRoot);
    return {
      ok: false,
      subcommand: "export",
      redacted: true,
      written: false,
      busy,
      diagnostics: [createDiagnostic({
        severity: "error",
        code: "FORGE_DELTA_BUSY",
        message: `Forge Delta export cannot run while the local store is busy: ${summarizeDeltaStoreBusy(busy)}`,
        suggestedCommands: ["forge delta status --json"],
      })],
      nextActions: ["forge delta status --json"],
      exitCode: 1,
    };
  }
  if (store instanceof Error) {
    const message = store.message || "unknown Delta store open failure";
    const pgliteAbort = /Aborted\(\)|postmaster|pglite/iu.test(message);
    return {
      ok: false,
      subcommand: "export",
      redacted: true,
      written: false,
      diagnostics: [createDiagnostic({
        severity: "error",
        code: "FORGE_DELTA_EXPORT_FAILED",
        message: `Forge Delta export could not open the local store: ${message}`,
        fixHint: pgliteAbort
          ? "The local PGlite Delta store may be stale or corrupt. Inspect status first; if no Forge process is active, run a dry-run repair before removing local memory."
          : "Inspect Delta status before retrying the export.",
        suggestedCommands: [
          "forge delta status --verbose --json",
          "forge delta repair --dry-run --json",
          "forge doctor windows --json",
        ],
      })],
      nextActions: [
        "forge delta status --verbose --json",
        "forge delta repair --dry-run --json",
      ],
      exitCode: 1,
    };
  }
  try {
    const status = await store.status();
    const details = await store.statusDetails();
    const timeline = await store.timeline({ limit });
    const semanticTimeline = await store.semanticTimeline({ limit }, { refresh: false });
    const agentMemory = await store.listAgentMemoryEvents({ limit });
    const data = {
      schemaVersion: "0.1.0",
      redacted: true,
      exportedAt: new Date().toISOString(),
      status: { ...status, details },
      timeline,
      semanticTimeline,
      agentMemory,
    };
    let output: string | undefined;
    if (options.output) {
      const absolute = resolveExportPath(options.workspaceRoot, options.output);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      output = normalizePath(relative(options.workspaceRoot, absolute));
    }
    return {
      ok: true,
      subcommand: "export",
      redacted: true,
      ...(output ? { output } : {}),
      written: Boolean(output),
      data,
      diagnostics: [],
      nextActions: ["forge delta status --verbose --json"],
      exitCode: 0,
    };
  } finally {
    await store.close();
  }
}

export async function runDeltaExport(options: DeltaExportOptions): Promise<DeltaExportResult> {
  return normalizeDeltaCliCommandHints(options.workspaceRoot, await runDeltaExportRaw(options));
}

export function formatDeltaStatusHuman(result: DeltaStatusResult): string {
  const lines = ["Forge Delta", ""];
  if (!result.ok) {
    lines.push("Status:");
    lines.push("  unavailable");
    lines.push(`  local store: ${result.store}`);
    lines.push("");
    lines.push("Diagnostics:");
    for (const diagnostic of result.diagnostics) {
      lines.push(`  ${diagnostic.code}: ${diagnostic.message}`);
      if (diagnostic.fixHint) {
        lines.push(`  fix: ${diagnostic.fixHint}`);
      }
    }
    lines.push("");
    lines.push("Next:");
    for (const action of result.nextActions) {
      lines.push(`  ${action}`);
    }
    return `${lines.join("\n")}\n`;
  }
  lines.push("Status:");
  lines.push(`  ${result.recording ? "recording enabled" : "recording disabled"}`);
  lines.push(`  local store: ${result.store}`);
  lines.push("");
  lines.push("Current work session:");
  if (result.workSession) {
    lines.push(`  ${result.workSession.id}`);
    lines.push(`  title: ${result.workSession.title}`);
    lines.push(`  status: ${result.workSession.status}`);
    lines.push(`  confidence: ${result.workSession.confidence.toFixed(2)}`);
    lines.push(`  operations: ${result.workSession.operationCount}`);
    if (result.workSession.gitBranch) {
      lines.push(`  branch: ${result.workSession.gitBranch}`);
    }
    if (result.workSession.reasons.length > 0) {
      lines.push("");
      lines.push("Why this session:");
      for (const reason of result.workSession.reasons.slice(0, 5)) {
        lines.push(`  - ${reason.signal}${reason.value ? `: ${reason.value}` : ""}`);
      }
    }
  } else {
    lines.push("  none");
  }
  lines.push("");
  lines.push("Latest recorder session:");
  if (result.session) {
    lines.push(`  ${result.session.id}`);
    lines.push(`  started: ${result.session.startedAt}`);
    lines.push(`  operations: ${result.session.operationCount}`);
  } else {
    lines.push("  none");
  }
  lines.push("");
  lines.push("Recent operations:");
  if (result.recentOperations.length === 0) {
    lines.push("  none");
  } else {
    for (const operation of result.recentOperations) {
      lines.push(`  ${operation.timestamp.slice(11, 16)} ${operation.kind}${operation.summary ? ` ${operation.summary}` : ""}`);
    }
  }
  if (result.details) {
    lines.push("");
    lines.push("Details:");
    lines.push(`  schema: ${result.details.schema.storedVersion ?? "unknown"} (expected ${result.details.schema.expectedVersion})`);
    lines.push(`  lock: ${result.details.locks.forgeLockPresent ? "present" : "absent"} at ${result.details.paths.lock}`);
    lines.push(`  postmaster: ${result.details.locks.postmasterPresent ? "present" : "absent"} at ${result.details.paths.postmaster}`);
    lines.push(`  health: ${result.details.health.status}`);
    for (const check of result.details.health.checks) {
      lines.push(`    ${check.status}: ${check.name} - ${check.message}`);
    }
    lines.push("  operational:");
    lines.push(`    queue: ${result.details.operational.queueExists ? `${result.details.operational.queueSizeBytes} bytes` : "absent"} at ${result.details.operational.queuePath}`);
    lines.push(`    pending events: ${result.details.operational.queuePendingEvents}`);
    lines.push(`    queue redaction: ${result.details.operational.queueRedaction}`);
    lines.push(`    queue history: ${result.details.operational.queueHistoryExists ? `${result.details.operational.queueHistorySizeBytes} bytes, ${result.details.operational.queueHistoryLines} lines` : "absent"} at ${result.details.operational.queueHistoryPath}`);
    if (result.details.operational.lastCompactionAt) {
      lines.push(`    last compaction: ${result.details.operational.lastCompactionAt}`);
    }
    lines.push(`    overhead: ${result.details.operational.estimatedOverhead}`);
    if (result.details.operational.oldestOperationAt) {
      lines.push(`    oldest operation: ${result.details.operational.oldestOperationAt}`);
    }
    if (result.details.operational.newestOperationAt) {
      lines.push(`    newest operation: ${result.details.operational.newestOperationAt}`);
    }
    lines.push("  counts:");
    for (const [name, count] of Object.entries(result.details.counts)) {
      lines.push(`    ${name}: ${count}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function formatDeltaStatusJson(result: DeltaStatusResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatDeltaRepairHuman(result: DeltaRepairResult): string {
  const lines = [
    `Forge Delta repair ${result.ok ? (result.applied ? "applied" : "planned") : "failed"}`,
    "",
    `Store: ${result.store}`,
  ];
  if (result.backupPath) {
    lines.push(`Backup: ${result.backupPath}`);
  }
  lines.push("", "Actions:");
  for (const action of result.actions) {
    lines.push(`  ${action.kind}${action.from ? ` ${action.from}` : ""}${action.to ? ` -> ${action.to}` : ""}${action.skipped ? " (skipped)" : ""}`);
  }
  if (result.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    for (const diagnostic of result.diagnostics) {
      lines.push(`  ${diagnostic.code}: ${diagnostic.message}`);
    }
  }
  if (result.nextActions.length > 0) {
    lines.push("", "Next:");
    for (const action of result.nextActions) {
      lines.push(`  ${action}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function formatDeltaRepairJson(result: DeltaRepairResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatDeltaDoctorHuman(result: DeltaDoctorResult): string {
  const lines = ["Forge Delta doctor", ""];
  for (const check of result.checks) {
    const marker = check.ok ? "OK" : check.severity === "warning" ? "WARN" : "FAIL";
    lines.push(`${marker} ${check.name} - ${check.message}`);
  }
  if (result.nextActions.length > 0) {
    lines.push("", "Next:");
    for (const action of result.nextActions) {
      lines.push(`  ${action}`);
    }
  }
  lines.push("", result.ok ? "Delta operational state is usable." : "Delta operational state needs attention.");
  return `${lines.join("\n")}\n`;
}

export function formatDeltaDoctorJson(result: DeltaDoctorResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatDeltaCompactHuman(result: DeltaCompactResult): string {
  const lines = [`Forge Delta compact ${result.applied ? "applied" : "planned"}`, ""];
  for (const file of result.files) {
    lines.push(`${file.path}: ${file.beforeBytes} -> ${file.afterBytes} bytes (${file.linesBefore} -> ${file.linesAfter} lines)`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatDeltaCompactJson(result: DeltaCompactResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatDeltaPruneHuman(result: DeltaPruneResult): string {
  const lines = [`Forge Delta prune ${result.applied ? "applied" : "planned"}`, ""];
  if (result.cutoff) {
    lines.push(`Cutoff: ${result.cutoff}`);
  }
  for (const file of result.files) {
    lines.push(`${file.path}: pruned ${file.prunedLines} lines`);
  }
  if (result.needsConfirmation) {
    lines.push("", "Next:", ...result.nextActions.map((action) => `  ${action}`));
  }
  return `${lines.join("\n")}\n`;
}

export function formatDeltaPruneJson(result: DeltaPruneResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatDeltaExportHuman(result: DeltaExportResult): string {
  if (!result.ok) {
    return `Forge Delta export failed\n${result.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join("\n")}\n`;
  }
  return result.output
    ? `Forge Delta export wrote ${result.output}\n`
    : `${JSON.stringify(result.data, null, 2)}\n`;
}

export function formatDeltaExportJson(result: DeltaExportResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
