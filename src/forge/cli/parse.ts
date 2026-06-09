import type { AddOptions, InspectTarget, VerifyOptions } from "../compiler/types/cli.ts";
import type { SandboxBackend } from "../compiler/types/runtime.ts";

export type ForgeCommand =
  | { kind: "generate"; check: boolean; dryRun: boolean; json: boolean; concurrency: number }
  | { kind: "add"; alias: string; options: AddOptions & { workspaceRoot: string } }
  | { kind: "inspect"; target: InspectTarget; json: boolean; dryRun: boolean }
  | { kind: "check"; json: boolean; dryRun: boolean }
  | { kind: "verify"; options: VerifyOptions };

export interface ParsedCli {
  command: ForgeCommand | null;
  workspaceRoot: string;
  errors: string[];
}

const INSPECT_TARGETS: InspectTarget[] = [
  "app",
  "packages",
  "capabilities",
  "runtime-matrix",
  "data",
];

function parseFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseOptionValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  return args[index + 1];
}

function parseSandboxBackend(value: string | undefined): SandboxBackend {
  if (value === "child" || value === "docker" || value === "none") {
    return value;
  }
  return "none";
}

function parseAddOptions(
  args: string[],
  workspaceRoot: string,
): AddOptions & { workspaceRoot: string } {
  return {
    workspaceRoot,
    json: parseFlag(args, "--json"),
    dryRun: parseFlag(args, "--dry-run"),
    runtimeInspect: parseFlag(args, "--runtime-inspect"),
    sandboxBackend: parseSandboxBackend(
      parseOptionValue(args, "--sandbox-backend"),
    ),
    allowScripts: parseFlag(args, "--allow-scripts"),
  };
}

export function parseCli(argv: string[]): ParsedCli {
  const errors: string[] = [];
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const workspaceRoot = process.cwd().replace(/\\/g, "/");

  if (positional.length === 0) {
    errors.push("missing command; expected generate, add, inspect, check, or verify");
    return { command: null, workspaceRoot, errors };
  }

  const [commandName, ...rest] = positional;

  switch (commandName) {
    case "generate": {
      const concurrencyRaw = parseOptionValue(argv, "--concurrency");
      const concurrency = concurrencyRaw ? Number(concurrencyRaw) : 4;
      if (!Number.isFinite(concurrency) || concurrency < 1) {
        errors.push("--concurrency must be an integer >= 1");
      }
      return {
        command: {
          kind: "generate",
          check: parseFlag(argv, "--check"),
          dryRun: parseFlag(argv, "--dry-run"),
          json: parseFlag(argv, "--json"),
          concurrency: Math.max(1, Math.floor(concurrency || 4)),
        },
        workspaceRoot,
        errors,
      };
    }
    case "add": {
      const alias = rest[0];
      if (!alias) {
        errors.push("forge add requires an integration alias");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "add",
          alias,
          options: parseAddOptions(argv, workspaceRoot),
        },
        workspaceRoot,
        errors,
      };
    }
    case "inspect": {
      const target = rest[0] as InspectTarget | undefined;
      if (!target || !INSPECT_TARGETS.includes(target)) {
        errors.push(
          `unsupported inspect target; supported: ${INSPECT_TARGETS.join(", ")}`,
        );
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "inspect",
          target,
          json: parseFlag(argv, "--json"),
          dryRun: parseFlag(argv, "--dry-run"),
        },
        workspaceRoot,
        errors,
      };
    }
    case "check":
      return {
        command: {
          kind: "check",
          json: parseFlag(argv, "--json"),
          dryRun: parseFlag(argv, "--dry-run"),
        },
        workspaceRoot,
        errors,
      };
    case "verify":
      return {
        command: {
          kind: "verify",
          options: {
            workspaceRoot,
            json: parseFlag(argv, "--json"),
            skipTests: parseFlag(argv, "--skip-tests"),
            skipTypecheck: parseFlag(argv, "--skip-typecheck"),
            skipEslint: parseFlag(argv, "--skip-eslint"),
          },
        },
        workspaceRoot,
        errors,
      };
    default:
      errors.push(`unrecognized command '${commandName}'`);
      return { command: null, workspaceRoot, errors };
  }
}

export function hasUnknownOption(argv: string[]): string | null {
  const known = new Set([
    "--check",
    "--json",
    "--dry-run",
    "--runtime-inspect",
    "--allow-scripts",
    "--concurrency",
    "--sandbox-backend",
    "--skip-tests",
    "--skip-typecheck",
    "--skip-eslint",
  ]);

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    if (known.has(arg)) {
      if (arg === "--concurrency" || arg === "--sandbox-backend") {
        index += 1;
      }
      continue;
    }
    return arg;
  }

  return null;
}
