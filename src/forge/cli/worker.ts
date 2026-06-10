import type { DbAdapterKind } from "../runtime/db/adapter.ts";
import { runOutboxCommand } from "./outbox.ts";
import { runWorkflowCommand } from "./workflow.ts";

export interface WorkerCommandOptions {
  workspaceRoot: string;
  db: DbAdapterKind;
  databaseUrl?: string;
  json: boolean;
  once: boolean;
  pollIntervalMs: number;
  limit: number;
  mock: boolean;
}

export interface WorkerCommandResult {
  ok: boolean;
  exitCode: 0 | 1;
  data?: unknown;
}

async function runWorkerTick(options: WorkerCommandOptions): Promise<WorkerCommandResult> {
  const outbox = await runOutboxCommand({
    subcommand: "process",
    workspaceRoot: options.workspaceRoot,
    db: options.db,
    databaseUrl: options.databaseUrl,
    json: options.json,
    limit: options.limit,
    mock: options.mock,
  });

  if (outbox.exitCode !== 0) {
    return { ok: false, exitCode: 1, data: { outbox } };
  }

  const workflows = await runWorkflowCommand({
    subcommand: "process",
    workspaceRoot: options.workspaceRoot,
    db: options.db,
    databaseUrl: options.databaseUrl,
    json: options.json,
    once: true,
    limit: options.limit,
    mock: options.mock,
  });

  if (workflows.exitCode !== 0) {
    return { ok: false, exitCode: 1, data: { outbox, workflows } };
  }

  return { ok: true, exitCode: 0, data: { outbox: outbox.data, workflows: workflows.data } };
}

export async function runWorkerCommand(
  options: WorkerCommandOptions,
): Promise<WorkerCommandResult> {
  if (options.once) {
    const tick = await runWorkerTick(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(tick)}\n`);
    } else if (tick.ok) {
      process.stdout.write("worker tick complete\n");
    }
    return tick;
  }

  let running = true;
  const shutdown = () => {
    running = false;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  while (running) {
    const tick = await runWorkerTick(options);
    if (!tick.ok) {
      return tick;
    }
    if (!options.json) {
      process.stdout.write("worker tick complete\n");
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
  }

  return { ok: true, exitCode: 0 };
}
