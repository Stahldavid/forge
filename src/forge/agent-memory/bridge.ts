import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DeltaStore } from "../delta/store.ts";
import { extractAgentEventBindings, normalizeAgentEvent, summarizeAgentEvent } from "./normalize.ts";
import { buildAgentMemoryContext } from "./context-pack.ts";
import { claudeCodeInstallFiles, claudeCodeInstallResult } from "./sources/claude-code.ts";
import { codexInstallFiles, codexInstallResult, privacyDefaults } from "./sources/codex.ts";
import { cursorInstallFiles, cursorInstallResult } from "./sources/cursor.ts";
import type {
  AgentEventEnvelope,
  AgentIngestResult,
  AgentInstallResult,
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
}

export type AgentMemoryCommandResult =
  | AgentInstallResult
  | AgentIngestResult
  | AgentMemoryContextPack
  | { ok: true; events: AgentMemoryEventRecord[]; exitCode: 0 };

export async function runAgentMemoryCommand(options: AgentMemoryCommandOptions): Promise<AgentMemoryCommandResult> {
  if (options.subcommand === "install") {
    return installAgentMemory(options);
  }
  if (options.subcommand === "ingest") {
    return ingestAgentMemory(options);
  }
  if (options.subcommand === "context") {
    return buildAgentMemoryContext({
      workspaceRoot: options.workspaceRoot,
      entry: options.entry,
      limit: options.limit,
    });
  }
  const store = await DeltaStore.open(options.workspaceRoot);
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
  const store = await DeltaStore.open(workspaceRoot);
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
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  const events = "events" in result ? result.events : [];
  return `${JSON.stringify(events, null, 2)}\n`;
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
