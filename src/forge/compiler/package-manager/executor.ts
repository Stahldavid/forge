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
    const proc = Bun.spawn(argv, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { exitCode, stdout, stderr };
  },
};
