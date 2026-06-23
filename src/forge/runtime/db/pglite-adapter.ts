import { PGlite } from "@electric-sql/pglite";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { DbAdapter, DbQueryResult, DbTransaction } from "./adapter.ts";

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

function repairStalePgliteStore(dataDir: string): void {
  const pidPath = join(dataDir, "postmaster.pid");
  if (!existsSync(pidPath)) {
    return;
  }

  const rawPid = readFileSync(pidPath, "utf8").split(/\r?\n/, 1)[0]?.trim();
  const pid = rawPid ? Number(rawPid) : NaN;
  const stale =
    !Number.isInteger(pid) ||
    pid <= 0 ||
    !isProcessAlive(pid);

  if (!stale) {
    return;
  }

  removeStalePgliteLocks(dataDir);
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
