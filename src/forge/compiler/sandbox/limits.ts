import type { SandboxLimits } from "../types/cli.ts";
import type { SandboxBackend } from "../types/runtime.ts";

export const DEFAULT_SANDBOX_TIMEOUT_MS = 30_000;
export const DEFAULT_SANDBOX_MEMORY_MB = 256;
export const DEFAULT_SANDBOX_PIDS_LIMIT = 128;
export const SANDBOX_KILL_GRACE_MS = 1_000;

export function defaultSandboxLimits(
  backend: SandboxBackend = "none",
): SandboxLimits {
  return {
    backend,
    timeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS,
    memoryMb: DEFAULT_SANDBOX_MEMORY_MB,
    network: false,
    filesystem: "read-only",
    allowPostinstall: false,
  };
}

export function clampSandboxLimits(limits: SandboxLimits): SandboxLimits {
  return {
    ...limits,
    timeoutMs: Math.min(limits.timeoutMs, DEFAULT_SANDBOX_TIMEOUT_MS),
    memoryMb: Math.min(limits.memoryMb, DEFAULT_SANDBOX_MEMORY_MB),
    network: false,
    filesystem: "read-only",
    allowPostinstall: false,
  };
}
