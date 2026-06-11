import { run } from "../compiler/orchestrator/run.ts";
import {
  formatDevConsoleHuman,
  formatDevConsoleJson,
  runDevConsoleCycle,
} from "../dev-console/cycle.ts";
import {
  resolveDevHost,
  resolveDevPort,
  startDevServer,
} from "../dev/server.ts";
import { startDevWatch } from "../dev/watch.ts";
import type { DevServerHandle } from "../dev/types.ts";

export interface DevCommandOptions {
  workspaceRoot: string;
  host?: string;
  port?: number;
  mock: boolean;
  mockAi?: boolean;
  once?: boolean;
  watch: boolean;
  json: boolean;
  db: "pglite" | "postgres" | "none";
  databaseUrl?: string;
  worker: boolean;
  telemetry: string[];
  envFile?: string;
  mode?: "dev" | "serve";
  allowDevAuth?: boolean;
}

export interface DevCommandResult {
  handle?: DevServerHandle;
  exitCode: 0 | 1;
}

function printStartupJson(handle: DevServerHandle): void {
  process.stdout.write(
    `${JSON.stringify({
      host: handle.host,
      port: handle.port,
      routes: handle.routes,
      pid: process.pid,
    })}\n`,
  );
}

function printStartupHuman(handle: DevServerHandle): void {
  process.stdout.write(`forge dev listening on ${handle.url}\n`);
}

export async function runDevCommand(
  options: DevCommandOptions,
): Promise<DevCommandResult> {
  const workspaceRoot = options.workspaceRoot.replace(/\\/g, "/");

  if (options.once) {
    const cycle = await runDevConsoleCycle({
      workspaceRoot,
      mode: "once",
      strictSecrets: true,
      includeImpact: true,
    });
    process.stdout.write(options.json ? formatDevConsoleJson(cycle) : formatDevConsoleHuman(cycle));
    return { exitCode: cycle.exitCode };
  }

  const host = resolveDevHost(options.host);
  const port = resolveDevPort(options.port);

  const startupCycle = await runDevConsoleCycle({
    workspaceRoot,
    mode: "startup",
    strictSecrets: false,
    includeImpact: true,
  });
  if (options.json) {
    process.stdout.write(formatDevConsoleJson(startupCycle));
  } else {
    process.stdout.write(formatDevConsoleHuman(startupCycle));
  }

  let handle: DevServerHandle;
  try {
    handle = await startDevServer({
      workspaceRoot,
      host,
      port,
      mock: options.mock,
      mockAi: options.mockAi,
      json: options.json,
      db: options.db,
      databaseUrl: options.databaseUrl,
      worker: options.worker,
      telemetry: options.telemetry,
      envFile: options.envFile,
      mode: options.mode,
      allowDevAuth: options.allowDevAuth,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "failed to start dev server";
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: message, exitCode: 1 })}\n`,
      );
    } else {
      console.error(`error: ${message}`);
    }
    return { exitCode: 1 };
  }

  if (options.json) {
    printStartupJson(handle);
  } else {
    printStartupHuman(handle);
  }

  let watchHandle: { stop: () => void } | null = null;
  let outboxWorkerHandle: { stop: () => void } | null = null;

  if (options.worker && handle.outboxWorker) {
    outboxWorkerHandle = handle.outboxWorker;
  }

  if (options.watch) {
    watchHandle = startDevWatch(workspaceRoot, async (changedCount) => {
      const result = await run({
        workspaceRoot,
        check: false,
        dryRun: false,
        json: false,
        concurrency: 2,
      });

      if (result.exitCode === 0) {
        if (!options.json) {
          process.stdout.write(
            `[forge dev] regenerated (${changedCount} changed files)\n`,
          );
        }
      } else if (!options.json) {
        for (const diagnostic of result.errors) {
          console.error(`error ${diagnostic.code}: ${diagnostic.message}`);
        }
      }

      const cycle = await runDevConsoleCycle({
        workspaceRoot,
        mode: "watch",
        strictSecrets: false,
        includeImpact: true,
      });
      if (options.json) {
        process.stdout.write(formatDevConsoleJson(cycle));
      } else {
        process.stdout.write(formatDevConsoleHuman(cycle));
      }
    });
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      watchHandle?.stop();
      outboxWorkerHandle?.stop();
      handle.stop();
      resolve();
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

  return { handle, exitCode: 0 };
}
