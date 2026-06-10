import { existsSync } from "node:fs";
import { runGenerateCommand } from "./commands.ts";
import { runDevCommand } from "./dev.ts";

export interface ServeCommandOptions {
  workspaceRoot: string;
  host?: string;
  port?: number;
  databaseUrl?: string;
  json: boolean;
  envFile?: string;
}

export async function runServeCommand(options: ServeCommandOptions): Promise<number> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    const message = "forge serve requires DATABASE_URL or --database-url";
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: message, exitCode: 1 })}\n`);
    } else {
      console.error(`error: ${message}`);
    }
    return 1;
  }

  const generatedCheck = await runGenerateCommand({
    workspaceRoot: options.workspaceRoot,
    check: true,
    dryRun: false,
    json: false,
    concurrency: 4,
  });
  if (generatedCheck.exitCode !== 0) {
    if (!options.json) {
      console.error("error: generated artifacts are stale; run forge generate");
    }
    return 1;
  }

  if (!existsSync(`${options.workspaceRoot}/forge.lock`)) {
    if (!options.json) {
      console.error("error: missing forge.lock; run forge generate");
    }
    return 1;
  }

  const result = await runDevCommand({
    workspaceRoot: options.workspaceRoot,
    host: options.host ?? "0.0.0.0",
    port: options.port ?? 3765,
    mock: false,
    mockAi: false,
    watch: false,
    json: options.json,
    db: "postgres",
    databaseUrl,
    worker: false,
    telemetry: ["local"],
    envFile: options.envFile,
    mode: "serve",
  });

  return result.exitCode;
}
