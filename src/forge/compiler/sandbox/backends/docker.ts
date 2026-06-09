import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SandboxLimits } from "../../types/cli.ts";
import type { Dependency } from "../../types/package-graph.ts";
import { DEFAULT_SANDBOX_PIDS_LIMIT, SANDBOX_KILL_GRACE_MS } from "../limits.ts";

export interface DockerRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  oomKilled: boolean;
  startFailed: boolean;
  dockerUnavailable: boolean;
}

export interface DockerRunner {
  run(
    dep: Dependency,
    limits: SandboxLimits,
    env: Record<string, string>,
  ): Promise<DockerRunResult>;
}

const INSPECTOR_ENTRY = fileURLToPath(
  new URL("../inspector-entry.ts", import.meta.url),
);

const DEFAULT_DOCKER_IMAGE = "oven/bun:1";

function buildDockerArgs(
  dep: Dependency,
  limits: SandboxLimits,
  env: Record<string, string>,
): string[] {
  const args = [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--memory",
    `${limits.memoryMb}m`,
    "--pids-limit",
    String(DEFAULT_SANDBOX_PIDS_LIMIT),
    "--cap-drop",
    "ALL",
    "-v",
    `${dep.installPath}:/pkg:ro`,
    "-v",
    `${INSPECTOR_ENTRY}:/inspector-entry.ts:ro`,
  ];

  for (const [key, value] of Object.entries(env)) {
    args.push("-e", `${key}=${value}`);
  }

  args.push(
    process.env.FORGE_SANDBOX_DOCKER_IMAGE ?? DEFAULT_DOCKER_IMAGE,
    "bun",
    "run",
    "/inspector-entry.ts",
    "/pkg",
  );

  return args;
}

export const defaultDockerRunner: DockerRunner = {
  async run(dep, limits, env) {
    const args = buildDockerArgs(dep, limits, env);

    return new Promise<DockerRunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let oomKilled = false;
      let startFailed = false;
      let dockerUnavailable = false;
      let settled = false;

      const child = spawn("docker", args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const killTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, SANDBOX_KILL_GRACE_MS);
      }, limits.timeoutMs);

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += String(chunk);
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += String(chunk);
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(killTimer);
        startFailed = true;
        dockerUnavailable = error.code === "ENOENT";
        resolve({
          stdout,
          stderr,
          exitCode: null,
          timedOut,
          oomKilled,
          startFailed,
          dockerUnavailable,
        });
      });

      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(killTimer);
        if (
          stderr.includes("OOM") ||
          stderr.includes("out of memory") ||
          stderr.includes("Cannot allocate memory")
        ) {
          oomKilled = true;
        }
        resolve({
          stdout,
          stderr,
          exitCode: code,
          timedOut,
          oomKilled,
          startFailed,
          dockerUnavailable: false,
        });
      });
    });
  },
};

let dockerRunner: DockerRunner = defaultDockerRunner;

export function setDockerRunner(runner: DockerRunner | undefined): void {
  dockerRunner = runner ?? defaultDockerRunner;
}

export function getDockerRunner(): DockerRunner {
  return dockerRunner;
}

export function dockerRunFlags(limits: SandboxLimits): string[] {
  return [
    "--network",
    "none",
    "--read-only",
    "--memory",
    `${limits.memoryMb}m`,
    "--pids-limit",
    String(DEFAULT_SANDBOX_PIDS_LIMIT),
    "--cap-drop",
    "ALL",
  ];
}
