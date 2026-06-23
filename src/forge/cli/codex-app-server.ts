import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join, relative } from "node:path";

export type CodexAppServerState = "ready" | "missing" | "disabled" | "unsupported";

export interface CodexAppServerProof {
  schemaVersion: "0.1.0";
  checked: boolean;
  relevant: boolean;
  state: CodexAppServerState;
  available: boolean;
  command: string;
  resolution: {
    requested: string;
    executable: string;
    strategy: "direct" | "path" | "cmd-shim" | "powershell-shim";
    warning?: string;
  };
  versionCommand: string;
  helpCommand: string;
  schemaCommands: {
    typescript: string;
    jsonSchema: string;
  };
  connect: {
    transport: "stdio";
    command: string;
    note: string;
  };
  security: {
    websocket: {
      defaultPosture: string;
      recommendation: string;
    };
    shellCommandRisk: string;
    authoritativeEvents: string;
  };
  checks: Array<{
    name: string;
    ok: boolean;
    status: "ok" | "warning" | "failed" | "skipped";
    message: string;
    suggestedCommands: string[];
  }>;
  version?: string;
  helpSample?: string;
  error?: string;
  handshake?: CodexAppServerHandshakeResult;
  nextActions: string[];
}

export interface CodexAppServerCommands {
  inspect: string;
  generateTypes: string;
  generateJsonSchema: string;
  connectStdio: string;
  probeHandshake: string;
}

export interface CodexAppServerSchemaGenerationResult {
  attempted: boolean;
  dryRun: boolean;
  ok: boolean;
  outDir: string;
  commands: {
    typescript: string;
    jsonSchema: string;
  };
  results: Array<{
    name: "typescript" | "jsonSchema";
    ok: boolean;
    exitCode: number | null;
    command: string;
    stdout?: string;
    stderr?: string;
    error?: string;
  }>;
  files: string[];
  nextActions: string[];
}

export interface CodexAppServerHandshakeResult {
  attempted: boolean;
  dryRun: boolean;
  ok: boolean;
  transport: "stdio";
  command: string;
  initialized: boolean;
  durationMs: number;
  skippedReason?: "not-requested" | "dry-run" | "disabled" | "unavailable";
  clientInfo: {
    name: string;
    title: string;
    version: string;
  };
  messages: {
    responses: number;
    notifications: number;
    firstNotification?: string;
  };
  initializeResult?: {
    keys: string[];
    userAgent?: string;
    platformFamily?: string;
    platformOs?: string;
  };
  readiness?: {
    modelList: {
      attempted: boolean;
      responded: boolean;
      ok: boolean;
      method: "model/list";
      count?: number;
      sampleModels?: string[];
      error?: string;
    };
    accountRead: {
      attempted: boolean;
      responded: boolean;
      ok: boolean;
      method: "account/read";
      accountType?: string;
      requiresOpenaiAuth?: boolean;
      planType?: string;
      error?: string;
    };
  };
  stderrSample?: string[];
  error?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  nextActions: string[];
}

interface ProbeResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut: boolean;
}

interface ResolvedCodexExecutable {
  requested: string;
  executable: string;
  strategy: CodexAppServerProof["resolution"]["strategy"];
  warning?: string;
}

const DEFAULT_CODEX_BIN = "codex";
const SCHEMA_DIR = ".forge/codex-app-server-schemas";
const cache = new Map<string, CodexAppServerProof>();

export function codexAppServerCommands(bin = process.env.FORGE_CODEX_BIN || DEFAULT_CODEX_BIN): CodexAppServerCommands {
  return {
    inspect: `${bin} app-server --help`,
    generateTypes: `${bin} app-server generate-ts --out ${SCHEMA_DIR}`,
    generateJsonSchema: `${bin} app-server generate-json-schema --out ${SCHEMA_DIR}`,
    connectStdio: `${bin} app-server`,
    probeHandshake: "forge studio codex-server . --probe --json",
  };
}

function runProbe(command: string, args: string[], cwd: string, timeoutMs: number): ProbeResult {
  const resolved = resolveCodexExecutable(command);
  const invocation = buildProbeInvocation(resolved, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    timeout: timeoutMs,
    windowsHide: true,
  });
  const error = result.error as NodeJS.ErrnoException | undefined;
  return {
    ok: result.status === 0 && !error,
    exitCode: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    error: error?.code === "ETIMEDOUT"
      ? `timed out after ${timeoutMs}ms`
      : error?.message,
    timedOut: error?.code === "ETIMEDOUT",
  };
}

function safeStatFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function resolveCodexExecutable(requested: string): ResolvedCodexExecutable {
  if (process.platform !== "win32") {
    return { requested, executable: requested, strategy: "direct" };
  }

  if (hasPathSeparator(requested) || isAbsolute(requested)) {
    const extension = extname(requested).toLowerCase();
    return {
      requested,
      executable: requested,
      strategy: extension === ".cmd" || extension === ".bat"
        ? "cmd-shim"
        : extension === ".ps1"
          ? "powershell-shim"
          : "direct",
    };
  }

  const pathEntries = (process.env.PATH ?? "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidates = [
    `${requested}.cmd`,
    `${requested}.exe`,
    `${requested}.bat`,
    `${requested}.ps1`,
    requested,
  ];
  for (const entry of pathEntries) {
    for (const candidate of candidates) {
      const absolute = join(entry, candidate);
      if (!existsSync(absolute) || !safeStatFile(absolute)) {
        continue;
      }
      const extension = extname(absolute).toLowerCase();
      return {
        requested,
        executable: absolute,
        strategy: extension === ".cmd" || extension === ".bat"
          ? "cmd-shim"
          : extension === ".ps1"
            ? "powershell-shim"
            : "path",
        ...(extension === "" ? { warning: "resolved to an extensionless Windows shim; prefer a .cmd or .exe path with FORGE_CODEX_BIN" } : {}),
      };
    }
  }
  return { requested, executable: requested, strategy: "direct" };
}

function quoteCmdArg(value: string): string {
  if (/^[a-zA-Z0-9_:=\-./\\]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildProbeInvocation(resolved: ResolvedCodexExecutable, args: string[]): { command: string; args: string[] } {
  if (process.platform !== "win32") {
    return { command: resolved.executable, args };
  }
  if (resolved.strategy === "cmd-shim") {
    const commandLine = [quoteCmdArg(resolved.executable), ...args.map(quoteCmdArg)].join(" ");
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", commandLine],
    };
  }
  if (resolved.strategy === "powershell-shim") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolved.executable, ...args],
    };
  }
  return { command: resolved.executable, args };
}

function sampleText(value: string): string | undefined {
  const normalized = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("\n");
  return normalized || undefined;
}

function sampleLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => line.length > 240 ? `${line.slice(0, 237)}...` : line);
}

function summarizeInitializeResult(value: unknown): CodexAppServerHandshakeResult["initializeResult"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    keys: Object.keys(record).sort(),
    ...(typeof record.userAgent === "string" ? { userAgent: record.userAgent } : {}),
    ...(typeof record.platformFamily === "string" ? { platformFamily: record.platformFamily } : {}),
    ...(typeof record.platformOs === "string" ? { platformOs: record.platformOs } : {}),
  };
}

function rpcErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return typeof record.message === "string" ? record.message : "RPC request failed";
}

function summarizeModelListReadiness(message: {
  result?: unknown;
  error?: unknown;
}): NonNullable<CodexAppServerHandshakeResult["readiness"]>["modelList"] {
  const error = rpcErrorMessage(message.error);
  if (error) {
    return {
      attempted: true,
      responded: true,
      ok: false,
      method: "model/list",
      error,
    };
  }
  const result = message.result && typeof message.result === "object" && !Array.isArray(message.result)
    ? message.result as Record<string, unknown>
    : {};
  const data = Array.isArray(result.data) ? result.data : [];
  const sampleModels = data
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
      const record = entry as Record<string, unknown>;
      return String(record.id || record.model || record.displayName || "").trim();
    })
    .filter(Boolean)
    .slice(0, 5);
  return {
    attempted: true,
    responded: true,
    ok: true,
    method: "model/list",
    count: data.length,
    ...(sampleModels.length > 0 ? { sampleModels } : {}),
  };
}

function summarizeAccountReadReadiness(message: {
  result?: unknown;
  error?: unknown;
}): NonNullable<CodexAppServerHandshakeResult["readiness"]>["accountRead"] {
  const error = rpcErrorMessage(message.error);
  if (error) {
    return {
      attempted: true,
      responded: true,
      ok: false,
      method: "account/read",
      error,
    };
  }
  const result = message.result && typeof message.result === "object" && !Array.isArray(message.result)
    ? message.result as Record<string, unknown>
    : {};
  const account = result.account && typeof result.account === "object" && !Array.isArray(result.account)
    ? result.account as Record<string, unknown>
    : undefined;
  return {
    attempted: true,
    responded: true,
    ok: true,
    method: "account/read",
    ...(typeof account?.type === "string" ? { accountType: account.type } : {}),
    ...(typeof result.requiresOpenaiAuth === "boolean" ? { requiresOpenaiAuth: result.requiresOpenaiAuth } : {}),
    ...(typeof account?.planType === "string" ? { planType: account.planType } : {}),
  };
}

function initialReadiness(): NonNullable<CodexAppServerHandshakeResult["readiness"]> {
  return {
    modelList: {
      attempted: true,
      responded: false,
      ok: false,
      method: "model/list",
    },
    accountRead: {
      attempted: true,
      responded: false,
      ok: false,
      method: "account/read",
    },
  };
}

function timedOutReadiness(
  readiness: NonNullable<CodexAppServerHandshakeResult["readiness"]>,
  timeoutMs: number,
): NonNullable<CodexAppServerHandshakeResult["readiness"]> {
  return {
    modelList: readiness.modelList.responded
      ? readiness.modelList
      : {
          ...readiness.modelList,
          error: `timed out after ${timeoutMs}ms`,
        },
    accountRead: readiness.accountRead.responded
      ? readiness.accountRead
      : {
          ...readiness.accountRead,
          error: `timed out after ${timeoutMs}ms`,
        },
  };
}

function listSchemaFiles(workspaceRoot: string): string[] {
  const absolute = join(workspaceRoot, SCHEMA_DIR);
  if (!existsSync(absolute)) {
    return [];
  }
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absoluteEntry = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absoluteEntry);
      } else if (entry.isFile()) {
        files.push(join(SCHEMA_DIR, relative(absolute, absoluteEntry)).replace(/\\/g, "/"));
      }
    }
  };
  try {
    visit(absolute);
    return files.sort();
  } catch {
    return [];
  }
}

function baseProof(input: { relevant: boolean; bin: string }): Omit<CodexAppServerProof, "state" | "available" | "checks" | "nextActions"> {
  const commands = codexAppServerCommands(input.bin);
  const resolution = resolveCodexExecutable(input.bin);
  return {
    schemaVersion: "0.1.0",
    checked: true,
    relevant: input.relevant,
    command: input.bin,
    resolution,
    versionCommand: `${input.bin} --version`,
    helpCommand: commands.inspect,
    schemaCommands: {
      typescript: commands.generateTypes,
      jsonSchema: commands.generateJsonSchema,
    },
    connect: {
      transport: "stdio",
      command: commands.connectStdio,
      note: "Forge Studio should prefer stdio when it owns the Codex app-server child process; hooks remain the fallback observer path.",
    },
    security: {
      websocket: {
        defaultPosture: "Do not expose a Codex app-server WebSocket listener beyond loopback.",
        recommendation: "Use a token file or signed bearer token before enabling remote WebSocket access.",
      },
      shellCommandRisk: "Methods that execute shell commands outside the normal sandbox must stay tied to explicit user intent.",
      authoritativeEvents: "Treat item/completed events as authoritative; deltas and started events are progress signals.",
    },
  };
}

export function inspectCodexAppServer(options: {
  workspaceRoot: string;
  relevant: boolean;
  bin?: string;
  forceRefresh?: boolean;
}): CodexAppServerProof {
  const bin = options.bin || process.env.FORGE_CODEX_BIN || DEFAULT_CODEX_BIN;
  const cacheKey = `${bin}:${options.relevant}:${process.env.FORGE_CODEX_APP_SERVER ?? "auto"}`;
  if (!options.forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const base = baseProof({ relevant: options.relevant, bin });
  if (!options.relevant) {
    const proof: CodexAppServerProof = {
      ...base,
      state: "disabled",
      available: false,
      checks: [{
        name: "codex-target",
        ok: true,
        status: "skipped",
        message: "Codex app-server was not checked because Codex is not one of the selected Studio targets.",
        suggestedCommands: [],
      }],
      nextActions: [],
    };
    cache.set(cacheKey, proof);
    return proof;
  }

  if (process.env.FORGE_CODEX_APP_SERVER === "off" || process.env.FORGE_CODEX_APP_SERVER === "0") {
    const proof: CodexAppServerProof = {
      ...base,
      state: "disabled",
      available: false,
      checks: [{
        name: "codex-app-server",
        ok: true,
        status: "skipped",
        message: "Codex app-server probing is disabled by FORGE_CODEX_APP_SERVER.",
        suggestedCommands: [base.helpCommand],
      }],
      nextActions: [base.helpCommand],
    };
    cache.set(cacheKey, proof);
    return proof;
  }

  const version = runProbe(bin, ["--version"], options.workspaceRoot, 900);
  const help = runProbe(bin, ["app-server", "--help"], options.workspaceRoot, 1500);
  const combinedHelp = `${help.stdout}\n${help.stderr}`;
  const supportsAppServer = help.ok || /app-server/i.test(combinedHelp);
  const available = help.ok && supportsAppServer;
  const state: CodexAppServerState = available
    ? "ready"
    : version.error || help.error
      ? "missing"
      : "unsupported";
  const versionText = sampleText(version.stdout || version.stderr);
  const helpSample = sampleText(combinedHelp);
  const error = help.error ?? version.error;
  const checks: CodexAppServerProof["checks"] = [
    {
      name: "codex-cli",
      ok: version.ok || help.ok,
      status: version.ok || help.ok ? "ok" : "failed",
      message: version.ok
        ? `Codex CLI responded: ${versionText ?? "version available"}`
        : `Codex CLI did not respond${version.error ? `: ${version.error}` : ""}`,
      suggestedCommands: [`${bin} --version`],
    },
    {
      name: "codex-app-server",
      ok: available,
      status: available ? "ok" : "warning",
      message: available
        ? "Codex app-server help is available for deep Studio integration."
        : supportsAppServer
          ? "Codex mentions app-server, but the help probe did not exit cleanly."
          : "Codex app-server was not detected; Studio can still use hooks and MCP as the observer path.",
      suggestedCommands: [base.helpCommand],
    },
    {
      name: "codex-app-server-schemas",
      ok: available,
      status: available ? "ok" : "warning",
      message: available
        ? `Generate version-matched schemas into ${SCHEMA_DIR} before implementing a streaming client.`
        : "Schema generation is unavailable until Codex app-server is detected.",
      suggestedCommands: [base.schemaCommands.typescript, base.schemaCommands.jsonSchema],
    },
  ];
  const nextActions = available
    ? [base.schemaCommands.typescript, base.schemaCommands.jsonSchema, base.connect.command]
    : [base.helpCommand, "forge agent hooks status --target codex --json"];
  const proof: CodexAppServerProof = {
    ...base,
    state,
    available,
    checks,
    ...(versionText ? { version: versionText } : {}),
    ...(helpSample ? { helpSample } : {}),
    ...(error ? { error } : {}),
    nextActions,
  };
  cache.set(cacheKey, proof);
  return proof;
}

export function generateCodexAppServerSchemas(options: {
  workspaceRoot: string;
  bin?: string;
  dryRun: boolean;
}): CodexAppServerSchemaGenerationResult {
  const bin = options.bin || process.env.FORGE_CODEX_BIN || DEFAULT_CODEX_BIN;
  const commands = codexAppServerCommands(bin);
  if (options.dryRun) {
    return {
      attempted: false,
      dryRun: true,
      ok: true,
      outDir: SCHEMA_DIR,
      commands: {
        typescript: commands.generateTypes,
        jsonSchema: commands.generateJsonSchema,
      },
      results: [],
      files: listSchemaFiles(options.workspaceRoot),
      nextActions: [commands.generateTypes, commands.generateJsonSchema],
    };
  }

  const specs = [
    {
      name: "typescript" as const,
      args: ["app-server", "generate-ts", "--out", SCHEMA_DIR],
      command: commands.generateTypes,
    },
    {
      name: "jsonSchema" as const,
      args: ["app-server", "generate-json-schema", "--out", SCHEMA_DIR],
      command: commands.generateJsonSchema,
    },
  ];
  const results = specs.map((spec) => {
    const run = runProbe(bin, spec.args, options.workspaceRoot, 30_000);
    return {
      name: spec.name,
      ok: run.ok,
      exitCode: run.exitCode,
      command: spec.command,
      ...(sampleText(run.stdout) ? { stdout: sampleText(run.stdout) } : {}),
      ...(sampleText(run.stderr) ? { stderr: sampleText(run.stderr) } : {}),
      ...(run.error ? { error: run.error } : {}),
    };
  });
  const ok = results.every((result) => result.ok);
  return {
    attempted: true,
    dryRun: false,
    ok,
    outDir: SCHEMA_DIR,
    commands: {
      typescript: commands.generateTypes,
      jsonSchema: commands.generateJsonSchema,
    },
    results,
    files: listSchemaFiles(options.workspaceRoot),
    nextActions: ok
      ? [commands.connectStdio]
      : [commands.generateTypes, commands.generateJsonSchema, commands.inspect],
  };
}

export function skippedCodexAppServerHandshake(options: {
  reason: CodexAppServerHandshakeResult["skippedReason"];
  dryRun: boolean;
  bin?: string;
}): CodexAppServerHandshakeResult {
  const commands = codexAppServerCommands(options.bin);
  return {
    attempted: false,
    dryRun: options.dryRun,
    ok: options.reason !== "unavailable",
    transport: "stdio",
    command: commands.connectStdio,
    initialized: false,
    durationMs: 0,
    skippedReason: options.reason,
    clientInfo: {
      name: "forge_studio",
      title: "Forge Studio",
      version: "0.1.0",
    },
    messages: {
      responses: 0,
      notifications: 0,
    },
    nextActions: options.reason === "not-requested"
      ? [commands.probeHandshake]
      : options.reason === "disabled"
        ? [commands.inspect]
        : [commands.connectStdio, commands.inspect],
  };
}

export async function probeCodexAppServerHandshake(options: {
  workspaceRoot: string;
  bin?: string;
  dryRun: boolean;
  timeoutMs?: number;
  available?: boolean;
  disabled?: boolean;
}): Promise<CodexAppServerHandshakeResult> {
  const bin = options.bin || process.env.FORGE_CODEX_BIN || DEFAULT_CODEX_BIN;
  const commands = codexAppServerCommands(bin);
  if (options.dryRun) {
    return skippedCodexAppServerHandshake({ reason: "dry-run", dryRun: true, bin });
  }
  if (options.disabled || process.env.FORGE_CODEX_APP_SERVER === "off" || process.env.FORGE_CODEX_APP_SERVER === "0") {
    return skippedCodexAppServerHandshake({ reason: "disabled", dryRun: false, bin });
  }
  if (options.available === false) {
    return skippedCodexAppServerHandshake({ reason: "unavailable", dryRun: false, bin });
  }

  const clientInfo = {
    name: "forge_studio",
    title: "Forge Studio",
    version: "0.1.0",
  };
  const resolved = resolveCodexExecutable(bin);
  const invocation = buildProbeInvocation(resolved, ["app-server"]);
  const startedAt = Date.now();

  return new Promise<CodexAppServerHandshakeResult>((resolve) => {
    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let responses = 0;
    let notifications = 0;
    let firstNotification: string | undefined;
    let initializeResult: CodexAppServerHandshakeResult["initializeResult"];
    let readiness: CodexAppServerHandshakeResult["readiness"];
    let exitCode: number | null | undefined;
    let signal: NodeJS.Signals | null | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (partial: Partial<CodexAppServerHandshakeResult>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        child?.stdin?.end();
      } catch {
        // best effort only
      }
      if (child && !child.killed) {
        child.kill();
      }
      resolve({
        attempted: true,
        dryRun: false,
        ok: partial.ok === true,
        transport: "stdio",
        command: commands.connectStdio,
        initialized: partial.initialized === true,
        durationMs: Date.now() - startedAt,
        clientInfo,
        messages: {
          responses,
          notifications,
          ...(firstNotification ? { firstNotification } : {}),
        },
        ...(initializeResult ? { initializeResult } : {}),
        ...(partial.readiness ?? readiness ? { readiness: partial.readiness ?? readiness } : {}),
        ...(sampleLines(stderrBuffer).length > 0 ? { stderrSample: sampleLines(stderrBuffer) } : {}),
        ...(partial.error ? { error: partial.error } : {}),
        exitCode: partial.exitCode ?? exitCode ?? null,
        signal: partial.signal ?? signal ?? null,
        nextActions: partial.ok === true
          ? [commands.generateTypes, commands.generateJsonSchema]
          : [commands.inspect, commands.connectStdio],
      });
    };

    child = spawn(invocation.command, invocation.args, {
      cwd: options.workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    timer = setTimeout(() => {
      const timeoutMs = options.timeoutMs ?? 5000;
      if (initializeResult && readiness) {
        finish({
          ok: true,
          initialized: true,
          readiness: timedOutReadiness(readiness, timeoutMs),
        });
        return;
      }
      finish({ ok: false, initialized: false, error: `timed out after ${timeoutMs}ms` });
    }, options.timeoutMs ?? 5000);

    child.once("error", (error) => {
      finish({ ok: false, initialized: false, error: error.message });
    });
    child.once("close", (code, exitSignal) => {
      exitCode = code;
      signal = exitSignal;
      if (!settled) {
        finish({
          ok: false,
          initialized: false,
          exitCode: code,
          signal: exitSignal,
          error: "codex app-server exited before the initialize handshake completed",
        });
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderrBuffer += String(chunk);
    });
    child.stdout?.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      let newline = stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line) {
          try {
            const message = JSON.parse(line) as {
              id?: unknown;
              method?: unknown;
              result?: unknown;
              error?: { message?: unknown };
            };
            if (message.id !== undefined) {
              responses += 1;
            } else if (typeof message.method === "string") {
              notifications += 1;
              firstNotification ??= message.method;
            }
            if (message.id === 1) {
              if (message.error) {
                finish({
                  ok: false,
                  initialized: false,
                  error: typeof message.error.message === "string"
                    ? message.error.message
                    : "initialize failed",
                });
                return;
              }
              initializeResult = summarizeInitializeResult(message.result);
              readiness = initialReadiness();
              child.stdin?.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
              child.stdin?.write(`${JSON.stringify({ method: "model/list", id: 2, params: { limit: 5, includeHidden: false } })}\n`);
              child.stdin?.write(`${JSON.stringify({ method: "account/read", id: 3, params: { refreshToken: false } })}\n`);
              return;
            }
            if (message.id === 2 && readiness) {
              readiness = {
                ...readiness,
                modelList: summarizeModelListReadiness(message),
              };
              if (readiness.accountRead.responded) {
                finish({ ok: true, initialized: true, readiness });
              }
              return;
            }
            if (message.id === 3 && readiness) {
              readiness = {
                ...readiness,
                accountRead: summarizeAccountReadReadiness(message),
              };
              if (readiness.modelList.responded) {
                finish({ ok: true, initialized: true, readiness });
              }
              return;
            }
          } catch {
            stderrBuffer += `\nUnparseable app-server stdout line: ${line.slice(0, 200)}`;
          }
        }
        newline = stdoutBuffer.indexOf("\n");
      }
    });

    child.stdin?.write(`${JSON.stringify({
      method: "initialize",
      id: 1,
      params: { clientInfo },
    })}\n`);
  });
}
