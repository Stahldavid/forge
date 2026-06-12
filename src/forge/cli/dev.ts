import { run } from "../compiler/orchestrator/run.ts";
import { join } from "node:path";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import type { FrontendGraph } from "../compiler/types/frontend-graph.ts";
import { resolveBunExecutable } from "./bun-exec.ts";
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
  withWeb?: boolean;
  apiOnly?: boolean;
  webOnly?: boolean;
  open?: boolean;
  webPort?: number;
  telemetry: string[];
  envFile?: string;
  mode?: "dev" | "serve";
  allowDevAuth?: boolean;
}

export interface DevCommandResult {
  handle?: DevServerHandle;
  web?: WebDevServerHandle;
  exitCode: 0 | 1;
}

interface WebDevServerHandle {
  url: string;
  port: number;
  command: string[];
  stop: () => void;
}

interface DevStartupSummary {
  schemaVersion: "0.1.0";
  ok: true;
  mode: "dev";
  api: {
    url: string;
    host: string;
    port: number;
    db: { kind: string; connected: boolean };
    worker: "running" | "stopped";
  };
  web: null | {
    url: string;
    port: number;
    command: string[];
    framework: string;
    routes: string[];
    bridgeFiles: string[];
    apiUrlEnv?: string;
  };
  watch: {
    enabled: boolean;
  };
  runtime: {
    routes: Array<{ method: string; path: string; purpose: string }>;
  };
  frontend: {
    present: boolean;
    framework: string;
    routes: string[];
    bindings: string[];
    bridgeFiles: string[];
    diagnostics: number;
  };
  next: {
    browserUrl: string;
    apiIndex: string;
    inspect: string;
    verify: string;
  };
  pid: number;
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  try {
    return JSON.parse(stripDeterministicHeader(nodeFileSystem.readText(absolute) ?? "")) as T;
  } catch {
    return null;
  }
}

function readPackageJson(workspaceRoot: string): { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null {
  const path = join(workspaceRoot, "web", "package.json");
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  try {
    return JSON.parse(nodeFileSystem.readText(path) ?? "{}") as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  } catch {
    return null;
  }
}

function detectDefaultWebPort(workspaceRoot: string): number {
  const pkg = readPackageJson(workspaceRoot);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  return deps.next ? 3000 : 5173;
}

function webDevArgsForPackage(
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null,
  input: { host: string; port: number },
): string[] {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (deps.next) {
    return ["--port", String(input.port), "--hostname", input.host];
  }
  return ["--port", String(input.port), "--host", input.host];
}

function hasWebApp(workspaceRoot: string): boolean {
  return (
    nodeFileSystem.exists(join(workspaceRoot, "web", "package.json")) ||
    nodeFileSystem.exists(join(workspaceRoot, "web", "server.ts"))
  );
}

function startWebDevServer(input: {
  workspaceRoot: string;
  host: string;
  port: number;
  apiUrl: string;
  json: boolean;
}): WebDevServerHandle | null {
  const webRoot = join(input.workspaceRoot, "web");
  if (!hasWebApp(input.workspaceRoot)) {
    return null;
  }

  const pkg = readPackageJson(input.workspaceRoot);
  const bun = resolveBunExecutable();
  const env = {
    ...Bun.env,
    PORT: String(input.port),
    NEXT_PUBLIC_FORGE_URL: input.apiUrl,
    VITE_FORGE_URL: input.apiUrl,
  };
  const command =
    pkg?.scripts?.dev
      ? [bun, "run", "dev", "--", ...webDevArgsForPackage(pkg, input)]
      : [bun, "server.ts"];
  const cwd = pkg?.scripts?.dev ? webRoot : webRoot;
  const child = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: input.json ? "pipe" : "inherit",
    stderr: input.json ? "pipe" : "inherit",
    env,
  });
  return {
    url: `http://${input.host}:${input.port}`,
    port: input.port,
    command,
    stop: () => {
      try {
        child.kill();
      } catch {
        // Process may already have exited.
      }
    },
  };
}

function buildStartupSummary(input: {
  workspaceRoot: string;
  handle: DevServerHandle;
  web?: WebDevServerHandle | null;
  watch: boolean;
}): DevStartupSummary {
  const frontend = readGeneratedJson<FrontendGraph>(
    input.workspaceRoot,
    `${GENERATED_DIR}/frontendGraph.json`,
  );
  const bindings = frontend
    ? [...new Set(frontend.clientBindings.map((binding) => `${binding.kind}:${binding.name}`))].sort()
    : [];
  const browserUrl = input.web?.url ?? input.handle.url;
  return {
    schemaVersion: "0.1.0",
    ok: true,
    mode: "dev",
    api: {
      url: input.handle.url,
      host: input.handle.host,
      port: input.handle.port,
      db: input.handle.state.db,
      worker: input.handle.outboxWorker?.isRunning() ? "running" : "stopped",
    },
    web: input.web
      ? {
          url: input.web.url,
          port: input.web.port,
          command: input.web.command,
          framework: frontend?.framework ?? "unknown",
          routes: frontend?.routes.map((route) => route.path) ?? [],
          bridgeFiles: frontend?.bridgeFiles ?? [],
          ...(frontend?.dev?.apiUrlEnv ? { apiUrlEnv: frontend.dev.apiUrlEnv } : {}),
        }
      : null,
    watch: {
      enabled: input.watch,
    },
    runtime: {
      routes: input.handle.routes.map((route) => ({
        method: route.method,
        path: route.path,
        purpose: route.purpose,
      })),
    },
    frontend: {
      present: frontend?.present ?? false,
      framework: frontend?.framework ?? "none",
      routes: frontend?.routes.map((route) => route.path) ?? [],
      bindings,
      bridgeFiles: frontend?.bridgeFiles ?? [],
      diagnostics: frontend?.diagnostics.length ?? 0,
    },
    next: {
      browserUrl,
      apiIndex: input.handle.url,
      inspect: "forge inspect all --json",
      verify: "forge dev --once --json",
    },
    pid: process.pid,
  };
}

function printStartupJson(summary: DevStartupSummary): void {
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

function printStartupHuman(summary: DevStartupSummary): void {
  const lines = ["Forge Dev", ""];
  lines.push("API runtime");
  lines.push(`  URL: ${summary.api.url}`);
  lines.push(`  DB: ${summary.api.db.kind} ${summary.api.db.connected ? "connected" : "not connected"}`);
  lines.push(`  Worker: ${summary.api.worker}`);
  lines.push(`  Watch: ${summary.watch.enabled ? "on" : "off"}`);
  lines.push("");

  lines.push("Web app");
  if (summary.web) {
    lines.push(`  URL: ${summary.web.url}`);
    lines.push(`  Framework: ${summary.web.framework}`);
    lines.push(`  API env: ${summary.web.apiUrlEnv ?? "unknown"}=${summary.api.url}`);
    lines.push(`  Bridge: ${summary.web.bridgeFiles.length > 0 ? summary.web.bridgeFiles.join(", ") : "missing"}`);
    lines.push(`  Routes: ${summary.web.routes.length > 0 ? summary.web.routes.join(", ") : "none detected"}`);
  } else {
    lines.push("  none detected; running API only");
  }
  lines.push("");

  lines.push("Runtime endpoints");
  for (const route of summary.runtime.routes.slice(0, 16)) {
    lines.push(`  ${route.method.padEnd(4)} ${route.path}  ${route.purpose}`);
  }
  if (summary.runtime.routes.length > 16) {
    lines.push(`  ... ${summary.runtime.routes.length - 16} more`);
  }
  lines.push("");

  lines.push("Open");
  lines.push(`  Browser: ${summary.next.browserUrl}`);
  lines.push(`  API index: ${summary.next.apiIndex}`);
  lines.push("");
  lines.push("Agent checks");
  lines.push(`  ${summary.next.verify}`);
  lines.push(`  ${summary.next.inspect}`);
  lines.push("");

  process.stdout.write(`${lines.join("\n")}\n`);
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const command =
    platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : platform === "darwin"
        ? ["open", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(command, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {
    // Opening a browser is best-effort; dev server startup should not fail.
  }
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
  const webPort = options.webPort ?? detectDefaultWebPort(workspaceRoot);
  const shouldStartWeb =
    options.webOnly === true ||
    (options.withWeb !== false && !options.apiOnly && hasWebApp(workspaceRoot));
  const webUrl = shouldStartWeb ? `http://${host}:${webPort}` : undefined;

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

  if (options.webOnly) {
    const apiUrl = `http://${host}:${port}`;
    const webHandle = startWebDevServer({
      workspaceRoot,
      host,
      port: webPort,
      apiUrl,
      json: options.json,
    });
    if (!webHandle) {
      const message = "web-only requested but no web app was found";
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ ok: false, error: message, exitCode: 1 })}\n`);
      } else {
        console.error(`error: ${message}`);
      }
      return { exitCode: 1 };
    }
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          host,
          port,
          routes: [],
          web: {
            url: webHandle.url,
            port: webHandle.port,
            command: webHandle.command,
          },
          api: {
            url: apiUrl,
            running: false,
          },
          pid: process.pid,
        })}\n`,
      );
    } else {
      process.stdout.write(`forge web listening on ${webHandle.url}\n`);
      process.stdout.write(`forge api expected at ${apiUrl}\n`);
    }
    if (options.open) {
      openBrowser(webHandle.url);
    }
    await new Promise<void>((resolve) => {
      const shutdown = () => {
        webHandle.stop();
        resolve();
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
    return { web: webHandle, exitCode: 0 };
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
      webUrl,
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

  const webHandle = !shouldStartWeb
    ? null
    : startWebDevServer({
        workspaceRoot,
        host,
        port: webPort,
        apiUrl: handle.url,
        json: options.json,
      });

  const startupSummary = buildStartupSummary({
    workspaceRoot,
    handle,
    web: webHandle,
    watch: options.watch,
  });
  if (options.json) {
    printStartupJson(startupSummary);
  } else {
    printStartupHuman(startupSummary);
  }
  if (options.open) {
    openBrowser(webHandle?.url ?? handle.url);
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
      webHandle?.stop();
      handle.stop();
      resolve();
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

  return { handle, web: webHandle ?? undefined, exitCode: 0 };
}
