import type { AddOptions, InspectTarget, VerifyOptions } from "../compiler/types/cli.ts";
import type { SandboxBackend } from "../compiler/types/runtime.ts";
import type { DbAdapterKind } from "../runtime/db/adapter.ts";
import type { DbSubcommand } from "./db.ts";
import type { OutboxSubcommand } from "./outbox.ts";
import type { WorkflowSubcommand } from "./workflow.ts";
import type { TelemetrySubcommand } from "./telemetry.ts";

export type ForgeCommand =
  | { kind: "generate"; check: boolean; dryRun: boolean; json: boolean; concurrency: number }
  | { kind: "add"; alias: string; options: AddOptions & { workspaceRoot: string } }
  | { kind: "inspect"; target: InspectTarget; json: boolean; dryRun: boolean }
  | { kind: "check"; json: boolean; dryRun: boolean }
  | { kind: "verify"; options: VerifyOptions }
  | { kind: "run"; name?: string; list: boolean; json: boolean; mock: boolean; workspaceRoot: string }
  | {
      kind: "dev";
      host?: string;
      port?: number;
      mock: boolean;
      watch: boolean;
      json: boolean;
      db: "pglite" | "postgres" | "none";
      databaseUrl?: string;
      worker: boolean;
      telemetry: string[];
      workspaceRoot: string;
    }
  | {
      kind: "db";
      subcommand: DbSubcommand;
      db: DbAdapterKind;
      databaseUrl?: string;
      json: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "outbox";
      subcommand: OutboxSubcommand;
      db: DbAdapterKind;
      databaseUrl?: string;
      json: boolean;
      once: boolean;
      watch: boolean;
      limit?: number;
      deliveryId?: number;
      mock: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "workflow";
      subcommand: WorkflowSubcommand;
      db: DbAdapterKind;
      databaseUrl?: string;
      json: boolean;
      once: boolean;
      watch: boolean;
      limit?: number;
      workflowName?: string;
      runId?: number;
      stepName?: string;
      input?: unknown;
      mock: boolean;
      workspaceRoot: string;
    }
  | {
      kind: "telemetry";
      subcommand: TelemetrySubcommand;
      db: DbAdapterKind;
      databaseUrl?: string;
      json: boolean;
      traceId?: string;
      sink?: string;
      file?: "events" | "exceptions" | "spans";
      workspaceRoot: string;
    };

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
  "runtime",
  "dev",
  "subscriptions",
  "workflows",
  "telemetry",
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

function parseDbKind(value: string | undefined): "pglite" | "postgres" | "none" {
  if (value === "postgres" || value === "none") {
    return value;
  }
  return "pglite";
}

function parseAdapterKind(value: string | undefined): DbAdapterKind {
  if (value === "postgres" || value === "memory") {
    return value;
  }
  return "pglite";
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
    errors.push(
      "missing command; expected generate, add, inspect, check, verify, run, dev, db, outbox, workflow, or telemetry",
    );
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
    case "run": {
      const name = rest[0];
      const list = parseFlag(argv, "--list") || !name;
      return {
        command: {
          kind: "run",
          name,
          list,
          json: parseFlag(argv, "--json"),
          mock: parseFlag(argv, "--mock"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "dev": {
      const portRaw = parseOptionValue(argv, "--port");
      const port = portRaw !== undefined ? Number(portRaw) : undefined;
      if (portRaw !== undefined && (!Number.isFinite(port) || port! < 0)) {
        errors.push("--port must be a non-negative integer");
      }
      return {
        command: {
          kind: "dev",
          host: parseOptionValue(argv, "--host"),
          port,
          mock: parseFlag(argv, "--mock"),
          watch: parseFlag(argv, "--watch"),
          json: parseFlag(argv, "--json"),
          db: parseDbKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          worker: parseFlag(argv, "--worker"),
          telemetry: (parseOptionValue(argv, "--telemetry") ?? "local")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "db": {
      const subcommand = rest[0] as DbSubcommand | undefined;
      if (!subcommand || !["diff", "migrate", "reset", "status"].includes(subcommand)) {
        errors.push("forge db requires subcommand: diff, migrate, reset, or status");
        return { command: null, workspaceRoot, errors };
      }
      return {
        command: {
          kind: "db",
          subcommand,
          db: parseAdapterKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          json: parseFlag(argv, "--json"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "workflow": {
      const subcommand = rest[0] as WorkflowSubcommand | undefined;
      if (
        !subcommand ||
        !["list", "run", "inspect", "process", "retry", "cancel"].includes(subcommand)
      ) {
        errors.push(
          "forge workflow requires subcommand: list, run, inspect, process, retry, or cancel",
        );
        return { command: null, workspaceRoot, errors };
      }

      const limitRaw = parseOptionValue(argv, "--limit");
      const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
      if (limitRaw !== undefined && (!Number.isFinite(limit) || limit! < 1)) {
        errors.push("--limit must be an integer >= 1");
      }

      const inputRaw = parseOptionValue(argv, "--input");
      let input: unknown;
      if (inputRaw !== undefined) {
        try {
          input = JSON.parse(inputRaw);
        } catch {
          errors.push("--input must be valid JSON");
        }
      }

      const stepName = parseOptionValue(argv, "--step");
      let runId: number | undefined;
      let workflowName: string | undefined;

      if (subcommand === "run") {
        workflowName = rest[1];
        if (!workflowName) {
          errors.push("forge workflow run requires a workflow name");
        }
      } else if (["inspect", "retry", "cancel"].includes(subcommand)) {
        const runIdRaw = rest[1];
        runId = runIdRaw !== undefined ? Number(runIdRaw) : undefined;
        if (runIdRaw !== undefined && !Number.isFinite(runId)) {
          errors.push("run id must be a number");
        }
        if (!runIdRaw) {
          errors.push(`forge workflow ${subcommand} requires a run id`);
        }
      }

      return {
        command: {
          kind: "workflow",
          subcommand,
          db: parseAdapterKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          json: parseFlag(argv, "--json"),
          once: parseFlag(argv, "--once"),
          watch: parseFlag(argv, "--watch"),
          limit,
          workflowName,
          runId,
          stepName,
          input,
          mock: parseFlag(argv, "--mock"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "outbox": {
      const subcommand = rest[0] as OutboxSubcommand | undefined;
      if (
        !subcommand ||
        !["list", "process", "retry", "dead", "clear"].includes(subcommand)
      ) {
        errors.push(
          "forge outbox requires subcommand: list, process, retry, dead, or clear",
        );
        return { command: null, workspaceRoot, errors };
      }

      const limitRaw = parseOptionValue(argv, "--limit");
      const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
      if (limitRaw !== undefined && (!Number.isFinite(limit) || limit! < 1)) {
        errors.push("--limit must be an integer >= 1");
      }

      const deliveryIdRaw = subcommand === "retry" ? rest[1] : undefined;
      const deliveryId =
        deliveryIdRaw !== undefined ? Number(deliveryIdRaw) : undefined;
      if (deliveryIdRaw !== undefined && !Number.isFinite(deliveryId)) {
        errors.push("delivery id must be a number");
      }

      return {
        command: {
          kind: "outbox",
          subcommand,
          db: parseAdapterKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          json: parseFlag(argv, "--json"),
          once: parseFlag(argv, "--once"),
          watch: parseFlag(argv, "--watch"),
          limit,
          deliveryId,
          mock: parseFlag(argv, "--mock"),
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
    case "telemetry": {
      const subcommand = rest[0] as TelemetrySubcommand | undefined;
      if (
        !subcommand ||
        !["list", "inspect", "flush", "tail", "clear"].includes(subcommand)
      ) {
        errors.push(
          "forge telemetry requires subcommand: list, inspect, flush, tail, or clear",
        );
        return { command: null, workspaceRoot, errors };
      }

      let traceId: string | undefined;
      if (subcommand === "inspect") {
        traceId = rest[1];
        if (!traceId) {
          errors.push("forge telemetry inspect requires a trace id");
        }
      }

      return {
        command: {
          kind: "telemetry",
          subcommand,
          db: parseAdapterKind(parseOptionValue(argv, "--db")),
          databaseUrl: parseOptionValue(argv, "--database-url"),
          json: parseFlag(argv, "--json"),
          traceId,
          sink: parseOptionValue(argv, "--sink"),
          file: parseOptionValue(argv, "--file") as "events" | "exceptions" | "spans" | undefined,
          workspaceRoot,
        },
        workspaceRoot,
        errors,
      };
    }
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
    "--mock",
    "--list",
    "--port",
    "--host",
    "--watch",
    "--db",
    "--database-url",
    "--worker",
    "--once",
    "--limit",
    "--input",
    "--step",
    "--sink",
    "--file",
  ]);

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
      if (known.has(arg)) {
      if (
        arg === "--concurrency" ||
        arg === "--sandbox-backend" ||
        arg === "--port" ||
        arg === "--host" ||
        arg === "--db" ||
        arg === "--database-url" ||
        arg === "--limit" ||
        arg === "--input" ||
        arg === "--step" ||
        arg === "--sink" ||
        arg === "--file" ||
        arg === "--telemetry"
      ) {
        index += 1;
      }
      continue;
    }
    return arg;
  }

  return null;
}
