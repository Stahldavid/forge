import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
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
  return resolveCommandArgv(argv, bunOptions);
}

export function resolveCommandArgv(
  argv: string[],
  bunOptions?: BunExecutableResolutionOptions,
): string[] {
  if (argv[0]?.toLowerCase() === "bun" || argv[0]?.toLowerCase() === "bun.exe") {
    return [resolveBunExecutable(bunOptions), ...argv.slice(1)];
  }

  const command = argv[0];
  if (command && process.platform === "win32") {
    return [resolveWindowsCommand(command), ...argv.slice(1)];
  }

  return argv;
}

function resolveWindowsCommand(command: string): string {
  if (
    command.includes("\\") ||
    command.includes("/") ||
    isAbsolute(command) ||
    /\.[a-z0-9]+$/i.test(command)
  ) {
    return command;
  }

  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = [".exe", ".cmd", ".bat", ""];
  for (const dir of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(dir, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return command;
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

function quoteWindowsShellArg(arg: string): string {
  if (/^[a-zA-Z0-9@._/:=-]+$/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/(["^&|<>])/g, "^$1")}"`;
}

function spawnArgvForWindowsScript(originalArgv: string[], resolvedArgv: string[]): string[] {
  const originalCommand = originalArgv[0] ?? resolvedArgv[0]!;
  const command =
    originalCommand.includes("\\") ||
    originalCommand.includes("/") ||
    isAbsolute(originalCommand)
      ? resolvedArgv[0]!
      : originalCommand;
  const commandPart = command === originalCommand ? command : quoteWindowsShellArg(command);
  const args = originalArgv.slice(1).map(quoteWindowsShellArg).join(" ");
  return [
    process.env.ComSpec ?? "cmd.exe",
    "/d",
    "/c",
    `${commandPart}${args ? ` ${args}` : ""}`,
  ];
}

export const defaultCommandExecutor: CommandExecutor = {
  async run(argv, options) {
    const resolvedArgv = resolvePackageManagerArgv(argv);
    const spawnArgv =
      process.platform === "win32" && /\.(?:cmd|bat)$/i.test(resolvedArgv[0] ?? "")
        ? spawnArgvForWindowsScript(argv, resolvedArgv)
        : resolvedArgv;
    return new Promise<CommandRunResult>((resolve, reject) => {
      const child = spawn(spawnArgv[0]!, spawnArgv.slice(1), {
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
