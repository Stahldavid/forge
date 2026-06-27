import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { run } from "../compiler/orchestrator/run.ts";
import { basename, join } from "node:path";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import type { FrontendGraph } from "../compiler/types/frontend-graph.ts";
import { detectPackageManager } from "../compiler/package-manager/detect.ts";
import { resolvePackageManagerArgv } from "../compiler/package-manager/executor.ts";
import {
  formatDevConsoleHuman,
  formatDevConsoleJson,
  runDevConsoleCycle,
} from "../dev-console/cycle.ts";
import type {
  DevConsoleAgentContext,
  DevConsoleCycle,
  DevConsoleGeneratedSummary,
  DevConsoleSummary,
} from "../dev-console/types.ts";
import {
  resolveDevHost,
  resolveDevPort,
  startDevServer,
} from "../dev/server.ts";
import { startDevWatch } from "../dev/watch.ts";
import type { DevServerHandle } from "../dev/types.ts";
import { createAmbientDeltaRecorder } from "../delta/index.ts";
import { resetCompileSessions } from "../compiler/orchestrator/session.ts";
import { FORGE_PGLITE_STORE_ABORTED } from "../compiler/diagnostics/codes.ts";
import { isPgliteAbortMessage } from "../runtime/db/pglite-adapter.ts";
import { forgeCliCommandForWorkspace, forgeCliCommandsForWorkspace } from "../workspace/forge-cli.ts";
import { writeLastRunRecord } from "./last-run.ts";

export interface DevCommandOptions {
  workspaceRoot: string;
  host?: string;
  port?: number;
  mock: boolean;
  mockAi?: boolean;
  once?: boolean;
  watch: boolean;
  json: boolean;
  db: "memory" | "pglite" | "postgres" | "none";
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
  skipStartupConsole?: boolean;
  detach?: boolean;
  lifecycle?: "status" | "stop";
}

export interface DevCommandResult {
  handle?: DevServerHandle;
  web?: WebDevServerHandle;
  exitCode: 0 | 1;
}

export interface DevGenerateResult {
  ok: boolean;
  changed: string[];
  unchanged: string[];
  diagnostics: Array<{ severity: string; code: string; message: string }>;
  exitCode: 0 | 1;
}

interface DevStartupGeneratedEvidence {
  ok: boolean;
  state: "fresh" | "regenerated" | "stale-risk";
  changedFiles: number;
  sampleChanged: string[];
  hiddenChanged: number;
  message: string;
  command: string;
  checkCommand: string;
}

interface WebDevServerHandle {
  url: string;
  port: number;
  requestedPort?: number;
  autoPortSelected: boolean;
  command: string[];
  stop: () => void;
}

interface DevStartupSummary {
  schemaVersion: "0.1.0";
  ok: true;
  mode: "dev";
  warnings: Array<{ code: string; message: string; nextAction?: string }>;
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
    requestedPort?: number;
    autoPortSelected: boolean;
    command: string[];
    framework: string;
    routes: string[];
    bridgeFiles: string[];
    apiUrlEnv?: string;
  };
  preview: {
    studioUrl?: string;
    targetAppUrl: string;
    targetAppPort: number;
    isStudioSelfPreview: boolean;
    note: string;
  };
  watch: {
    enabled: boolean;
    autoGenerate: boolean;
    reloadsRuntime: boolean;
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
  generated: {
    state: "fresh" | "regenerated" | "stale-risk";
    generatorVersion?: string;
    inputHash?: string;
    buildInfoHash?: string;
    runtimeLoadedHash?: string;
    runtimeStaleRisk: boolean;
    changedFiles: number;
    sampleChanged: string[];
    hiddenChanged: number;
    command: string;
    checkCommand: string;
    message: string;
  };
  next: {
    browserUrl: string;
    apiIndex: string;
    inspect: string;
    verify: string;
  };
  pid: number;
}

interface DevStartFailure {
  message: string;
  code?: string;
  failureKind: "port_busy" | "pglite_store_aborted" | "dev_start_failed";
  nextActions: string[];
  busy?: {
    port: number;
    host: string;
    suggestedCommands: string[];
  };
}

const DEV_STATE_DIR = ".forge/dev";
const DEV_PID_FILE = `${DEV_STATE_DIR}/dev.pid`;
const DEV_LOG_FILE = `${DEV_STATE_DIR}/dev.log`;

function devStatePaths(workspaceRoot: string): { dir: string; pidFile: string; logFile: string } {
  return {
    dir: join(workspaceRoot, DEV_STATE_DIR),
    pidFile: join(workspaceRoot, DEV_PID_FILE),
    logFile: join(workspaceRoot, DEV_LOG_FILE),
  };
}

function readDetachedDevPid(workspaceRoot: string): number | null {
  const text = nodeFileSystem.readText(devStatePaths(workspaceRoot).pidFile);
  if (text === null) {
    return null;
  }
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function removeDevPidFile(workspaceRoot: string): void {
  const paths = devStatePaths(workspaceRoot);
  if (nodeFileSystem.exists(paths.pidFile)) {
    nodeFileSystem.remove(paths.pidFile);
  }
}

function printDevLifecycleResult(input: {
  options: DevCommandOptions;
  ok: boolean;
  action: "detach" | "status" | "stop";
  running: boolean;
  pid?: number;
  logFile: string;
  message: string;
  exitCode: 0 | 1;
}): DevCommandResult {
  const payload = {
    ok: input.ok,
    action: input.action,
    running: input.running,
    ...(input.pid !== undefined ? { pid: input.pid } : {}),
    logFile: input.logFile,
    message: input.message,
    nextActions: input.running
      ? ["forge dev status --json", "forge dev stop --json", `tail -f ${input.logFile}`]
      : ["forge dev --detach --json"],
    exitCode: input.exitCode,
  };
  if (input.options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${input.message}\n`);
    if (input.pid !== undefined) process.stdout.write(`pid: ${input.pid}\n`);
    process.stdout.write(`log: ${input.logFile}\n`);
  }
  return { exitCode: input.exitCode };
}

function buildDetachedDevArgs(options: DevCommandOptions): string[] {
  const args = ["dev", "--skip-startup-console"];
  if (options.host) args.push("--host", options.host);
  if (options.port !== undefined) args.push("--port", String(options.port));
  if (options.mock) args.push("--mock");
  if (options.mockAi) args.push("--mock-ai");
  if (!options.watch) args.push("--no-watch");
  if (options.db) args.push("--db", options.db);
  if (options.databaseUrl) args.push("--database-url", options.databaseUrl);
  if (!options.worker) args.push("--no-worker");
  if (options.withWeb === false) args.push("--no-web");
  if (options.apiOnly) args.push("--api-only");
  if (options.webOnly) args.push("--web-only");
  if (options.open) args.push("--open");
  if (options.webPort !== undefined) args.push("--web-port", String(options.webPort));
  if (options.telemetry.length > 0) args.push("--telemetry", options.telemetry.join(","));
  if (options.envFile) args.push("--env-file", options.envFile);
  return args;
}

function runDevStatus(options: DevCommandOptions): DevCommandResult {
  const paths = devStatePaths(options.workspaceRoot);
  const pid = readDetachedDevPid(options.workspaceRoot);
  const running = pid !== null && isProcessRunning(pid);
  if (pid !== null && !running) {
    removeDevPidFile(options.workspaceRoot);
  }
  return printDevLifecycleResult({
    options,
    ok: true,
    action: "status",
    running,
    ...(pid !== null ? { pid } : {}),
    logFile: paths.logFile,
    message: running ? "forge dev detached server is running" : "forge dev detached server is not running",
    exitCode: 0,
  });
}

function runDevStop(options: DevCommandOptions): DevCommandResult {
  const paths = devStatePaths(options.workspaceRoot);
  const pid = readDetachedDevPid(options.workspaceRoot);
  if (pid === null || !isProcessRunning(pid)) {
    removeDevPidFile(options.workspaceRoot);
    return printDevLifecycleResult({
      options,
      ok: true,
      action: "stop",
      running: false,
      ...(pid !== null ? { pid } : {}),
      logFile: paths.logFile,
      message: "no detached forge dev server was running",
      exitCode: 0,
    });
  }
  process.kill(pid, "SIGTERM");
  removeDevPidFile(options.workspaceRoot);
  return printDevLifecycleResult({
    options,
    ok: true,
    action: "stop",
    running: false,
    pid,
    logFile: paths.logFile,
    message: "stopped detached forge dev server",
    exitCode: 0,
  });
}

function runDevDetach(options: DevCommandOptions): DevCommandResult {
  if (options.once) {
    return printDevLifecycleResult({
      options,
      ok: false,
      action: "detach",
      running: false,
      logFile: devStatePaths(options.workspaceRoot).logFile,
      message: "forge dev --detach cannot be combined with --once",
      exitCode: 1,
    });
  }
  const existingPid = readDetachedDevPid(options.workspaceRoot);
  const paths = devStatePaths(options.workspaceRoot);
  nodeFileSystem.mkdirp(paths.dir);
  if (existingPid !== null && isProcessRunning(existingPid)) {
    return printDevLifecycleResult({
      options,
      ok: true,
      action: "detach",
      running: true,
      pid: existingPid,
      logFile: paths.logFile,
      message: "forge dev detached server is already running",
      exitCode: 0,
    });
  }

  const cliPath = process.argv[1];
  if (!cliPath) {
    return printDevLifecycleResult({
      options,
      ok: false,
      action: "detach",
      running: false,
      logFile: paths.logFile,
      message: "could not resolve current forge CLI path for detached dev server",
      exitCode: 1,
    });
  }

  const fd = openSync(paths.logFile, "a");
  try {
    const child = spawn(process.execPath, [cliPath, ...buildDetachedDevArgs(options)], {
      cwd: options.workspaceRoot,
      detached: true,
      stdio: ["ignore", fd, fd],
      windowsHide: true,
    });
    if (child.pid === undefined) {
      return printDevLifecycleResult({
        options,
        ok: false,
        action: "detach",
        running: false,
        logFile: paths.logFile,
        message: "detached forge dev process started without a pid",
        exitCode: 1,
      });
    }
    child.unref();
    nodeFileSystem.writeText(paths.pidFile, `${child.pid}\n`);
    return printDevLifecycleResult({
      options,
      ok: true,
      action: "detach",
      running: true,
      pid: child.pid,
      logFile: paths.logFile,
      message: "started detached forge dev server",
      exitCode: 0,
    });
  } finally {
    closeSync(fd);
  }
}

function nextPreviewPort(webUrl?: string): number {
  if (!webUrl) {
    return 5174;
  }
  try {
    const parsed = new URL(webUrl);
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    return Number.isFinite(port) && port > 0 ? port + 1 : 5174;
  } catch {
    return 5174;
  }
}

function isForgeStudioWorkspace(workspaceRoot: string): boolean {
  return basename(workspaceRoot).toLowerCase() === "forge-studio";
}

function previewSummaryFor(input: {
  workspaceRoot: string;
  host: string;
  webUrl?: string;
}): DevStartupSummary["preview"] {
  if (input.webUrl && !isForgeStudioWorkspace(input.workspaceRoot)) {
    const parsed = new URL(input.webUrl);
    const targetAppPort = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    return {
      targetAppUrl: input.webUrl,
      targetAppPort,
      isStudioSelfPreview: false,
      note: `Web app preview is running at ${input.webUrl}.`,
    };
  }

  const targetAppPort = nextPreviewPort(input.webUrl);
  const targetAppUrl = `http://${input.host}:${targetAppPort}`;
  const isStudioSelfPreview = Boolean(input.webUrl && input.webUrl === targetAppUrl);
  return {
    ...(input.webUrl ? { studioUrl: input.webUrl } : {}),
    targetAppUrl,
    targetAppPort,
    isStudioSelfPreview,
    note: input.webUrl
      ? `Use ${targetAppUrl} for the app being built when ${input.webUrl} is Forge Studio itself.`
      : `No web app was detected; ${targetAppUrl} is the default target app preview URL for Studio attach flows.`,
  };
}

async function isPortAvailable(host: string, port: number): Promise<boolean> {
  if (port === 0) {
    return true;
  }
  const server = createNetServer();
  return new Promise<boolean>((resolve) => {
    const cleanup = () => {
      server.removeAllListeners();
    };
    server.once("error", () => {
      cleanup();
      resolve(false);
    });
    server.listen(port, host, () => {
      server.close(() => {
        cleanup();
        resolve(true);
      });
    });
  });
}

function classifyDevStartFailure(input: {
  rawMessage: string;
  host: string;
  port: number;
  webPort?: number;
  db: DevCommandOptions["db"];
}): DevStartFailure {
  const lowerMessage = input.rawMessage.toLowerCase();
  const busy =
    lowerMessage.includes("eaddrinuse") ||
    lowerMessage.includes("address already in use") ||
    /port\s+\d+\s+.*in use/i.test(input.rawMessage);
  if (busy) {
    const suggestedCommands = [
      `forge dev --port 0${input.webPort ? ` --web-port ${input.webPort}` : ""} --json`,
      "forge doctor windows --json",
    ];
    return {
      message: `${input.rawMessage}. Port ${input.port} appears busy; stop the existing process or rerun with --port 0 / --port <free-port>.`,
      failureKind: "port_busy",
      nextActions: suggestedCommands,
      busy: {
        port: input.port,
        host: input.host,
        suggestedCommands,
      },
    };
  }

  if (input.db === "pglite" && isPgliteAbortMessage(input.rawMessage)) {
    return {
      message: `${input.rawMessage}. Local PGlite store may be corrupted or stale at .forge/pglite.`,
      code: FORGE_PGLITE_STORE_ABORTED,
      failureKind: "pglite_store_aborted",
      nextActions: [
        "forge doctor pglite --json",
        "forge db repair --local --adapter pglite --json",
        "forge dev --db memory --json",
      ],
    };
  }

  return {
    message: input.rawMessage,
    failureKind: "dev_start_failed",
    nextActions: ["forge dev --once --json", "forge check --json"],
  };
}

function writeDevStartFailure(input: {
  workspaceRoot: string;
  startedAt: Date;
  finishedAt: Date;
  options: DevCommandOptions;
  host: string;
  port: number;
  failure: DevStartFailure;
}): DevCommandResult {
  const nextActions = forgeCliCommandsForWorkspace(input.workspaceRoot, input.failure.nextActions);
  const busy = input.failure.busy
    ? {
        ...input.failure.busy,
        suggestedCommands: forgeCliCommandsForWorkspace(input.workspaceRoot, input.failure.busy.suggestedCommands),
      }
    : undefined;
  writeLastRunRecord(input.workspaceRoot, {
    schemaVersion: "0.1.0",
    command: forgeCliCommandForWorkspace(input.workspaceRoot, "forge dev"),
    ok: false,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
    ...(input.failure.code ? { code: input.failure.code } : {}),
    failureKind: input.failure.failureKind,
    message: input.failure.message,
    nextActions,
    details: {
      db: input.options.db,
      host: input.host,
      port: input.port,
    },
  });
  if (input.options.json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error: input.failure.message,
        code: input.failure.code,
        failureKind: input.failure.failureKind,
        busy,
        nextActions,
        exitCode: 1,
      })}\n`,
    );
  } else {
    console.error(`error${input.failure.code ? ` ${input.failure.code}` : ""}: ${input.failure.message}`);
    if (nextActions.length > 0) {
      console.error("next:");
      for (const action of nextActions) {
        console.error(`  ${action}`);
      }
    }
  }
  return { exitCode: 1 };
}

export async function resolveAvailableWebPort(input: {
  host: string;
  preferredPort: number;
  maxAttempts?: number;
}): Promise<{ port: number; requestedPort?: number; autoPortSelected: boolean }> {
  const attempts = input.maxAttempts ?? 20;
  const start = Math.max(0, Math.floor(input.preferredPort));
  if (start === 0) {
    return { port: 0, autoPortSelected: false };
  }

  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = start + offset;
    if (await isPortAvailable(input.host, candidate)) {
      return {
        port: candidate,
        ...(candidate !== start ? { requestedPort: start } : {}),
        autoPortSelected: candidate !== start,
      };
    }
  }

  return {
    port: 0,
    requestedPort: start,
    autoPortSelected: true,
  };
}

export interface DevWatchGenerateFailureEvent {
  schemaVersion: "0.1.0";
  event: "dev.generate_failed";
  ok: false;
  changedFiles: number;
  changedPaths: string[];
  generated: DevConsoleGeneratedSummary;
  diagnostics: DevGenerateResult["diagnostics"];
  nextActions: string[];
}

export interface DevWatchReloadEvent {
  schemaVersion: "0.1.0";
  event: "dev.reload";
  ok: boolean;
  changedFiles: number;
  changedPaths: string[];
  migrated: boolean;
  routes: number;
  runtimeEntries: number;
  worker: unknown;
  diagnostics: DevGenerateResult["diagnostics"];
  generated: DevConsoleGeneratedSummary;
  preview: DevConsoleSummary["preview"];
  agentContext: DevConsoleAgentContext;
  nextActions: string[];
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

function sanitizeProcessEnv(
  env: NodeJS.ProcessEnv,
  extra: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      sanitized[key] = value;
    }
  }
  return {
    ...sanitized,
    ...extra,
  };
}

function wrapWindowsShellCommand(command: string[]): string[] {
  const executable = command[0];
  if (process.platform !== "win32" || !executable || !/\.(cmd|bat)$/i.test(executable)) {
    return command;
  }
  return [process.env.ComSpec ?? "cmd.exe", "/d", "/c", ...command];
}

function startWebDevServer(input: {
  workspaceRoot: string;
  host: string;
  port: number;
  requestedPort?: number;
  autoPortSelected?: boolean;
  apiUrl: string;
  json: boolean;
}): WebDevServerHandle | null {
  const webRoot = join(input.workspaceRoot, "web");
  if (!hasWebApp(input.workspaceRoot)) {
    return null;
  }

  const pkg = readPackageJson(input.workspaceRoot);
  const packageManager = detectPackageManager(input.workspaceRoot);
  const env = sanitizeProcessEnv(process.env, {
    PORT: String(input.port),
    NEXT_PUBLIC_FORGE_URL: input.apiUrl,
    VITE_FORGE_URL: input.apiUrl,
  });
  const rawCommand =
    pkg?.scripts?.dev
      ? [packageManager, "run", "dev", "--", ...webDevArgsForPackage(pkg, input)]
      : ["node", "--import", "tsx", "server.ts"];
  const command = wrapWindowsShellCommand(resolvePackageManagerArgv(rawCommand));
  const cwd = pkg?.scripts?.dev ? webRoot : webRoot;
  const child = spawn(command[0]!, command.slice(1), {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env,
    windowsHide: true,
  });
  if (!input.json) {
    child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  }
  return {
    url: `http://${input.host}:${input.port}`,
    port: input.port,
    ...(input.requestedPort !== undefined ? { requestedPort: input.requestedPort } : {}),
    autoPortSelected: input.autoPortSelected ?? false,
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
  generated?: DevStartupGeneratedEvidence;
}): DevStartupSummary {
  const frontend = readGeneratedJson<FrontendGraph>(
    input.workspaceRoot,
    `${GENERATED_DIR}/frontendGraph.json`,
  );
  const buildInfo = readGeneratedJson<{ generatorVersion?: string; inputHash?: string }>(
    input.workspaceRoot,
    `${GENERATED_DIR}/buildInfo.json`,
  );
  const buildInfoRaw = nodeFileSystem.exists(join(input.workspaceRoot, `${GENERATED_DIR}/buildInfo.json`))
    ? stripDeterministicHeader(nodeFileSystem.readText(join(input.workspaceRoot, `${GENERATED_DIR}/buildInfo.json`)) ?? "")
    : "";
  const bindings = frontend
    ? [...new Set(frontend.clientBindings.map((binding) => `${binding.kind}:${binding.name}`))].sort()
    : [];
  const browserUrl = input.web?.url ?? input.handle.url;
  const warnings = input.handle.state.db.kind === "memory"
    ? [
        {
          code: "FORGE_DEV_MEMORY_DB_FIDELITY",
          message:
            "Memory DB is fast and non-persistent; PGlite/Postgres remain the authoritative checks for full SQL constraints and adapter fidelity.",
          nextAction: `rerun with ${forgeCliCommandForWorkspace(input.workspaceRoot, "forge dev --db pglite --once --json")} before treating the result as database-realistic`,
        },
      ]
    : [];
  const preview = previewSummaryFor({
    workspaceRoot: input.workspaceRoot,
    host: input.handle.host,
    ...(input.web?.url ? { webUrl: input.web.url } : {}),
  });
  return {
    schemaVersion: "0.1.0",
    ok: true,
    mode: "dev",
    warnings,
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
          ...(input.web.requestedPort !== undefined ? { requestedPort: input.web.requestedPort } : {}),
          autoPortSelected: input.web.autoPortSelected,
          command: input.web.command,
          framework: frontend?.framework ?? "unknown",
          routes: frontend?.routes.map((route) => route.path) ?? [],
          bridgeFiles: frontend?.bridgeFiles ?? [],
          ...(frontend?.dev?.apiUrlEnv ? { apiUrlEnv: frontend.dev.apiUrlEnv } : {}),
        }
      : null,
    preview,
    watch: {
      enabled: input.watch,
      autoGenerate: input.watch,
      reloadsRuntime: input.watch,
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
    generated: {
      state: input.generated?.state ?? (buildInfoRaw ? "fresh" : "stale-risk"),
      ...(buildInfo?.generatorVersion ? { generatorVersion: buildInfo.generatorVersion } : {}),
      ...(buildInfo?.inputHash ? { inputHash: buildInfo.inputHash } : {}),
      ...(buildInfoRaw ? { buildInfoHash: hashStable(buildInfoRaw) } : {}),
      ...(buildInfoRaw ? { runtimeLoadedHash: hashStable(buildInfoRaw) } : {}),
      runtimeStaleRisk: !buildInfoRaw || input.generated?.state === "stale-risk",
      changedFiles: input.generated?.changedFiles ?? 0,
      sampleChanged: input.generated?.sampleChanged ?? [],
      hiddenChanged: input.generated?.hiddenChanged ?? 0,
      command: input.generated?.command ?? forgeCliCommandForWorkspace(input.workspaceRoot, "forge generate"),
      checkCommand: input.generated?.checkCommand ?? forgeCliCommandForWorkspace(input.workspaceRoot, "forge generate --check --json"),
      message: input.generated?.message ?? (buildInfoRaw ? "generated artifacts are loaded" : "generated build info is missing"),
    },
    next: {
      browserUrl,
      apiIndex: input.handle.url,
      inspect: forgeCliCommandForWorkspace(input.workspaceRoot, "forge inspect summary --json"),
      verify: forgeCliCommandForWorkspace(input.workspaceRoot, "forge dev --once --json"),
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
  lines.push(`  Auto-generate: ${summary.watch.autoGenerate ? "on" : "off"}`);
  lines.push(`  Generated: ${summary.generated.state}${summary.generated.changedFiles > 0 ? ` (${summary.generated.changedFiles} changed)` : ""}${summary.generated.runtimeStaleRisk ? " (stale risk)" : ""}`);
  lines.push(`  Generated note: ${summary.generated.message}`);
  lines.push(`  Generated check: ${summary.generated.checkCommand}`);
  for (const warning of summary.warnings) {
    lines.push(`  Warning ${warning.code}: ${warning.message}`);
    if (warning.nextAction) {
      lines.push(`  Next: ${warning.nextAction}`);
    }
  }
  lines.push("");

  lines.push("Web app");
  if (summary.web) {
    lines.push(`  URL: ${summary.web.url}`);
    if (summary.web.autoPortSelected && summary.web.requestedPort) {
      lines.push(`  Requested port: ${summary.web.requestedPort} (busy; selected ${summary.web.port})`);
    }
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
  lines.push("  forge changed --json");
  lines.push("");

  lines.push("Preview");
  lines.push(`  Target app: ${summary.preview.targetAppUrl}`);
  if (summary.preview.studioUrl) {
    lines.push(`  Studio: ${summary.preview.studioUrl}`);
  }
  lines.push(`  Note: ${summary.preview.note}`);
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
    const child = spawn(command[0]!, command.slice(1), {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.unref();
  } catch {
    // Opening a browser is best-effort; dev server startup should not fail.
  }
}

export async function ensureGeneratedForDev(workspaceRoot: string): Promise<DevGenerateResult> {
  resetCompileSessions();
  const result = await run({
    workspaceRoot,
    check: false,
    dryRun: false,
    json: false,
    concurrency: 4,
  });
  return {
    ok: result.exitCode === 0,
    changed: result.changed,
    unchanged: result.unchanged,
    diagnostics: [...result.errors, ...result.warnings],
    exitCode: result.exitCode,
  };
}

export function generatedEvidenceFromCycle(cycle: DevConsoleCycle): DevStartupGeneratedEvidence {
  const phase = cycle.phases.find((item) => item.name === "generated");
  const changedFiles = Number(phase?.details?.changed ?? 0);
  const sampleChanged = Array.isArray(phase?.details?.sampleChanged)
    ? phase.details.sampleChanged.filter((item): item is string => typeof item === "string")
    : [];
  const hiddenChanged = Number(phase?.details?.hiddenChanged ?? 0);
  return {
    ok: phase?.ok === true,
    state: phase?.ok === true
      ? changedFiles > 0 ? "regenerated" : "fresh"
      : "stale-risk",
    changedFiles,
    sampleChanged,
    hiddenChanged,
    message: phase?.message ?? "generated phase did not report a message",
    command: cycle.summary.generated.command,
    checkCommand: cycle.summary.generated.checkCommand,
  };
}

export function generatedEvidenceFromGenerateResult(
  result: DevGenerateResult,
  options: { workspaceRoot?: string } = {},
): DevStartupGeneratedEvidence {
  return {
    ok: result.ok,
    state: result.ok ? result.changed.length > 0 ? "regenerated" : "fresh" : "stale-risk",
    changedFiles: result.changed.length,
    sampleChanged: result.changed.slice(0, 12),
    hiddenChanged: Math.max(0, result.changed.length - 12),
    message: result.ok
      ? result.changed.length > 0
        ? `regenerated ${result.changed.length} generated artifacts`
        : "generated artifacts are up to date"
      : "generated artifacts could not be regenerated",
    command: options.workspaceRoot
      ? forgeCliCommandForWorkspace(options.workspaceRoot, "forge generate")
      : "forge generate",
    checkCommand: options.workspaceRoot
      ? forgeCliCommandForWorkspace(options.workspaceRoot, "forge generate --check --json")
      : "forge generate --check --json",
  };
}

function printDevGenerateFailure(result: DevGenerateResult, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      phase: "generated",
      diagnostics: result.diagnostics,
      exitCode: 1,
    })}\n`);
    return;
  }
  console.error("error: forge dev could not regenerate generated artifacts");
  for (const diagnostic of result.diagnostics.filter((item) => item.severity === "error").slice(0, 5)) {
    console.error(`error ${diagnostic.code}: ${diagnostic.message}`);
  }
}

export function buildDevWatchGenerateFailureEvent(input: {
  changedCount: number;
  changedPaths: string[];
  result: DevGenerateResult;
  workspaceRoot?: string;
}): DevWatchGenerateFailureEvent {
  const nextActions = input.workspaceRoot
    ? forgeCliCommandsForWorkspace(input.workspaceRoot, ["forge dev --once --json", "forge check --json"])
    : ["forge dev --once --json", "forge check --json"];
  return {
    schemaVersion: "0.1.0",
    event: "dev.generate_failed",
    ok: false,
    changedFiles: input.changedCount,
    changedPaths: input.changedPaths,
    generated: generatedEvidenceFromGenerateResult(input.result, { workspaceRoot: input.workspaceRoot }),
    diagnostics: input.result.diagnostics,
    nextActions,
  };
}

export function buildDevWatchReloadEvent(input: {
  changedCount: number;
  changedPaths: string[];
  generated: DevGenerateResult;
  reload: Awaited<ReturnType<DevServerHandle["reload"]>>;
  cycle: DevConsoleCycle;
  workspaceRoot?: string;
}): DevWatchReloadEvent {
  const failureNextActions = input.workspaceRoot
    ? forgeCliCommandsForWorkspace(input.workspaceRoot, ["forge dev --once --json", "forge check --json"])
    : ["forge dev --once --json", "forge check --json"];
  return {
    schemaVersion: "0.1.0",
    event: "dev.reload",
    ok: input.reload.ok,
    changedFiles: input.changedCount,
    changedPaths: input.changedPaths,
    migrated: input.reload.migrated,
    routes: input.reload.routes,
    runtimeEntries: input.reload.runtimeEntries,
    worker: input.reload.worker,
    diagnostics: input.reload.diagnostics,
    generated: generatedEvidenceFromGenerateResult(input.generated, { workspaceRoot: input.workspaceRoot }),
    preview: input.cycle.summary.preview,
    agentContext: input.cycle.summary.agentContext,
    nextActions: input.reload.ok
      ? input.cycle.summary.agentContext.recommendedCommands
      : failureNextActions,
  };
}

export async function runDevCommand(
  options: DevCommandOptions,
): Promise<DevCommandResult> {
  const workspaceRoot = options.workspaceRoot.replace(/\\/g, "/");
  const startedAt = new Date();

  if (options.lifecycle === "status") {
    return runDevStatus({ ...options, workspaceRoot });
  }
  if (options.lifecycle === "stop") {
    return runDevStop({ ...options, workspaceRoot });
  }
  if (options.detach) {
    return runDevDetach({ ...options, workspaceRoot });
  }

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
  if (!options.webOnly && !(await isPortAvailable(host, port))) {
    const failure = classifyDevStartFailure({
      rawMessage: `listen EADDRINUSE: address already in use ${host}:${port}`,
      host,
      port,
      webPort: options.webPort,
      db: options.db,
    });
    return writeDevStartFailure({
      workspaceRoot,
      startedAt,
      finishedAt: new Date(),
      options,
      host,
      port,
      failure,
    });
  }
  const requestedWebPort = options.webPort ?? detectDefaultWebPort(workspaceRoot);
  const shouldStartWeb =
    options.webOnly === true ||
    (options.withWeb !== false && !options.apiOnly && hasWebApp(workspaceRoot));
  const webPortSelection = shouldStartWeb
    ? await resolveAvailableWebPort({ host, preferredPort: requestedWebPort })
    : { port: requestedWebPort, autoPortSelected: false };
  const webPort = webPortSelection.port;
  const webUrl = shouldStartWeb ? `http://${host}:${webPort}` : undefined;
  let startupGenerated: DevStartupGeneratedEvidence | undefined;

  if (!options.skipStartupConsole) {
    const startupCycle = await runDevConsoleCycle({
      workspaceRoot,
      mode: "startup",
      strictSecrets: false,
      includeImpact: true,
      apiUrl: `http://${host}:${port}`,
      ...(webUrl ? { webUrl } : {}),
    });
    if (options.json) {
      process.stdout.write(formatDevConsoleJson(startupCycle));
    } else {
      process.stdout.write(formatDevConsoleHuman(startupCycle));
    }
    startupGenerated = generatedEvidenceFromCycle(startupCycle);
    if (startupCycle.exitCode !== 0) {
      return { exitCode: 1 };
    }
  } else {
    const generated = await ensureGeneratedForDev(workspaceRoot);
    startupGenerated = generatedEvidenceFromGenerateResult(generated);
    if (!generated.ok) {
      printDevGenerateFailure(generated, options.json);
      return { exitCode: 1 };
    }
  }

  if (options.webOnly) {
    const apiUrl = `http://${host}:${port}`;
    const webHandle = startWebDevServer({
      workspaceRoot,
      host,
      port: webPort,
      requestedPort: webPortSelection.requestedPort,
      autoPortSelected: webPortSelection.autoPortSelected,
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
            ...(webHandle.requestedPort !== undefined ? { requestedPort: webHandle.requestedPort } : {}),
            autoPortSelected: webHandle.autoPortSelected,
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

  const deltaRecorder = await createAmbientDeltaRecorder(workspaceRoot, "forge-dev", "forge dev");

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
      deltaRecorder,
    });
  } catch (error) {
    await deltaRecorder.close("forge dev failed to start");
    const finishedAt = new Date();
    const rawMessage =
      error instanceof Error ? error.message : "failed to start dev server";
    const failure = classifyDevStartFailure({
      rawMessage,
      host,
      port,
      webPort: options.webPort,
      db: options.db,
    });
    return writeDevStartFailure({
      workspaceRoot,
      startedAt,
      finishedAt,
      options,
      host,
      port,
      failure,
    });
  }

  const webHandle = !shouldStartWeb
    ? null
    : startWebDevServer({
        workspaceRoot,
        host,
        port: webPort,
        requestedPort: webPortSelection.requestedPort,
        autoPortSelected: webPortSelection.autoPortSelected,
        apiUrl: handle.url,
        json: options.json,
      });

  const startupSummary = buildStartupSummary({
    workspaceRoot,
    handle,
    web: webHandle,
    watch: options.watch,
    generated: startupGenerated,
  });
  if (options.json) {
    printStartupJson(startupSummary);
  } else {
    printStartupHuman(startupSummary);
  }
  if (options.open) {
    openBrowser(webHandle?.url ?? handle.url);
  }

  {
    const finishedAt = new Date();
    writeLastRunRecord(workspaceRoot, {
      schemaVersion: "0.1.0",
      command: "forge dev",
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    nextActions: [
      webHandle?.url ?? handle.url,
      forgeCliCommandForWorkspace(workspaceRoot, "forge last --json"),
    ],
      details: {
        db: handle.state.db.kind,
        apiUrl: handle.url,
        webUrl: webHandle?.url,
        watch: options.watch,
        worker: options.worker,
      },
    });
  }

  let watchHandle: { stop: () => void } | null = null;
  let outboxWorkerHandle: { stop: () => void } | null = null;

  if (options.worker && handle.outboxWorker) {
    outboxWorkerHandle = handle.outboxWorker;
  }

  const devConsoleUrlOptions = (): { apiUrl: string; webUrl?: string } => ({
    apiUrl: handle.url,
    ...(webHandle?.url ? { webUrl: webHandle.url } : {}),
  });

  if (options.watch) {
    watchHandle = startDevWatch(workspaceRoot, async (changedCount, changedPaths) => {
      for (const changedPath of changedPaths) {
        await deltaRecorder.recordFileChanged(changedPath);
      }
      resetCompileSessions();
      const result = await run({
        workspaceRoot,
        check: false,
        dryRun: false,
        json: false,
        concurrency: 2,
      });

      if (result.exitCode === 0) {
        const reload = await handle.reload("watch");
        const cycle = await runDevConsoleCycle({
          workspaceRoot,
          mode: "watch",
          strictSecrets: false,
          includeImpact: true,
          ...devConsoleUrlOptions(),
        });
        if (!options.json) {
          process.stdout.write(
            `[forge dev] regenerated (${changedCount} changed files), ` +
              `migrations ${reload.migrated ? "applied" : "skipped"}, ` +
              `runtime ${reload.ok ? "reloaded" : "reload failed"}\n`,
          );
        } else {
          process.stdout.write(`${JSON.stringify(buildDevWatchReloadEvent({
            changedCount,
            changedPaths,
            generated: {
              ok: true,
              changed: result.changed,
              unchanged: result.unchanged,
              diagnostics: [...result.errors, ...result.warnings],
              exitCode: 0,
            },
            reload,
            cycle,
            workspaceRoot,
          }))}\n`);
        }
        if (!reload.ok && !options.json) {
          for (const diagnostic of reload.diagnostics.filter((item) => item.severity === "error")) {
            console.error(`error ${diagnostic.code}: ${diagnostic.message}`);
          }
        }
        if (options.json) {
          process.stdout.write(formatDevConsoleJson(cycle));
        } else {
          process.stdout.write(formatDevConsoleHuman(cycle));
        }
      } else {
        if (options.json) {
          process.stdout.write(`${JSON.stringify(buildDevWatchGenerateFailureEvent({
            changedCount,
            changedPaths,
            result: {
              ok: false,
              changed: result.changed,
              unchanged: result.unchanged,
              diagnostics: [...result.errors, ...result.warnings],
              exitCode: 1,
            },
            workspaceRoot,
          }))}\n`);
        } else {
          console.error(`[forge dev] regeneration failed after ${changedCount} changed files; runtime was not reloaded`);
          for (const diagnostic of [...result.errors, ...result.warnings]) {
            console.error(`${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
          }
        }
        const cycle = await runDevConsoleCycle({
          workspaceRoot,
          mode: "watch",
          strictSecrets: false,
          includeImpact: true,
          ...devConsoleUrlOptions(),
        });
        if (options.json) {
          process.stdout.write(formatDevConsoleJson(cycle));
        } else {
          process.stdout.write(formatDevConsoleHuman(cycle));
        }
      }
    });
  }

  await new Promise<void>((resolve) => {
      const shutdown = () => {
        watchHandle?.stop();
        outboxWorkerHandle?.stop();
        webHandle?.stop();
        handle.stop();
        void deltaRecorder.close("forge dev stopped");
        resolve();
      };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

  return { handle, web: webHandle ?? undefined, exitCode: 0 };
}
