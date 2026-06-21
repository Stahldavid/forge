import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { normalizePath } from "../compiler/primitives/paths.ts";
import {
  DeltaStore,
  DeltaStoreBusyError,
  describeDeltaStoreBusy,
  getDeltaStorePath,
  probeDeltaStoreBusy,
  type DeltaStatus,
  type DeltaStoreBusyInfo,
} from "./store.ts";

export type DeltaStatusResult =
  | (DeltaStatus & { exitCode: 0 })
  | {
      ok: false;
      recording: false;
      store: string;
      busy?: DeltaStoreBusyInfo;
      diagnostics: ReturnType<typeof createDiagnostic>[];
      nextActions: string[];
      exitCode: 1;
    };

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

export async function runDeltaStatus(workspaceRoot: string): Promise<DeltaStatusResult> {
  const storePath = normalizePath(relative(workspaceRoot, getDeltaStorePath(workspaceRoot)));
  let openError: unknown;
  const store = await DeltaStore.open(workspaceRoot, { access: "read" }).catch((error: unknown) => {
    openError = error;
    return null;
  });
  if (!store) {
    const errorMessage = openError instanceof Error ? openError.message : "unknown open error";
    const busyError = openError instanceof DeltaStoreBusyError ? openError : undefined;
    const busy = Boolean(busyError);
    const busyInfo = busyError ? describeDeltaStoreBusy(busyError, workspaceRoot) : undefined;
    const busySummary = busyInfo
      ? [
          `lock=${busyInfo.relativeLockPath}`,
          busyInfo.pid ? `pid=${busyInfo.pid}` : undefined,
          busyInfo.processAlive ? "process=alive" : "process=unknown-or-exited",
          typeof busyInfo.ageMs === "number" ? `age=${Math.round(busyInfo.ageMs / 1000)}s` : undefined,
        ].filter(Boolean).join(", ")
      : undefined;
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
    return {
      ...(await store.status()),
      exitCode: 0,
    };
  } finally {
    await store.close();
  }
}

function timestampForPath(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function deltaBackupPath(workspaceRoot: string, storePath: string): string {
  return join(workspaceRoot, ".forge", "delta", "backups", `${basename(storePath)}.${timestampForPath()}`);
}

export async function runDeltaRepair(options: DeltaRepairOptions): Promise<DeltaRepairResult> {
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
    const busySummary = [
      `lock=${busyInfo.relativeLockPath}`,
      busyInfo.pid ? `pid=${busyInfo.pid}` : undefined,
      busyInfo.processAlive ? "process=alive" : "process=unknown-or-exited",
      typeof busyInfo.ageMs === "number" ? `age=${Math.round(busyInfo.ageMs / 1000)}s` : undefined,
    ].filter(Boolean).join(", ");
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
