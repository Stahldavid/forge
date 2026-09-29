import { execFileSync } from "node:child_process";

/** Best-effort OS process start time. Unknown identity never authorizes lock removal. */
export function processStartTimeMs(pid: number): number | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const output = process.platform === "win32"
      ? execFileSync("powershell.exe", [
          "-NoProfile", "-NonInteractive", "-Command",
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
        ], { encoding: "utf8", timeout: 3_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
      : execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
          encoding: "utf8", timeout: 3_000, stdio: ["ignore", "pipe", "ignore"],
        });
    const time = Date.parse(output.trim());
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

/** A later process start proves that an older lock/endpoint belongs to a reused PID. */
export function pidWasReused(pid: number, ownerCreatedAt: unknown): boolean {
  const ownerTime = typeof ownerCreatedAt === "string" ? Date.parse(ownerCreatedAt) : NaN;
  if (!Number.isFinite(ownerTime)) return false;
  const observedStart = processStartTimeMs(pid);
  return observedStart !== null && observedStart > ownerTime + 1_000;
}
