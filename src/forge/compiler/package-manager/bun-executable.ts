import { homedir } from "node:os";
import { nodeFileSystem } from "../fs/index.ts";
import { basename, join, win32 } from "node:path";

export interface BunExecutableResolutionOptions {
  env?: Record<string, string | undefined>;
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

  const normalizedForMatch = candidate.replace(/\//g, "\\").toLowerCase();
  if (normalizedForMatch.includes("\\kiro-cli\\")) {
    return null;
  }

  if (candidate.toLowerCase().endsWith(".exe")) {
    return exists(candidate) ? candidate : null;
  }

  const exeCandidate = `${candidate}.exe`;
  return exists(exeCandidate) ? exeCandidate : null;
}

function unresolvedWindowsBunError(): Error {
  return new Error(
    "Unable to resolve a safe Bun executable on Windows. Install Bun at ~/.bun/bin/bun.exe or set FORGE_BUN to an existing bun.exe. Refusing to spawn bare bun.exe because Windows may open an app picker.",
  );
}

/** Resolve the Bun executable for spawning child processes (Windows-safe). */
export function resolveBunExecutable(options: BunExecutableResolutionOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? nodeFileSystem.exists;
  const execPath = options.execPath ?? process.execPath;
  const configured = options.env?.FORGE_BUN ?? process.env.FORGE_BUN;

  if (configured) {
    if (platform === "win32") {
      const normalized = normalizeWindowsBunCandidate(configured, exists);
      if (normalized) {
        return normalized;
      }
    } else if (exists(configured)) {
      return configured;
    }
    throw new Error(`FORGE_BUN does not point to a safe Bun executable: ${configured}`);
  }

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

    throw unresolvedWindowsBunError();
  }

  if (fromPath) {
    return fromPath;
  }

  return "bun";
}
