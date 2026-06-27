import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDiagnostic } from "../diagnostics/create.ts";
import type { Diagnostic } from "../types/diagnostic.ts";

export const GENERATE_LOCK_FAILURE_KIND = "generate-lock-timeout";

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_POLL_MS = 50;

export interface GenerateLockOptions {
  timeoutMs?: number;
  pollMs?: number;
}

export interface GenerateLockHandle {
  lockPath: string;
  release(): void;
}

export type GenerateLockResult =
  | { ok: true; handle: GenerateLockHandle }
  | { ok: false; diagnostic: Diagnostic; failureKind: typeof GENERATE_LOCK_FAILURE_KIND };

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockTimeoutDiagnostic(lockPath: string, timeoutMs: number, ownerPid: number | null): Diagnostic {
  const owner = ownerPid === null ? "unknown owner" : `owner pid ${ownerPid}`;
  return createDiagnostic({
    severity: "error",
    code: "FORGE_GENERATE_LOCKED",
    message:
      `forge generate is already running (${owner}) or a stale generate lock exists at ${lockPath} after ${timeoutMs}ms. ` +
      "Avoid running forge generate, forge dev --once, and forge verify concurrently in the same workspace.",
    file: lockPath,
    fixHint:
      "Wait for the active Forge command to finish. If the owner pid is gone, remove .forge/locks/generate.lock and retry.",
    suggestedCommands: [
      "forge status --json",
      "forge generate --check --json",
      "forge dev --once --json",
    ],
  });
}

function readLockOwnerPid(lockPath: string): number | null {
  try {
    const raw = readFileSync(join(lockPath, "owner.json"), "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid === "number" && Number.isInteger(parsed.pid)
      ? parsed.pid
      : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH" || code === "EINVAL") {
      return false;
    }
    return true;
  }
}

function recoverStaleLock(lockPath: string): boolean {
  const ownerPid = readLockOwnerPid(lockPath);
  if (ownerPid === null || isProcessAlive(ownerPid)) {
    return false;
  }
  rmSync(lockPath, { recursive: true, force: true });
  return true;
}

export async function acquireGenerateLock(
  workspaceRoot: string,
  options: GenerateLockOptions = {},
): Promise<GenerateLockResult> {
  const timeoutMs =
    options.timeoutMs ??
    parsePositiveInteger(process.env.FORGE_GENERATE_LOCK_TIMEOUT_MS) ??
    DEFAULT_LOCK_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_LOCK_POLL_MS;
  const locksDir = join(workspaceRoot, ".forge", "locks");
  const lockPath = join(locksDir, "generate.lock");
  const startedAt = Date.now();

  while (true) {
    try {
      mkdirSync(locksDir, { recursive: true });
      mkdirSync(lockPath);
      writeFileSync(
        join(lockPath, "owner.json"),
        `${JSON.stringify({ pid: process.pid }, null, 2)}\n`,
        "utf8",
      );
      return {
        ok: true,
        handle: {
          lockPath,
          release() {
            rmSync(lockPath, { recursive: true, force: true });
          },
        },
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }

      if (recoverStaleLock(lockPath)) {
        continue;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        const ownerPid = readLockOwnerPid(lockPath);
        return {
          ok: false,
          diagnostic: lockTimeoutDiagnostic(lockPath, timeoutMs, ownerPid),
          failureKind: GENERATE_LOCK_FAILURE_KIND,
        };
      }

      await sleep(pollMs);
    }
  }
}
