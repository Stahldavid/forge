import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, win32 } from "node:path";

export interface BunExecutableResolutionOptions {
  execPath?: string;
  exists?: (path: string) => boolean;
  homeDir?: string;
  platform?: NodeJS.Platform;
  which?: (command: string) => string | null | undefined;
}

function isBunExecutablePath(path: string, platform: NodeJS.Platform): boolean {
  const file = (platform === "win32" ? win32.basename(path) : basename(path)).toLowerCase();
  return platform === "win32" ? file === "bun.exe" : file === "bun";
}

function normalizeWindowsBunCandidate(
  candidate: string | null | undefined,
  exists: (path: string) => boolean,
): string | null {
  if (!candidate) {
    return null;
  }

  if (candidate.toLowerCase().endsWith(".exe")) {
    return exists(candidate) ? candidate : null;
  }

  const exeCandidate = `${candidate}.exe`;
  return exists(exeCandidate) ? exeCandidate : null;
}

/** Resolve the Bun executable for spawning child processes (Windows-safe). */
export function resolveBunExecutable(options: BunExecutableResolutionOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const execPath = options.execPath ?? process.execPath;

  if (isBunExecutablePath(execPath, platform) && exists(execPath)) {
    return execPath;
  }

  const fromPath =
    options.which?.("bun") ?? (typeof Bun !== "undefined" ? Bun.which("bun") : undefined);

  if (platform === "win32") {
    const normalized = normalizeWindowsBunCandidate(fromPath, exists);
    if (normalized) {
      return normalized;
    }

    const joinPath = platform === "win32" ? win32.join : join;
    const homeBun = joinPath(options.homeDir ?? homedir(), ".bun", "bin", "bun.exe");
    if (exists(homeBun)) {
      return homeBun;
    }

    return "bun.exe";
  }

  if (fromPath) {
    return fromPath;
  }

  return "bun";
}
