import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { releaseManifest } from "../_generated/releaseManifest.ts";
import {
  CODEX_MCP_HOOK_TOOL,
  CODEX_HOOK_META_RELATIVE,
  CODEX_HOOK_QUEUE_RELATIVE,
  CODEX_HOOK_RUNNER_RELATIVE,
} from "./sources/codex.ts";

export interface CodexHookMeta {
  schema: string;
  forgeVersion: string;
  installedAt: string;
  commandResolvedFrom: string;
  workspaceRoot: string;
  runner: string;
  queueFile: string;
  transport?: "command" | "mcp_tool";
  mcpServer?: string;
  stdinTimeoutMs?: number;
  hookTimeouts?: Record<string, number>;
}

export interface CodexHookCommandInspection {
  hookCommands: string[];
  usesLightweightRunner: boolean;
  usesMcpHook: boolean;
  mcpServers: string[];
  usesLegacyForgeCli: boolean;
  maxHookTimeout?: number;
  legacyCommands: string[];
}

export interface ForgePathResolution {
  path: string;
  version?: string;
  source: "path" | "workspace-bin" | "unknown";
}

export interface CodexHookRunnerProbe {
  ok: boolean;
  durationMs: number;
  exitCode: number | null;
  queued: boolean;
  stdinHangSafe: boolean;
  stdinHangDurationMs?: number;
  error?: string;
}

export function readCodexHookMeta(workspaceRoot: string): CodexHookMeta | null {
  const path = join(workspaceRoot, CODEX_HOOK_META_RELATIVE);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const meta = parsed as Partial<CodexHookMeta>;
    if (typeof meta.forgeVersion !== "string" || typeof meta.workspaceRoot !== "string") {
      return null;
    }
    return meta as CodexHookMeta;
  } catch {
    return null;
  }
}

export function inspectCodexHookCommands(workspaceRoot: string): CodexHookCommandInspection {
  const hooksPath = join(workspaceRoot, ".codex", "hooks.json");
  const empty: CodexHookCommandInspection = {
    hookCommands: [],
    usesLightweightRunner: false,
    usesMcpHook: false,
    mcpServers: [],
    usesLegacyForgeCli: false,
    legacyCommands: [],
  };
  if (!existsSync(hooksPath)) {
    return empty;
  }
  try {
    const parsed = JSON.parse(readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ type?: string; command?: string; server?: string; tool?: string; timeout?: number }> }>>;
    };
    const commands: string[] = [];
    const legacyCommands: string[] = [];
    const mcpServers = new Set<string>();
    let maxHookTimeout: number | undefined;
    for (const groups of Object.values(parsed.hooks ?? {})) {
      for (const group of groups ?? []) {
        for (const hook of group.hooks ?? []) {
          if (typeof hook.command === "string") {
            commands.push(hook.command);
            if (/forge\s+agent\s+ingest/i.test(hook.command)) {
              legacyCommands.push(hook.command);
            }
          }
          if (hook.type === "mcp_tool" && hook.tool === CODEX_MCP_HOOK_TOOL && typeof hook.server === "string") {
            mcpServers.add(hook.server);
          }
          if (typeof hook.timeout === "number") {
            maxHookTimeout = maxHookTimeout === undefined ? hook.timeout : Math.max(maxHookTimeout, hook.timeout);
          }
        }
      }
    }
    const usesLightweightRunner = commands.some((command) => command.includes("codex-hook.mjs"));
    const usesLegacyForgeCli = legacyCommands.length > 0;
    return {
      hookCommands: commands,
      usesLightweightRunner,
      usesMcpHook: mcpServers.size > 0,
      mcpServers: [...mcpServers],
      usesLegacyForgeCli,
      maxHookTimeout,
      legacyCommands,
    };
  } catch {
    return empty;
  }
}

export function resolveForgeOnPath(workspaceRoot?: string): ForgePathResolution | null {
  const roots = [workspaceRoot, process.cwd()].filter((value): value is string => Boolean(value));
  for (const root of roots) {
    const localBin = join(root, "bin", "forge.mjs");
    if (existsSync(localBin)) {
      return { path: localBin, source: "workspace-bin", version: readForgeVersion(localBin) };
    }
  }
  const command = process.platform === "win32" ? "where.exe" : "which";
  const args = process.platform === "win32" ? ["forge"] : ["forge"];
  const result = spawnSyncSafe(command, args);
  if (!result.ok || !result.stdout.trim()) {
    return null;
  }
  const firstLine = result.stdout.split(/\r?\n/).find((line) => line.trim())?.trim();
  if (!firstLine) {
    return null;
  }
  return {
    path: firstLine,
    source: "path",
    version: readForgeVersion(firstLine),
  };
}

export function compareHookForgeVersions(
  meta: CodexHookMeta | null,
  runtimeVersion: string = releaseManifest.packageVersion,
): { matches: boolean; installedVersion?: string; runtimeVersion: string } {
  if (!meta?.forgeVersion) {
    return { matches: false, runtimeVersion };
  }
  return {
    matches: meta.forgeVersion === runtimeVersion,
    installedVersion: meta.forgeVersion,
    runtimeVersion,
  };
}

export async function probeCodexHookRunner(
  workspaceRoot: string,
  options?: { maxDurationMs?: number; stdinHangBudgetMs?: number },
): Promise<CodexHookRunnerProbe> {
  const maxDurationMs = options?.maxDurationMs ?? 5000;
  const stdinHangBudgetMs = options?.stdinHangBudgetMs ?? 3000;
  const runnerPath = join(workspaceRoot, CODEX_HOOK_RUNNER_RELATIVE);
  if (!existsSync(runnerPath)) {
    return {
      ok: false,
      durationMs: 0,
      exitCode: null,
      queued: false,
      stdinHangSafe: false,
      error: `missing hook runner: ${CODEX_HOOK_RUNNER_RELATIVE}`,
    };
  }

  const queuePath = join(workspaceRoot, CODEX_HOOK_QUEUE_RELATIVE);
  const queueBefore = existsSync(queuePath) ? readFileSync(queuePath, "utf8") : "";
  const payload = JSON.stringify({
    session_id: "forge-hook-probe",
    hook_event_name: "SessionStart",
    cwd: workspaceRoot,
    forgeHookProbe: true,
  });

  const startedAt = Date.now();
  // Use the same bounded asynchronous process path as the open-stdin probe.
  // Bun on Windows can report a synchronous timeout before its deadline.
  const result = await spawnNodeHook(runnerPath, ["SessionStart"], {
    cwd: workspaceRoot,
    input: payload,
    timeoutMs: maxDurationMs + 1000,
  });
  const durationMs = Date.now() - startedAt;

  const queueAfter = existsSync(queuePath) ? readFileSync(queuePath, "utf8") : "";
  const queued = queueAfter.length > queueBefore.length && queueAfter.includes("forge-hook-probe");

  const hangStartedAt = Date.now();
  const hangResult = await spawnNodeHook(runnerPath, ["SessionStart"], {
    cwd: workspaceRoot,
    keepStdinOpen: true,
    timeoutMs: stdinHangBudgetMs,
  });
  const stdinHangDurationMs = Date.now() - hangStartedAt;
  const stdinHangSafe = !hangResult.timedOut && hangResult.exitCode === 0 && stdinHangDurationMs <= stdinHangBudgetMs;

  const exitCode = result.exitCode;
  const ok = exitCode === 0 && durationMs <= maxDurationMs && queued && stdinHangSafe;
  const stderr = result.stderr?.trim() ?? "";
  return {
    ok,
    durationMs,
    exitCode,
    queued,
    stdinHangSafe,
    stdinHangDurationMs,
    ...(ok ? {} : {
      error: [
        stderr,
        !stdinHangSafe ? `hook runner did not exit safely with open stdin within ${stdinHangBudgetMs}ms` : undefined,
        result.error,
        result.signal ? `hook runner terminated by signal ${result.signal}` : undefined,
        exitCode !== 0 && !result.error && !result.signal ? `hook runner exited with code ${exitCode ?? "unknown"}` : undefined,
        !queued ? "hook runner did not append NDJSON queue entry" : undefined,
        durationMs > maxDurationMs ? `hook runner took ${durationMs}ms (budget ${maxDurationMs}ms)` : undefined,
      ].filter(Boolean).join("; ") || "hook probe failed",
    }),
  };
}

function readForgeVersion(commandPath: string): string | undefined {
  if (commandPath.endsWith(".mjs") || commandPath.endsWith(".js")) {
    try {
      const pkgPath = join(commandPath, "..", "..", "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
        return typeof pkg.version === "string" ? pkg.version : undefined;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  const result = spawnSyncSafe(process.execPath, [commandPath, "--version"], { timeoutMs: 3000 });
  return result.ok ? result.stdout.trim().split(/\r?\n/)[0]?.trim() : undefined;
}

function spawnSyncSafe(
  command: string,
  args: string[],
  options?: { timeoutMs?: number },
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options?.timeoutMs,
    windowsHide: true,
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

function spawnNodeHook(
  runnerPath: string,
  args: string[],
  options: {
    cwd: string;
    input?: string;
    keepStdinOpen?: boolean;
    timeoutMs: number;
  },
): Promise<{ exitCode: number | null; timedOut: boolean; error?: string; signal?: NodeJS.Signals | null; stderr?: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [runnerPath, ...args], {
      cwd: options.cwd,
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    let timedOut = false;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { if (stderr.length < 32768) stderr = (stderr + chunk.toString("utf8")).slice(0, 32768); });
    child.stdin?.on("error", () => { /* close/error events carry the subprocess result */ });
    let killGraceTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: { exitCode: number | null; timedOut: boolean; error?: string; signal?: NodeJS.Signals | null }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (killGraceTimer) {
        clearTimeout(killGraceTimer);
      }
      resolvePromise({ ...value, stderr });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      killGraceTimer = setTimeout(() => {
        finish({ exitCode: null, timedOut: true, error: "hook runner timed out" });
      }, 1000);
    }, options.timeoutMs);

    child.on("error", (error) => {
      finish({ exitCode: null, timedOut, error: error.message });
    });
    child.on("close", (code, signal) => {
      finish({ exitCode: code, timedOut, signal, ...(timedOut ? { error: "hook runner timed out" } : {}) });
    });

    if (options.keepStdinOpen) {
      child.stdin?.write('{"session_id":"forge-hook-hang-probe"');
      return;
    }
    if (options.input !== undefined) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();
  });
}
