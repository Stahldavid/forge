import { PGlite } from "@electric-sql/pglite";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { DbAdapter, DbQueryResult, DbTransaction } from "./adapter.ts";

export const DEFAULT_PGLITE_DIR = ".forge/pglite";

export type PgliteStoreState =
  | "missing"
  | "healthy"
  | "active"
  | "aborted"
  | "unhealthy";

export interface PgliteStoreInspection {
  dataDir: string;
  exists: boolean;
  state: PgliteStoreState;
  openable: boolean;
  postmasterPid?: number;
  postmasterAlive?: boolean;
  lockFiles: string[];
  error?: string;
  nextActions: string[];
}

export interface PgliteStoreRepairResult {
  ok: boolean;
  repaired: boolean;
  dataDir: string;
  backupPath: string | null;
  before: PgliteStoreInspection;
  after: PgliteStoreInspection;
  message: string;
  nextActions: string[];
}

function toQueryResult(result: {
  rows: Record<string, unknown>[];
  affectedRows?: number;
}): DbQueryResult {
  return {
    rows: result.rows,
    rowCount: result.affectedRows ?? result.rows.length,
  };
}

export class PgliteAdapter implements DbAdapter {
  readonly kind = "pglite" as const;
  private db: PGlite;

  constructor(dataDir: string) {
    this.db = new PGlite(dataDir);
  }

  async query(sql: string, params: unknown[] = []): Promise<DbQueryResult> {
    const result = await this.db.query(sql, params);
    return toQueryResult(result as { rows: Record<string, unknown>[]; affectedRows?: number });
  }

  async begin(): Promise<DbTransaction> {
    await this.db.query("BEGIN");
    const adapter = this;

    return {
      query: (sql, params = []) => adapter.query(sql, params),
      commit: async () => {
        await adapter.query("COMMIT");
      },
      rollback: async () => {
        await adapter.query("ROLLBACK");
      },
    };
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

export async function createPgliteAdapter(dataDir: string): Promise<DbAdapter> {
  mkdirSync(dataDir, { recursive: true });
  repairStalePgliteStore(dataDir);
  const adapter = new PgliteAdapter(dataDir);
  try {
    await adapter.query("SELECT 1");
    return adapter;
  } catch (error) {
    await adapter.close().catch(() => undefined);
    throw error;
  }
}

export async function inspectPgliteStore(dataDir: string): Promise<PgliteStoreInspection> {
  const exists = existsSync(dataDir);
  const lockFiles = [
    "postmaster.pid",
    ".s.PGSQL.5432.lock",
    ".s.PGSQL.5432.lock.out",
  ].filter((file) => existsSync(join(dataDir, file)));

  if (!exists) {
    return {
      dataDir,
      exists: false,
      state: "missing",
      openable: true,
      lockFiles,
      nextActions: ["forge dev --db pglite --json"],
    };
  }

  const pid = readPglitePostmasterPid(dataDir);
  const postmasterAlive = Number.isInteger(pid) && pid > 0 ? isProcessAlive(pid) : undefined;
  if (postmasterAlive) {
    return {
      dataDir,
      exists: true,
      state: "active",
      openable: false,
      postmasterPid: pid,
      postmasterAlive,
      lockFiles,
      error: `PGlite store is currently owned by live pid ${pid}`,
      nextActions: [
        "stop the running forge dev process that owns .forge/pglite",
        "forge doctor pglite --json",
      ],
    };
  }

  let adapter: DbAdapter | null = null;
  const previousExitCode = process.exitCode;
  let restoreExitCode = false;
  try {
    adapter = new PgliteAdapter(dataDir);
    await adapter.query("SELECT 1");
    return {
      dataDir,
      exists: true,
      state: "healthy",
      openable: true,
      ...(Number.isInteger(pid) && pid > 0 ? { postmasterPid: pid, postmasterAlive: false } : {}),
      lockFiles,
      nextActions: ["forge dev --db pglite --json"],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = isPgliteAbortMessage(message);
    if (aborted) {
      restoreExitCode = true;
      process.exitCode = previousExitCode;
    }
    return {
      dataDir,
      exists: true,
      state: aborted ? "aborted" : "unhealthy",
      openable: false,
      ...(Number.isInteger(pid) && pid > 0 ? { postmasterPid: pid, postmasterAlive: false } : {}),
      lockFiles,
      error: message,
      nextActions: [
        "forge db repair --local --adapter pglite --json",
        "forge dev --db memory --json",
      ],
    };
  } finally {
    await adapter?.close().catch(() => undefined);
    if (restoreExitCode) {
      process.exitCode = previousExitCode;
    }
  }
}

export async function repairLocalPgliteStore(dataDir: string): Promise<PgliteStoreRepairResult> {
  const before = await inspectPgliteStore(dataDir);
  if (before.state === "active") {
    return {
      ok: false,
      repaired: false,
      dataDir,
      backupPath: null,
      before,
      after: before,
      message: "PGlite store is active; stop the owning forge dev process before repair.",
      nextActions: before.nextActions,
    };
  }

  if (before.state === "missing") {
    return {
      ok: true,
      repaired: false,
      dataDir,
      backupPath: null,
      before,
      after: before,
      message: "No local PGlite store exists; nothing to repair.",
      nextActions: before.nextActions,
    };
  }

  if (before.state === "healthy") {
    return {
      ok: true,
      repaired: false,
      dataDir,
      backupPath: null,
      before,
      after: before,
      message: "Local PGlite store is healthy; no repair needed.",
      nextActions: before.nextActions,
    };
  }

  const backupPath = archivePgliteStore(dataDir, before.state);
  const after = await inspectPgliteStore(dataDir);
  const ok = after.state === "missing" || after.state === "healthy";
  return {
    ok,
    repaired: true,
    dataDir,
    backupPath,
    before,
    after,
    message: backupPath
      ? `Archived local PGlite store to ${backupPath}.`
      : "Removed stale local PGlite lock files; retry forge dev.",
    nextActions: ok
      ? ["forge dev --db pglite --json"]
      : ["forge dev --db memory --json", "forge doctor pglite --json"],
  };
}

export function isPgliteAbortMessage(message: string): boolean {
  return /Aborted\(\)\. Build with -sASSERTIONS/i.test(message) ||
    (/pglite/i.test(message) && /abort/i.test(message));
}

function repairStalePgliteStore(dataDir: string): void {
  const pidPath = join(dataDir, "postmaster.pid");
  if (!existsSync(pidPath)) {
    return;
  }

  const pid = readPglitePostmasterPid(dataDir);
  const stale =
    !Number.isInteger(pid) ||
    pid <= 0 ||
    !isProcessAlive(pid);

  if (!stale) {
    return;
  }

  removeStalePgliteLocks(dataDir);
}

function readPglitePostmasterPid(dataDir: string): number {
  try {
    const rawPid = readFileSync(join(dataDir, "postmaster.pid"), "utf8").split(/\r?\n/, 1)[0]?.trim();
    return rawPid ? Number(rawPid) : NaN;
  } catch {
    return NaN;
  }
}

function removeStalePgliteLocks(dataDir: string): void {
  for (const file of [
    "postmaster.pid",
    ".s.PGSQL.5432.lock",
    ".s.PGSQL.5432.lock.out",
  ]) {
    try {
      unlinkSync(join(dataDir, file));
    } catch {
      // Best effort. If PGlite still cannot open, the caller reports the real open error.
    }
  }
}

export function archivePgliteStore(dataDir: string, reason = "repair"): string | null {
  if (!existsSync(dataDir)) {
    return null;
  }

  const parent = dirname(dataDir);
  const backupsDir = join(parent, `${basename(dataDir)}.backups`);
  mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupsDir, `${basename(dataDir)}.${reason}.${stamp}`);

  try {
    renameSync(dataDir, backupPath);
    mkdirSync(dataDir, { recursive: true });
    return backupPath;
  } catch {
    rmSync(join(dataDir, "postmaster.pid"), { force: true });
    rmSync(join(dataDir, ".s.PGSQL.5432.lock"), { force: true });
    rmSync(join(dataDir, ".s.PGSQL.5432.lock.out"), { force: true });
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
