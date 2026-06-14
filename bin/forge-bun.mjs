#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join, win32 } from "node:path";
import { spawn } from "node:child_process";

function isWindows() {
  return process.platform === "win32";
}

function isKiroBun(path) {
  return path.replace(/\//g, "\\").toLowerCase().includes("\\kiro-cli\\");
}

function isBunExecutablePath(path) {
  const file = (isWindows() ? win32.basename(path) : basename(path)).toLowerCase();
  return isWindows() ? file === "bun.exe" : file === "bun";
}

function which(command) {
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = isWindows() ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function normalizeWindowsBun(candidate) {
  if (!candidate || isKiroBun(candidate)) {
    return null;
  }
  if (candidate.toLowerCase().endsWith(".exe")) {
    return existsSync(candidate) ? candidate : null;
  }
  const exeCandidate = `${candidate}.exe`;
  return existsSync(exeCandidate) ? exeCandidate : null;
}

function resolveBunExecutable() {
  const configured = process.env.FORGE_BUN;
  if (configured) {
    if (isWindows()) {
      const normalized = normalizeWindowsBun(configured);
      if (normalized) {
        return normalized;
      }
    } else if (existsSync(configured)) {
      return configured;
    }
    throw new Error(`FORGE_BUN does not point to a safe Bun executable: ${configured}`);
  }

  if (isBunExecutablePath(process.execPath) && existsSync(process.execPath)) {
    return process.execPath;
  }

  const fromPath = which("bun");
  if (!isWindows()) {
    return fromPath ?? "bun";
  }

  const normalized = normalizeWindowsBun(fromPath);
  if (normalized) {
    return normalized;
  }

  const homeBun = win32.join(homedir(), ".bun", "bin", "bun.exe");
  if (existsSync(homeBun)) {
    return homeBun;
  }

  throw new Error(
    "Unable to resolve a safe Bun executable on Windows. Install Bun at ~/.bun/bin/bun.exe or set FORGE_BUN to an existing bun.exe. Refusing to spawn bare bun.exe because Windows may open an app picker.",
  );
}

let bunPath;
try {
  bunPath = resolveBunExecutable();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const args = process.argv.slice(2);
const child = spawn(bunPath, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
