import { spawn } from "node:child_process";
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
  const preview = previewSummaryFor({
    workspaceRoot: input.workspaceRoot,
    host: input.handle.host,
    ...(input.web?.url ? { webUrl: input.web.url } : {}),
  });
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
      command: input.generated?.command ?? "forge generate",
      checkCommand: input.generated?.checkCommand ?? "forge generate --check --json",
      message: input.generated?.message ?? (buildInfoRaw ? "generated artifacts are loaded" : "generated build info is missing"),
    },
    next: {
      browserUrl,
      apiIndex: input.handle.url,
      inspect: "forge inspect summary --json",
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
  lines.push(`  Auto-generate: ${summary.watch.autoGenerate ? "on" : "off"}`);
  lines.push(`  Generated: ${summary.generated.state}${summary.generated.changedFiles > 0 ? ` (${summary.generated.changedFiles} changed)` : ""}${summary.generated.runtimeStaleRisk ? " (stale risk)" : ""}`);
  lines.push(`  Generated note: ${summary.generated.message}`);
  lines.push(`  Generated check: ${summary.generated.checkCommand}`);
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
    command: "forge generate",
    checkCommand: "forge generate --check --json",
  };
}

export function generatedEvidenceFromGenerateResult(result: DevGenerateResult): DevStartupGeneratedEvidence {
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
    command: "forge generate",
    checkCommand: "forge generate --check --json",
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
}): DevWatchGenerateFailureEvent {
  return {
    schemaVersion: "0.1.0",
    event: "dev.generate_failed",
    ok: false,
    changedFiles: input.changedCount,
    changedPaths: input.changedPaths,
    generated: generatedEvidenceFromGenerateResult(input.result),
    diagnostics: input.result.diagnostics,
    nextActions: ["forge dev --once --json", "forge check --json"],
  };
}

export function buildDevWatchReloadEvent(input: {
  changedCount: number;
  changedPaths: string[];
  generated: DevGenerateResult;
  reload: Awaited<ReturnType<DevServerHandle["reload"]>>;
  cycle: DevConsoleCycle;
}): DevWatchReloadEvent {
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
    generated: generatedEvidenceFromGenerateResult(input.generated),
    preview: input.cycle.summary.preview,
    agentContext: input.cycle.summary.agentContext,
    nextActions: input.reload.ok
      ? input.cycle.summary.agentContext.recommendedCommands
      : ["forge dev --once --json", "forge check --json"],
  };
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
    const rawMessage =
      error instanceof Error ? error.message : "failed to start dev server";
    const lowerMessage = rawMessage.toLowerCase();
    const busy =
      lowerMessage.includes("eaddrinuse") ||
      lowerMessage.includes("address already in use") ||
      /port\s+\d+\s+.*in use/i.test(rawMessage);
    const message = busy
      ? `${rawMessage}. Port ${port} appears busy; stop the existing process or rerun with --port 0 / --port <free-port>.`
      : rawMessage;
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          ok: false,
          error: message,
          failureKind: busy ? "port_busy" : "dev_start_failed",
          busy: busy
            ? {
                port,
                host,
                suggestedCommands: [
                  `forge dev --port 0${options.webPort ? ` --web-port ${options.webPort}` : ""} --json`,
                  "forge doctor windows --json",
                ],
              }
            : undefined,
          exitCode: 1,
        })}\n`,
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

  let watchHandle: { stop: () => void } | null = null;
  let outboxWorkerHandle: { stop: () => void } | null = null;

  if (options.worker && handle.outboxWorker) {
    outboxWorkerHandle = handle.outboxWorker;
  }

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
