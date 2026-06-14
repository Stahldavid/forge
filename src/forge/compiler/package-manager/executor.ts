import { spawn } from "node:child_process";
import {
  resolveBunExecutable,
  type BunExecutableResolutionOptions,
} from "./bun-executable.ts";

export interface CommandRunOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
}

export interface CommandRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandExecutor {
  run(argv: string[], options: CommandRunOptions): Promise<CommandRunResult>;
}

export function resolvePackageManagerArgv(
  argv: string[],
  bunOptions?: BunExecutableResolutionOptions,
): string[] {
  if (argv[0]?.toLowerCase() === "bun" || argv[0]?.toLowerCase() === "bun.exe") {
    return [resolveBunExecutable(bunOptions), ...argv.slice(1)];
  }

  return argv;
}

export class PackageManagerCommandError extends Error {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly argv: readonly string[];

  constructor(
    message: string,
    argv: readonly string[],
    result: CommandRunResult,
  ) {
    super(message);
    this.name = "PackageManagerCommandError";
    this.argv = argv;
    this.exitCode = result.exitCode;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
  }
}

export const defaultCommandExecutor: CommandExecutor = {
  async run(argv, options) {
    const resolvedArgv = resolvePackageManagerArgv(argv);
    return new Promise<CommandRunResult>((resolve, reject) => {
      const child = spawn(resolvedArgv[0]!, resolvedArgv.slice(1), {
        cwd: options.cwd,
        env: options.env ?? process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
    });
  },
};
