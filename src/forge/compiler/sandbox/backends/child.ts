import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SandboxLimits } from "../../types/cli.ts";
import type { Dependency } from "../../types/package-graph.ts";
import { SANDBOX_KILL_GRACE_MS } from "../limits.ts";

export interface ChildRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  oomKilled: boolean;
  startFailed: boolean;
}

export interface ChildRunner {
  run(
    dep: Dependency,
    limits: SandboxLimits,
    env: Record<string, string>,
  ): Promise<ChildRunResult>;
}

const INSPECTOR_ENTRY = fileURLToPath(
  new URL("../inspector-entry.ts", import.meta.url),
);

function resolveRuntimeExecutable(): string {
  return process.execPath;
}

export const defaultChildRunner: ChildRunner = {
  async run(dep, limits, env) {
    const executable = resolveRuntimeExecutable();
    const args = [INSPECTOR_ENTRY, dep.installPath];

    return new Promise<ChildRunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let oomKilled = false;
      let startFailed = false;
      let settled = false;

      const child = spawn(executable, args, {
        env: {
          ...env,
          FORGE_SANDBOX: "1",
          NODE_OPTIONS: `--max-old-space-size=${limits.memoryMb}`,
        },
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

      child.on("error", () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(killTimer);
        startFailed = true;
        resolve({
          stdout,
          stderr,
          exitCode: null,
          timedOut,
          oomKilled,
          startFailed,
        });
      });

      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(killTimer);
        if (signal === "SIGKILL" && timedOut) {
          // timeout path
        }
        if (stderr.includes("heap out of memory") || stderr.includes("ENOMEM")) {
          oomKilled = true;
        }
        resolve({
          stdout,
          stderr,
          exitCode: code,
          timedOut,
          oomKilled,
          startFailed,
        });
      });
    });
  },
};

let childRunner: ChildRunner = defaultChildRunner;

export function setChildRunner(runner: ChildRunner | undefined): void {
  childRunner = runner ?? defaultChildRunner;
}

export function getChildRunner(): ChildRunner {
  return childRunner;
}
