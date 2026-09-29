import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect } from "bun:test";
import { repairStalePgliteStore } from "../../src/forge/runtime/db/pglite-adapter.ts";
import { probeDeltaStoreBusy } from "../../src/forge/delta/store.ts";
import { processStartTimeMs } from "../../src/forge/delta/process-identity.ts";

test("PGlite negative postmaster PID does not authorize automatic lock removal", () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-pglite-lock-"));
  const pidPath = join(dir, "postmaster.pid");
  const socketLock = join(dir, ".s.PGSQL.5432.lock");
  try {
    writeFileSync(pidPath, "-42\n", "utf8");
    writeFileSync(socketLock, "owner-unknown", "utf8");
    repairStalePgliteStore(dir);
    expect(existsSync(pidPath)).toBe(true);
    expect(existsSync(socketLock)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Delta lock with a reused live PID is recognized by process start time", () => {
  if (processStartTimeMs(process.pid) === null) return;
  const root = mkdtempSync(join(tmpdir(), "forge-delta-pid-reuse-"));
  const lock = join(root, ".forge", "delta", "delta.lock");
  try {
    mkdirSync(join(root, ".forge", "delta"), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "former-owner", createdAt: "2000-01-01T00:00:00.000Z" }));
    expect(probeDeltaStoreBusy(root)).toBeNull();
    expect(existsSync(lock)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
