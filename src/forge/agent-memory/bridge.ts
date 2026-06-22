import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { DeltaStore, DeltaStoreBusyError, describeDeltaStoreBusy } from "../delta/store.ts";
import { extractAgentEventBindings, normalizeAgentEvent, summarizeAgentEvent } from "./normalize.ts";
import { buildAgentMemoryContext } from "./context-pack.ts";
import { claudeCodeInstallFiles, claudeCodeInstallResult } from "./sources/claude-code.ts";
import { codexInstallFiles, codexInstallResult, privacyDefaults } from "./sources/codex.ts";
import { cursorInstallFiles, cursorInstallResult } from "./sources/cursor.ts";
import type {
  AgentEventEnvelope,
  AgentIngestResult,
  AgentIngestWatchResult,
  AgentInstallResult,
  AgentMemoryUnavailableResult,
  AgentMemoryContextPack,
  AgentMemoryEventRecord,
  AgentMemorySourceName,
} from "./types.ts";

export interface AgentMemoryCommandOptions {
  subcommand: "install" | "ingest" | "context" | "memory";
  workspaceRoot: string;
  json: boolean;
  target?: string;
  source?: string;
  eventName?: string;
  input?: unknown;
  entry?: string;
  current?: boolean;
  dryRun?: boolean;
  force?: boolean;
  limit?: number;
  watch?: boolean;
  file?: string;
  pollIntervalMs?: number;
}

export type AgentMemoryCommandResult =
  | AgentInstallResult
  | AgentIngestResult
  | AgentIngestWatchResult
  | AgentMemoryContextPack
  | { ok: true; events: AgentMemoryEventRecord[]; exitCode: 0 }
  | AgentMemoryUnavailableResult;

function memoryUnavailable(error: unknown, workspaceRoot: string): AgentMemoryUnavailableResult {
  const message = error instanceof Error ? error.message : "agent memory store is unavailable";
  const busy = error instanceof DeltaStoreBusyError;
  const busyInfo = busy ? describeDeltaStoreBusy(error, workspaceRoot) : undefined;
  const busySummary = busyInfo
    ? [
        `lock=${busyInfo.relativeLockPath}`,
        busyInfo.pid ? `pid=${busyInfo.pid}` : undefined,
        busyInfo.processAlive ? "process=alive" : "process=unknown-or-exited",
        typeof busyInfo.ageMs === "number" ? `age=${Math.round(busyInfo.ageMs / 1000)}s` : undefined,
      ].filter(Boolean).join(", ")
    : undefined;
  return {
    ok: false,
    error: busySummary ? `${message} (${busySummary})` : message,
    events: [],
    ...(busyInfo ? { busy: busyInfo } : {}),
    diagnostics: [
      createDiagnostic({
        severity: "error",
        code: busy ? "FORGE_DELTA_BUSY" : "FORGE_AGENT_MEMORY_UNAVAILABLE",
        message: busy
          ? `Forge Delta local store is busy: ${message}${busySummary ? ` (${busySummary})` : ""}`
          : message,
        ...(busy
          ? {
              fixHint: busyInfo?.processAlive
                ? `Wait for pid ${busyInfo.pid ?? "shown in the lock file"} to finish, then retry the agent memory command.`
                : `If no Forge/agent process is still running, inspect ${busyInfo?.relativeLockPath ?? ".forge/delta/delta.lock"} and retry.`,
              suggestedCommands: [
                "forge delta status --json",
                "forge agent timeline --json",
                "forge agent hooks status --target codex --json",
              ],
            }
          : {}),
      }),
    ],
    nextActions: [
      "forge delta status --json",
      ...(busyInfo?.processAlive ? [] : ["forge delta repair --dry-run --json"]),
      "forge agent timeline --json",
      "forge agent hooks status --target codex --json",
    ],
    exitCode: 1,
  };
}

async function openMemoryStore(
  workspaceRoot: string,
  access: "read" | "write" = "write",
): Promise<DeltaStore | AgentMemoryUnavailableResult> {
  try {
    return await DeltaStore.open(workspaceRoot, { access });
  } catch (error) {
    return memoryUnavailable(error, workspaceRoot);
  }
}

function isMemoryUnavailable(result: DeltaStore | AgentMemoryUnavailableResult): result is AgentMemoryUnavailableResult {
  return "ok" in result && result.ok === false;
}

function isExternalPgliteRead(result: AgentMemoryUnavailableResult): boolean {
  return Boolean(
    result.busy?.relativeLockPath.endsWith("postmaster.pid") &&
    result.busy.processAlive === false,
  );
}

export async function runAgentMemoryCommand(options: AgentMemoryCommandOptions): Promise<AgentMemoryCommandResult> {
  if (options.subcommand === "install") {
    return installAgentMemory(options);
  }
  if (options.subcommand === "ingest") {
    if (options.watch) {
      return watchAgentMemoryIngest(options);
    }
    return ingestAgentMemory(options);
  }
  if (options.subcommand === "context") {
    try {
      return await buildAgentMemoryContext({
        workspaceRoot: options.workspaceRoot,
        entry: options.entry,
        limit: options.limit,
      });
    } catch (error) {
      return memoryUnavailable(error, options.workspaceRoot);
    }
  }
  const store = await openMemoryStore(options.workspaceRoot, "read");
  if (isMemoryUnavailable(store)) {
    if (isExternalPgliteRead(store)) {
      return {
        ok: true,
        events: [],
        exitCode: 0,
      };
    }
    return store;
  }
  try {
    return {
      ok: true,
      events: await store.listAgentMemoryEvents({ target: options.entry, limit: options.limit }),
      exitCode: 0,
    };
  } finally {
    await store.close();
  }
}

export async function ingestEnvelope(workspaceRoot: string, envelope: AgentEventEnvelope): Promise<AgentIngestResult> {
  const store = await openMemoryStore(workspaceRoot, "write");
  if (isMemoryUnavailable(store)) {
    return {
      ...store,
      envelope,
    };
  }
  try {
    const bindings = extractAgentEventBindings(envelope);
    const summary = summarizeAgentEvent(envelope);
    const event = await store.recordAgentMemoryEvent({ envelope, summary, bindings });
    return { ok: true, event, envelope, exitCode: 0 };
  } finally {
    await store.close();
  }
}

async function ingestAgentMemory(options: AgentMemoryCommandOptions): Promise<AgentIngestResult> {
  const source = options.source ?? options.target ?? "generic";
  const raw = normalizeRawInput(options.input ?? await readStdinJson());
  if (!raw) {
    return { ok: false, exitCode: 1, error: "agent ingest requires JSON input on stdin or --input" };
  }
  const envelope = normalizeAgentEvent({
    workspaceRoot: options.workspaceRoot,
    source,
    eventName: options.eventName,
    raw,
    integration: source === "cursor" ? "mcp" : "native-hook",
  });
  return ingestEnvelope(options.workspaceRoot, envelope);
}

function parseJsonLines(content: string): Array<Record<string, unknown>> {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
        );
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return [parsed as Record<string, unknown>];
      }
    } catch {
      // Fall through to NDJSON parsing below.
    }
  }
  const values: Array<Record<string, unknown>> = [];
  for (const line of content.split(/\r?\n/)) {
    const parsed = normalizeRawInput(line);
    if (parsed) {
      values.push(parsed);
    }
  }
  return values;
}

async function watchAgentMemoryIngest(options: AgentMemoryCommandOptions): Promise<AgentIngestWatchResult> {
  const source = options.source ?? options.target ?? "generic";
  const file = options.file;
  if (options.dryRun) {
    return {
      ok: true,
      watch: true,
      source,
      ...(file ? { file } : {}),
      dryRun: true,
      eventsIngested: 0,
      errors: [],
      nextActions: [
        `forge agent ingest ${source} --watch${file ? ` --file ${file}` : ""} --json`,
        `forge agent hooks status --target ${source} --json`,
      ],
      exitCode: 0,
    };
  }
  if (!file) {
    return {
      ok: false,
      watch: true,
      source,
      eventsIngested: 0,
      errors: ["agent ingest --watch requires --file <events.jsonl|events.ndjson>"],
      nextActions: [`forge agent ingest ${source} --watch --file .forge/agent/events.ndjson --json`],
      exitCode: 1,
    };
  }
  const watchFile = isAbsolute(file) ? file : resolve(options.workspaceRoot, file);
  if (!existsSync(watchFile)) {
    return {
      ok: false,
      watch: true,
      source,
      file,
      eventsIngested: 0,
      errors: [`watch file does not exist: ${file}`],
      nextActions: [`New-Item -ItemType File -Path ${file}`, `forge agent ingest ${source} --watch --file ${file} --json`],
      exitCode: 1,
    };
  }

  let bytesRead = 0;
  let eventsIngested = 0;
  const errors: string[] = [];
  const ingestNewContent = async () => {
    if (!existsSync(watchFile)) {
      return;
    }
    const content = readFileSync(watchFile, "utf8");
    const next = content.slice(bytesRead);
    bytesRead = content.length;
    for (const raw of parseJsonLines(next)) {
      const result = await ingestEnvelope(options.workspaceRoot, normalizeAgentEvent({
        workspaceRoot: options.workspaceRoot,
        source,
        eventName: options.eventName,
        raw,
        integration: source === "cursor" ? "mcp" : "native-hook",
      }));
      if (result.ok) {
        eventsIngested += 1;
      } else {
        errors.push(result.error ?? "agent memory ingest failed");
      }
    }
  };

  await ingestNewContent();
  return await new Promise<AgentIngestWatchResult>((resolve) => {
    const watcher = watch(watchFile, { persistent: true }, () => {
      void ingestNewContent();
    });
    const shutdown = () => {
      watcher.close();
      resolve({
        ok: errors.length === 0,
        watch: true,
        source,
        file,
        eventsIngested,
        errors,
        nextActions: [
          `forge agent memory --entry ${source} --json`,
          `forge agent hooks status --target ${source} --json`,
        ],
        exitCode: errors.length === 0 ? 0 : 1,
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

function installAgentMemory(options: AgentMemoryCommandOptions): AgentInstallResult {
  const target = normalizeInstallTarget(options.target ?? options.source ?? "generic");
  const files =
    target === "codex"
      ? codexInstallFiles()
      : target === "claude-code"
        ? claudeCodeInstallFiles()
        : target === "cursor"
          ? cursorInstallFiles()
          : [];
  if (files.length === 0) {
    return {
      ok: false,
      target,
      filesWritten: [],
      filesPlanned: [],
      privacy: privacyDefaults(),
      warnings: [`unknown agent memory install target: ${target}`],
      exitCode: 1,
    };
  }
  const filesWritten: string[] = [];
  for (const file of files) {
    const absolute = join(options.workspaceRoot, file.path);
    const content = maybeMergeJson(absolute, file.content);
    if (options.dryRun) {
      continue;
    }
    if (!options.force && existsSync(absolute) && readFileSync(absolute, "utf8") === content) {
      continue;
    }
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    filesWritten.push(file.path);
  }
  const planned = files.map((file) => file.path);
  if (target === "codex") {
    return codexInstallResult(filesWritten, planned);
  }
  if (target === "claude-code") {
    return claudeCodeInstallResult(filesWritten, planned);
  }
  return cursorInstallResult(filesWritten, planned);
}

export function formatAgentMemoryJson(result: AgentMemoryCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatAgentMemoryHuman(result: AgentMemoryCommandResult): string {
  if ("event" in result || "envelope" in result) {
    return result.ok
      ? `agent memory ingested: ${result.event?.normalizedKind ?? "event"}\n`
      : `agent memory ingest failed: ${result.error ?? "unknown error"}\n`;
  }
  if ("watch" in result) {
    return [
      `agent memory watch ${result.ok ? "ready" : "failed"} for ${result.source}`,
      ...(result.file ? [`file: ${result.file}`] : []),
      `events ingested: ${result.eventsIngested}`,
      ...(result.errors.length > 0 ? ["errors:", ...result.errors.map((error) => `- ${error}`)] : []),
    ].join("\n") + "\n";
  }
  if ("filesPlanned" in result) {
    return [
      `Forge Agent Memory Bridge ${result.ok ? "installed" : "failed"} for ${result.target}.`,
      "files written:",
      ...(result.filesWritten.length > 0 ? result.filesWritten.map((file) => `- ${file}`) : ["- none"]),
      "privacy:",
      "- raw prompts: off",
      "- raw completions: off",
      "- raw tool args: off",
      "- transcript import: off",
    ].join("\n") + "\n";
  }
  if ("agentMemory" in result) {
    return formatAgentMemoryContextHuman(result);
  }
  if (!result.ok) {
    const nextActions = "nextActions" in result && Array.isArray(result.nextActions) ? result.nextActions : [];
    return [
      "Forge Agent Memory unavailable",
      "",
      result.error ?? "agent memory command failed",
      ...(nextActions.length > 0 ? ["", "Next:", ...nextActions.map((action) => `  ${action}`)] : []),
    ].join("\n") + "\n";
  }
  return formatAgentMemoryEventsHuman("events" in result ? result.events : []);
}

function formatAgentMemoryContextHuman(result: AgentMemoryContextPack): string {
  const summary = result.agentMemory.summary;
  const lines = [
    `Forge Agent Context (${result.scope}${result.entry ? `: ${result.entry}` : ""})`,
    "",
    `events: ${summary.events}`,
    `sources: ${summary.sources.length > 0 ? summary.sources.join(", ") : "none"}`,
    `tools: ${summary.tools.length > 0 ? summary.tools.join(", ") : "none"}`,
    `files: ${summary.files}`,
    `entries: ${summary.entries}`,
    `proofs: ${summary.proofs}`,
    ...(summary.latestEventAt ? [`latest: ${summary.latestEventAt}`] : []),
  ];
  if (Object.keys(result.currentState).length > 0) {
    lines.push("", "Current:");
    for (const [key, value] of Object.entries(result.currentState)) {
      if (value !== undefined) {
        lines.push(`  ${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
      }
    }
  }
  const recent = result.agentMemory.events.slice(-5);
  if (recent.length > 0) {
    lines.push("", "Recent:");
    for (const event of recent) {
      const parts = [
        event.capturedAt,
        event.source,
        event.kind,
        event.tool,
        event.status,
        event.summary,
      ].filter(Boolean);
      lines.push(`  - ${parts.join(" | ")}`);
    }
  }
  if (result.agentMemory.openQuestions.length > 0) {
    lines.push("", "Open questions:");
    for (const question of result.agentMemory.openQuestions.slice(0, 5)) {
      lines.push(`  - ${question}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatAgentMemoryEventsHuman(events: AgentMemoryEventRecord[]): string {
  const sources = uniqueStrings(events.map((event) => event.sourceName));
  const tools = uniqueStrings(events.flatMap((event) => {
    const tool = agentMemoryEventBindings(event).toolName;
    return tool ? [tool] : [];
  }));
  const latest = events.at(-1)?.capturedAt;
  const lines = [
    "Forge Agent Memory",
    "",
    `events: ${events.length}`,
    `sources: ${sources.length > 0 ? sources.join(", ") : "none"}`,
    `tools: ${tools.length > 0 ? tools.join(", ") : "none"}`,
    ...(latest ? [`latest: ${latest}`] : []),
  ];
  if (events.length === 0) {
    lines.push("", "no agent memory events recorded");
    return `${lines.join("\n")}\n`;
  }
  lines.push("", "Recent:");
  for (const event of events.slice(-12)) {
    const bindings = agentMemoryEventBindings(event);
    const parts = [
      event.capturedAt,
      event.sourceName,
      event.normalizedKind,
      bindings.toolName,
      bindings.status,
      event.summary,
    ].filter(Boolean);
    lines.push(`  - ${parts.join(" | ")}`);
    const details = [
      bindings.command ? `command: ${bindings.command}` : undefined,
      bindings.files.length > 0 ? `files: ${bindings.files.slice(0, 4).join(", ")}` : undefined,
      bindings.entries.length > 0 ? `entries: ${bindings.entries.slice(0, 4).join(", ")}` : undefined,
      bindings.proofs.length > 0 ? `proofs: ${bindings.proofs.slice(0, 4).join(", ")}` : undefined,
    ].filter(Boolean);
    if (details.length > 0) {
      lines.push(`    ${details.join(" | ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function agentMemoryEventBindings(event: AgentMemoryEventRecord): {
  toolName?: string;
  command?: string;
  status?: string;
  files: string[];
  entries: string[];
  proofs: string[];
} {
  const raw = event.data.bindings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { files: [], entries: [], proofs: [] };
  }
  const record = raw as Record<string, unknown>;
  return {
    toolName: typeof record.toolName === "string" ? record.toolName : undefined,
    command: typeof record.command === "string" ? record.command : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    files: arrayOfStrings(record.files),
    entries: arrayOfStrings(record.entries),
    proofs: arrayOfStrings(record.proofs),
  };
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function normalizeInstallTarget(target: string): AgentMemorySourceName | string {
  if (target === "claude") {
    return "claude-code";
  }
  return target;
}

function normalizeRawInput(input: unknown): Record<string, unknown> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string" && input.trim()) {
    try {
      const parsed = JSON.parse(input) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function readStdinJson(): Promise<unknown> {
  if (process.stdin.isTTY) {
    return undefined;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? raw : undefined;
}

function maybeMergeJson(path: string, generated: string): string {
  if (!existsSync(path) || !path.endsWith(".json")) {
    return generated;
  }
  try {
    const current = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const next = JSON.parse(generated) as unknown;
    if (!current || typeof current !== "object" || Array.isArray(current) || !next || typeof next !== "object" || Array.isArray(next)) {
      return generated;
    }
    return `${JSON.stringify(deepMerge(current as Record<string, unknown>, next as Record<string, unknown>), null, 2)}\n`;
  } catch {
    return generated;
  }
}

function deepMerge(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = output[key];
    output[key] =
      existing && typeof existing === "object" && !Array.isArray(existing) &&
      value && typeof value === "object" && !Array.isArray(value)
        ? deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return output;
}
