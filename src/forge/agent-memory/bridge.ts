import { appendFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { createDeltaId } from "../delta/ids.ts";
import { DeltaStore, DeltaStoreBusyError, describeDeltaStoreBusy, summarizeDeltaStoreBusy } from "../delta/store.ts";
import { extractAgentEventBindings, normalizeAgentEvent, summarizeAgentEvent } from "./normalize.ts";
import { redactAgentPayload } from "./redaction.ts";
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
  change?: string;
  proof?: string;
  handoff?: boolean;
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

export interface AgentMemoryQueueInspectionResult {
  exists: boolean;
  source: string;
  file: string;
  events: number;
  nativeSignals: number;
  canarySignals: number;
  usefulSignals: number;
  ignoredOutOfWorkspaceEvents: number;
  bytesRead: number;
  pendingBytes: number;
  inspectedBytes?: number;
  skippedBytes?: number;
  truncated?: boolean;
  checkpointFile: string;
  errors: string[];
  latestEventAt?: string;
}

function memoryUnavailable(error: unknown, workspaceRoot: string): AgentMemoryUnavailableResult {
  const message = error instanceof Error ? error.message : "agent memory store is unavailable";
  const busy = error instanceof DeltaStoreBusyError;
  const busyInfo = busy ? describeDeltaStoreBusy(error, workspaceRoot) : undefined;
  const busySummary = busyInfo ? summarizeDeltaStoreBusy(busyInfo) : undefined;
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
  const retryDelays = access === "write" ? [25, 75, 150] : [];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await DeltaStore.open(workspaceRoot, {
        access,
        ...(access === "write" ? { waitMs: 1_500, retryDelayMs: 50 } : {}),
      });
    } catch (error) {
      if (!(error instanceof DeltaStoreBusyError) || attempt >= retryDelays.length) {
        return memoryUnavailable(error, workspaceRoot);
      }
      await sleep(retryDelays[attempt] ?? 0);
    }
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

function isDeltaBusyIngestResult(result: AgentIngestResult): boolean {
  return result.ok === false && result.busy?.code === "FORGE_DELTA_BUSY";
}

function fallbackMemoryPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".forge", "agent", "events.ndjson");
}

function hasExternalPglitePostmaster(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, ".forge", "delta", "delta.db", "postmaster.pid")) &&
    !existsSync(join(workspaceRoot, ".forge", "delta", "delta.lock"));
}

function shouldUseFallbackMemory(
  result: AgentMemoryUnavailableResult,
  workspaceRoot: string,
): boolean {
  return isExternalPgliteRead(result) || (!result.busy && hasExternalPglitePostmaster(workspaceRoot));
}

function eventRecordFromEnvelope(
  envelope: AgentEventEnvelope,
  summary: string | undefined,
  bindings: Record<string, unknown>,
): AgentMemoryEventRecord {
  const capturedAt = envelope.event.timestamp || new Date().toISOString();
  return {
    id: createDeltaId("amem"),
    externalEventId: createDeltaId("aevt"),
    sourceName: String(envelope.source.agent),
    integrationKind: String(envelope.source.integration),
    trustLevel: envelope.capture.trustLevel,
    externalSessionId: envelope.session.externalSessionId,
    externalTurnId: envelope.session.turnId,
    eventKind: envelope.event.kind,
    normalizedKind: envelope.event.kind,
    summary,
    confidence: envelope.capture.confidence,
    capturedAt,
    data: { envelope, bindings },
  };
}

function appendFallbackAgentMemoryEvent(
  workspaceRoot: string,
  envelope: AgentEventEnvelope,
  summary: string | undefined,
  bindings: Record<string, unknown>,
): AgentMemoryEventRecord {
  const file = fallbackMemoryPath(workspaceRoot);
  mkdirSync(dirname(file), { recursive: true });
  const event = eventRecordFromEnvelope(envelope, summary, bindings);
  appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

function readFallbackAgentMemoryEvents(
  workspaceRoot: string,
  target: string | undefined,
  limit: number | undefined,
): AgentMemoryEventRecord[] {
  const file = fallbackMemoryPath(workspaceRoot);
  if (!existsSync(file)) {
    return [];
  }
  const events: AgentMemoryEventRecord[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isAgentMemoryEventRecord(parsed) && agentMemoryEventMatchesTarget(parsed, target)) {
        events.push(parsed);
      }
    } catch {
      // Keep fallback recovery best effort; malformed lines should not break hooks.
    }
  }
  return limit ? events.slice(-Math.max(1, Math.min(limit, 200))) : events;
}

function isAgentMemoryEventRecord(value: unknown): value is AgentMemoryEventRecord {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { sourceName?: unknown }).sourceName === "string" &&
    typeof (value as { eventKind?: unknown }).eventKind === "string" &&
    typeof (value as { capturedAt?: unknown }).capturedAt === "string",
  );
}

function agentMemoryEventMatchesTarget(event: AgentMemoryEventRecord, target: string | undefined): boolean {
  if (!target) {
    return true;
  }
  return event.sourceName === target ||
    event.summary?.includes(target) === true ||
    JSON.stringify(event.data).includes(target);
}

function mergeAgentMemoryEvents(
  primary: AgentMemoryEventRecord[],
  fallback: AgentMemoryEventRecord[],
  limit: number | undefined,
): AgentMemoryEventRecord[] {
  const seen = new Set<string>();
  const merged = [...primary, ...fallback]
    .filter((event) => {
      if (seen.has(event.id)) {
        return false;
      }
      seen.add(event.id);
      return true;
    })
    .sort((left, right) => {
      const byTime = left.capturedAt.localeCompare(right.capturedAt);
      return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
    });
  return limit ? merged.slice(-Math.max(1, Math.min(limit, 200))) : merged;
}

function isMissingAgentMemorySchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /agent_memory_events/i.test(message) && /does not exist|no such table|missing/i.test(message);
}

async function listAgentMemoryEventsWithSchemaRepair(
  workspaceRoot: string,
  target: string | undefined,
  limit: number | undefined,
): Promise<AgentMemoryEventRecord[] | AgentMemoryUnavailableResult> {
  const fallbackEvents = readFallbackAgentMemoryEvents(workspaceRoot, target, limit);
  let store = await openMemoryStore(workspaceRoot, "read");
  if (isMemoryUnavailable(store)) {
    if (shouldUseFallbackMemory(store, workspaceRoot)) {
      return fallbackEvents;
    }
    return store;
  }
  try {
    return mergeAgentMemoryEvents(await store.listAgentMemoryEvents({ target, limit }), fallbackEvents, limit);
  } catch (error) {
    await store.close().catch(() => undefined);
    if (!isMissingAgentMemorySchema(error)) {
      return memoryUnavailable(error, workspaceRoot);
    }
    const repairStore = await openMemoryStore(workspaceRoot, "write");
    if (isMemoryUnavailable(repairStore)) {
      return repairStore;
    }
    try {
      await repairStore.init();
      return await repairStore.listAgentMemoryEvents({ target, limit });
    } catch (repairError) {
      return memoryUnavailable(repairError, workspaceRoot);
    } finally {
      await repairStore.close();
    }
  } finally {
    await store.close().catch(() => undefined);
  }
}

export async function runAgentMemoryCommand(options: AgentMemoryCommandOptions): Promise<AgentMemoryCommandResult> {
  if (options.subcommand === "install") {
    return installAgentMemory(options);
  }
  if (options.subcommand === "ingest") {
    if (options.watch) {
      return watchAgentMemoryIngest(options);
    }
    if (options.file) {
      return ingestAgentMemoryQueueFile(options);
    }
    return ingestAgentMemory(options);
  }
  if (options.subcommand === "context") {
    try {
      return await buildAgentMemoryContext({
        workspaceRoot: options.workspaceRoot,
        entry: options.entry,
        change: options.change,
        proof: options.proof,
        handoff: options.handoff,
        limit: options.limit,
      });
    } catch (error) {
      return memoryUnavailable(error, options.workspaceRoot);
    }
  }
  const events = await listAgentMemoryEventsWithSchemaRepair(options.workspaceRoot, options.entry, options.limit);
  if (!Array.isArray(events)) {
    return events;
  }
  return {
    ok: true,
    events,
    exitCode: 0,
  };
}

export async function ingestEnvelope(workspaceRoot: string, envelope: AgentEventEnvelope): Promise<AgentIngestResult> {
  const bindings = extractAgentEventBindings(envelope);
  const summary = summarizeAgentEvent(envelope);
  const store = await openMemoryStore(workspaceRoot, "write");
  if (isMemoryUnavailable(store)) {
    if (shouldUseFallbackMemory(store, workspaceRoot)) {
      const event = appendFallbackAgentMemoryEvent(workspaceRoot, envelope, summary, bindings);
      return {
        ok: true,
        event,
        envelope,
        exitCode: 0,
        fallback: {
          kind: "agent-events-ndjson",
          path: ".forge/agent/events.ndjson",
          reason: "pglite-active",
        },
      };
    }
    return {
      ...store,
      envelope,
    };
  }
  try {
    const event = await store.recordAgentMemoryEvent({ envelope, summary, bindings });
    return { ok: true, event, envelope, exitCode: 0 };
  } finally {
    await store.close();
  }
}

async function ingestAgentMemory(options: AgentMemoryCommandOptions): Promise<AgentIngestResult> {
  const source = options.source ?? options.target ?? "generic";
  const raw = normalizeRawInput(options.input ?? await readStdinJson({ timeoutMs: 2000 }));
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

async function ingestAgentMemoryQueueFile(options: AgentMemoryCommandOptions): Promise<AgentIngestWatchResult> {
  const source = options.source ?? options.target ?? "generic";
  const watchFile = isAbsolute(options.file ?? "")
    ? options.file as string
    : resolve(options.workspaceRoot, options.file ?? "");
  if (!options.file) {
    return {
      ok: false,
      watch: false,
      source,
      eventsIngested: 0,
      errors: ["agent ingest --file requires --file <events.jsonl|events.ndjson>"],
      nextActions: [`forge agent ingest ${source} --file .forge/agent/events.ndjson --json`],
      exitCode: 1,
    };
  }
  if (!existsSync(watchFile)) {
    return {
      ok: false,
      watch: false,
      source,
      file: options.file,
      eventsIngested: 0,
      errors: [`queue file does not exist: ${options.file}`],
      nextActions: [`forge agent hooks status --target ${source} --json`],
      exitCode: 1,
    };
  }
  const drained = await drainAgentMemoryQueueFile({
    workspaceRoot: options.workspaceRoot,
    watchFile,
    source,
    eventName: options.eventName,
  });
  const errors = [
    ...drained.errors,
    ...(drained.busy ? ["DeltaDB is busy; queue checkpoint was not advanced"] : []),
  ];
  return {
    ok: errors.length === 0,
    watch: false,
    source,
    file: options.file,
    eventsIngested: drained.eventsIngested,
    errors,
    bytesRead: drained.bytesRead,
    pendingBytes: drained.pendingBytes,
    checkpointFile: drained.checkpointFile,
    compacted: drained.compacted,
    historyFile: drained.historyFile,
    ...(drained.busy ? { busy: drained.busy, pendingDueToBusy: true } : {}),
    nextActions: [
      ...(drained.busy ? ["forge delta status --json"] : []),
      `forge agent memory --entry ${source} --json`,
      `forge agent hooks status --target ${source} --json`,
    ],
    exitCode: errors.length === 0 ? 0 : 1,
  };
}

function queueCheckpointPath(watchFile: string): string {
  return `${watchFile}.checkpoint.json`;
}

function queueHistoryPath(watchFile: string): string {
  return `${watchFile}.history`;
}

function readQueueCheckpoint(watchFile: string, fileSize: number): number {
  const checkpointFile = queueCheckpointPath(watchFile);
  if (!existsSync(checkpointFile)) {
    return 0;
  }
  try {
    const parsed = JSON.parse(readFileSync(checkpointFile, "utf8")) as unknown;
    const offset = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { offset?: unknown }).offset
      : undefined;
    if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) {
      return 0;
    }
    return offset > fileSize ? 0 : Math.floor(offset);
  } catch {
    return 0;
  }
}

function writeQueueCheckpoint(watchFile: string, offset: number): void {
  const checkpointFile = queueCheckpointPath(watchFile);
  mkdirSync(dirname(checkpointFile), { recursive: true });
  writeFileSync(
    checkpointFile,
    `${JSON.stringify({
      schema: "forge.agent-hook-queue-checkpoint.v1",
      file: watchFile,
      offset,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );
}

const DEFAULT_QUEUE_COMPACT_AFTER_BYTES = 256 * 1024;
const DEFAULT_QUEUE_HISTORY_MAX_BYTES = 1024 * 1024;

function trimBufferStart(buffer: Buffer, maxBytes: number): Buffer {
  if (buffer.length <= maxBytes) {
    return buffer;
  }
  return buffer.subarray(buffer.length - maxBytes);
}

function compactAgentMemoryQueueFile(options: {
  watchFile: string;
  originalBuffer: Buffer;
  consumedOffset: number;
  compactAfterBytes: number;
  historyMaxBytes: number;
}): { compacted: boolean; historyFile: string } {
  const historyFile = queueHistoryPath(options.watchFile);
  if (options.consumedOffset < options.compactAfterBytes) {
    return { compacted: false, historyFile };
  }
  const currentBuffer = readFileSync(options.watchFile);
  const originalConsumed = options.originalBuffer.subarray(0, options.consumedOffset);
  const currentPrefix = currentBuffer.subarray(0, options.consumedOffset);
  if (!currentPrefix.equals(originalConsumed)) {
    return { compacted: false, historyFile };
  }
  mkdirSync(dirname(historyFile), { recursive: true });
  const existingHistory = existsSync(historyFile) ? readFileSync(historyFile) : Buffer.alloc(0);
  const redactedConsumedHistory = redactedQueueHistoryBuffer(originalConsumed);
  writeFileSync(
    historyFile,
    trimBufferStart(Buffer.concat([existingHistory, redactedConsumedHistory]), options.historyMaxBytes),
  );
  writeFileSync(options.watchFile, currentBuffer.subarray(options.consumedOffset));
  writeQueueCheckpoint(options.watchFile, 0);
  return { compacted: true, historyFile };
}

function redactedQueueHistoryBuffer(consumedBuffer: Buffer): Buffer {
  const { complete } = splitCompleteJsonLines(consumedBuffer);
  const lines: string[] = [];
  for (const line of complete) {
    if (!line.raw.trim()) {
      continue;
    }
    const parsed = normalizeRawInput(line.raw);
    if (!parsed) {
      lines.push(JSON.stringify({
        forgeHookQueueV1: true,
        historyRedacted: true,
        rawStored: false,
        payloadRedacted: true,
        payload: { _parseError: true },
      }));
      continue;
    }
    lines.push(JSON.stringify(redactedQueueHistoryEntry(parsed)));
  }
  return Buffer.from(lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
}

function redactedQueueHistoryEntry(parsed: Record<string, unknown>): Record<string, unknown> {
  if (parsed.forgeHookQueueV1 !== true) {
    return {
      historyRedacted: true,
      rawStored: false,
      payloadRedacted: true,
      payload: redactAgentPayload(parsed).value,
    };
  }
  const queuedPayload = objectField(parsed, "payload") ?? objectField(parsed, "raw") ?? {};
  return {
    forgeHookQueueV1: true,
    source: typeof parsed.source === "string" ? parsed.source : "codex",
    eventName: typeof parsed.eventName === "string" ? parsed.eventName : undefined,
    workspaceRoot: typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : undefined,
    enqueuedAt: typeof parsed.enqueuedAt === "string" ? parsed.enqueuedAt : undefined,
    historyRedacted: true,
    rawStored: false,
    payloadRedacted: true,
    payload: parsed.payloadRedacted === true ? queuedPayload : redactAgentPayload(queuedPayload).value,
  };
}

function splitCompleteJsonLines(buffer: Buffer): {
  complete: Array<{ raw: string; endOffset: number }>;
  completeBytes: number;
  pendingBytes: number;
} {
  const lastNewline = buffer.lastIndexOf(10);
  if (lastNewline < 0) {
    return { complete: [], completeBytes: 0, pendingBytes: buffer.length };
  }
  const completeBytes = lastNewline + 1;
  const text = buffer.subarray(0, completeBytes).toString("utf8");
  const lines: Array<{ raw: string; endOffset: number }> = [];
  let offset = 0;
  for (const rawLine of text.split(/(?<=\n)/)) {
    if (!rawLine) {
      continue;
    }
    const byteLength = Buffer.byteLength(rawLine);
    offset += byteLength;
    const normalized = rawLine.replace(/\r?\n$/, "");
    lines.push({ raw: normalized, endOffset: offset });
  }
  return { complete: lines, completeBytes, pendingBytes: buffer.length - completeBytes };
}

const DEFAULT_QUEUE_INSPECT_MAX_BYTES = 1024 * 1024;

function inspectionBufferFromCheckpoint(fileBuffer: Buffer, checkpointOffset: number, maxBytes: number): {
  buffer: Buffer;
  offset: number;
  truncated: boolean;
  skippedBytes: number;
} {
  const availableBytes = Math.max(0, fileBuffer.length - checkpointOffset);
  if (availableBytes <= maxBytes) {
    return {
      buffer: fileBuffer.subarray(checkpointOffset),
      offset: checkpointOffset,
      truncated: false,
      skippedBytes: 0,
    };
  }
  let offset = fileBuffer.length - maxBytes;
  const firstNewline = fileBuffer.subarray(offset).indexOf(10);
  if (firstNewline >= 0) {
    offset += firstNewline + 1;
  }
  return {
    buffer: fileBuffer.subarray(offset),
    offset,
    truncated: true,
    skippedBytes: Math.max(0, offset - checkpointOffset),
  };
}

function shouldSkipQueuedHookEnvelope(
  envelope: AgentEventEnvelope,
  options: { source: string; workspaceRoot: string },
): boolean {
  return (
    envelope.source.agent !== options.source ||
    !workspaceRootsMatch(envelope.workspace.root, options.workspaceRoot) ||
    envelope.payload.forgeHookProbe === true ||
    envelope.payload._parseError === true ||
    envelope.payload._invalidPayload === true
  );
}

export async function drainAgentMemoryQueueFile(options: {
  workspaceRoot: string;
  watchFile: string;
  source: string;
  eventName?: string;
  startOffset?: number;
  compactAfterBytes?: number;
  historyMaxBytes?: number;
}): Promise<{
  eventsIngested: number;
  errors: string[];
  bytesRead: number;
  pendingBytes: number;
  checkpointFile: string;
  compacted: boolean;
  historyFile: string;
  busy?: AgentMemoryUnavailableResult["busy"];
}> {
  const historyFile = queueHistoryPath(options.watchFile);
  if (!existsSync(options.watchFile)) {
    return {
      eventsIngested: 0,
      errors: [],
      bytesRead: 0,
      pendingBytes: 0,
      checkpointFile: queueCheckpointPath(options.watchFile),
      compacted: false,
      historyFile,
    };
  }
  const fileBuffer = readFileSync(options.watchFile);
  let bytesRead = options.startOffset ?? readQueueCheckpoint(options.watchFile, fileBuffer.length);
  if (bytesRead > fileBuffer.length) {
    bytesRead = 0;
  }
  const { complete, pendingBytes } = splitCompleteJsonLines(fileBuffer.subarray(bytesRead));
  let eventsIngested = 0;
  const errors: string[] = [];
  let consumedOffset = bytesRead;

  for (const line of complete) {
    if (!line.raw.trim()) {
      consumedOffset = bytesRead + line.endOffset;
      writeQueueCheckpoint(options.watchFile, consumedOffset);
      continue;
    }
    const parsed = normalizeRawInput(line.raw);
    if (!parsed) {
      errors.push(`could not parse queued hook line at byte ${bytesRead + line.endOffset}`);
      break;
    }
    const queued = parseQueuedHookLine(parsed);
    const payload = queued?.payload ?? parsed;
    const ingestRoot = queued?.workspaceRoot ?? options.workspaceRoot;
    const ingestSource = queued?.source ?? options.source;
    const envelope = normalizeAgentEvent({
      workspaceRoot: ingestRoot,
      source: ingestSource,
      eventName: queued?.eventName ?? options.eventName,
      raw: payload,
      integration: ingestSource === "cursor" ? "mcp" : "native-hook",
    });
    if (shouldSkipQueuedHookEnvelope(envelope, { source: options.source, workspaceRoot: options.workspaceRoot })) {
      consumedOffset = bytesRead + line.endOffset;
      writeQueueCheckpoint(options.watchFile, consumedOffset);
      continue;
    }
    const result = await ingestEnvelope(ingestRoot, envelope);
    if (result.ok) {
      eventsIngested += 1;
      consumedOffset = bytesRead + line.endOffset;
      writeQueueCheckpoint(options.watchFile, consumedOffset);
    } else if (isDeltaBusyIngestResult(result)) {
      return {
        eventsIngested,
        errors,
        bytesRead,
        pendingBytes,
        checkpointFile: queueCheckpointPath(options.watchFile),
        compacted: false,
        historyFile,
        busy: result.busy,
      };
    } else {
      errors.push(result.error ?? "agent memory ingest failed");
      break;
    }
  }

  const retention = errors.length === 0 && consumedOffset > 0
    ? compactAgentMemoryQueueFile({
        watchFile: options.watchFile,
        originalBuffer: fileBuffer,
        consumedOffset,
        compactAfterBytes: options.compactAfterBytes ?? DEFAULT_QUEUE_COMPACT_AFTER_BYTES,
        historyMaxBytes: options.historyMaxBytes ?? DEFAULT_QUEUE_HISTORY_MAX_BYTES,
      })
    : { compacted: false, historyFile };
  const bytesAfterRetention = retention.compacted ? 0 : consumedOffset;

  return {
    eventsIngested,
    errors,
    bytesRead: bytesAfterRetention,
    pendingBytes,
    checkpointFile: queueCheckpointPath(options.watchFile),
    compacted: retention.compacted,
    historyFile: retention.historyFile,
  };
}

function queuedEventHasUsefulSignal(envelope: AgentEventEnvelope): boolean {
  const bindings = extractAgentEventBindings(envelope);
  const files = bindings.files;
  const entries = bindings.entries;
  const proofs = bindings.proofs;
  return (
    typeof bindings.toolName === "string" ||
    typeof bindings.command === "string" ||
    typeof bindings.status === "string" ||
    (Array.isArray(files) && files.length > 0) ||
    (Array.isArray(entries) && entries.length > 0) ||
    (Array.isArray(proofs) && proofs.length > 0)
  );
}

function queuedEventTimestamp(raw: Record<string, unknown>, envelope: AgentEventEnvelope): string | undefined {
  const enqueuedAt = raw.enqueuedAt;
  return typeof enqueuedAt === "string" && enqueuedAt.length > 0
    ? enqueuedAt
    : envelope.event.timestamp;
}

function workspaceRootsMatch(left: string | undefined, right: string): boolean {
  if (!left) {
    return true;
  }
  return resolve(left) === resolve(right);
}

export function inspectAgentMemoryQueueFile(options: {
  workspaceRoot: string;
  watchFile: string;
  source: string;
  eventName?: string;
}): AgentMemoryQueueInspectionResult {
  const checkpointFile = queueCheckpointPath(options.watchFile);
  const base = {
    exists: existsSync(options.watchFile),
    source: options.source,
    file: options.watchFile,
    events: 0,
    nativeSignals: 0,
    canarySignals: 0,
    usefulSignals: 0,
    ignoredOutOfWorkspaceEvents: 0,
    bytesRead: 0,
    pendingBytes: 0,
    checkpointFile,
    errors: [] as string[],
  };
  if (!base.exists) {
    return base;
  }
  const fileBuffer = readFileSync(options.watchFile);
  const bytesRead = readQueueCheckpoint(options.watchFile, fileBuffer.length);
  const inspected = inspectionBufferFromCheckpoint(fileBuffer, bytesRead, DEFAULT_QUEUE_INSPECT_MAX_BYTES);
  const { complete, pendingBytes } = splitCompleteJsonLines(inspected.buffer);
  const result: AgentMemoryQueueInspectionResult = {
    ...base,
    bytesRead,
    inspectedBytes: inspected.buffer.length,
    skippedBytes: inspected.skippedBytes,
    truncated: inspected.truncated,
    pendingBytes,
  };
  for (const line of complete) {
    if (!line.raw.trim()) {
      continue;
    }
    const parsed = normalizeRawInput(line.raw);
    if (!parsed) {
      result.errors.push(`could not parse queued hook line at byte ${inspected.offset + line.endOffset}`);
      continue;
    }
    const queued = parseQueuedHookLine(parsed);
    const payload = queued?.payload ?? parsed;
    const source = queued?.source ?? options.source;
    const workspaceRoot = queued?.workspaceRoot ?? options.workspaceRoot;
    const envelope = normalizeAgentEvent({
      workspaceRoot,
      source,
      eventName: queued?.eventName ?? options.eventName,
      raw: payload,
      integration: source === "cursor" ? "mcp" : "native-hook",
    });
    if (source !== options.source) {
      continue;
    }
    if (!workspaceRootsMatch(workspaceRoot, options.workspaceRoot)) {
      result.ignoredOutOfWorkspaceEvents += 1;
      continue;
    }
    const canary = envelope.payload.forgeHookCanary === "FORGE_HOOK_SMOKE_CANARY";
    if (shouldSkipQueuedHookEnvelope(envelope, { source: options.source, workspaceRoot: options.workspaceRoot })) {
      continue;
    }
    result.events += 1;
    if (canary) {
      result.canarySignals += 1;
    } else if (envelope.source.integration === "native-hook" && envelope.capture.trustLevel === "direct-hook") {
      result.nativeSignals += 1;
    }
    if (queuedEventHasUsefulSignal(envelope)) {
      result.usefulSignals += 1;
    }
    const timestamp = queuedEventTimestamp(parsed, envelope);
    if (timestamp && (!result.latestEventAt || timestamp > result.latestEventAt)) {
      result.latestEventAt = timestamp;
    }
  }
  return result;
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

  let eventsIngested = 0;
  const errors: string[] = [];
  let busyRetries = 0;
  let lastBusy: AgentMemoryUnavailableResult["busy"] | undefined;
  let pendingIngest = Promise.resolve();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleBusyRetry = () => {
    if (retryTimer) {
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      pendingIngest = pendingIngest.then(ingestNewContent, ingestNewContent);
    }, 500);
  };
  const ingestNewContent = async () => {
    const result = await drainAgentMemoryQueueFile({
      workspaceRoot: options.workspaceRoot,
      watchFile,
      source,
      eventName: options.eventName,
    });
    eventsIngested += result.eventsIngested;
    if (result.busy) {
      busyRetries += 1;
      lastBusy = result.busy;
      scheduleBusyRetry();
      return;
    }
    lastBusy = undefined;
    errors.push(...result.errors);
  };

  await ingestNewContent();
  return await new Promise<AgentIngestWatchResult>((resolve) => {
    const watcher = watch(watchFile, { persistent: true }, () => {
      pendingIngest = pendingIngest.then(ingestNewContent, ingestNewContent);
    });
    const shutdown = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      watcher.close();
      void pendingIngest.finally(() => {
        resolve({
          ok: errors.length === 0,
          watch: true,
          source,
          file,
          eventsIngested,
          errors,
          ...(lastBusy ? { busy: lastBusy, pendingDueToBusy: true, busyRetries } : {}),
          nextActions: [
            ...(lastBusy ? ["forge delta status --json"] : []),
            `forge agent memory --entry ${source} --json`,
            `forge agent hooks status --target ${source} --json`,
          ],
          exitCode: errors.length === 0 ? 0 : 1,
        });
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
      ? codexInstallFiles(options.workspaceRoot)
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      `agent memory ${result.watch ? "watch" : "queue ingest"} ${result.ok ? "ready" : "failed"} for ${result.source}`,
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
    `target: ${formatAgentContextTarget(result)}`,
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
  if (result.recommendedCommands.length > 0) {
    lines.push("", "Next:");
    for (const command of result.recommendedCommands.slice(0, 6)) {
      lines.push(`  ${command}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatAgentContextTarget(result: AgentMemoryContextPack): string {
  const target = result.scopeTarget;
  const parts: string[] = [target.kind];
  if (target.value) {
    parts.push(target.value);
  }
  if (target.semanticTarget && target.semanticTarget !== target.value) {
    parts.push(`semantic=${target.semanticTarget}`);
  }
  if (target.currentSessionId) {
    parts.push(`session=${target.currentSessionId}`);
  }
  return parts.join(" ");
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

function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const child = value[key];
  return child && typeof child === "object" && !Array.isArray(child) ? child as Record<string, unknown> : undefined;
}

export async function readStdinJson(options?: { timeoutMs?: number }): Promise<unknown> {
  if (process.stdin.isTTY) {
    return undefined;
  }
  const timeoutMs = options?.timeoutMs ?? 2000;
  const chunks: Buffer[] = [];
  let settled = false;

  return await new Promise<unknown>((resolve) => {
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", finish);
      process.stdin.removeListener("close", finish);
      process.stdin.removeListener("error", finish);
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      resolve(raw ? raw : undefined);
    };
    const onData = (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    };
    const timer = setTimeout(() => {
      process.stdin.destroy();
      finish();
    }, timeoutMs);
    process.stdin.on("data", onData);
    process.stdin.on("end", finish);
    process.stdin.on("close", finish);
    process.stdin.on("error", finish);
    process.stdin.resume();
  });
}

function parseQueuedHookLine(raw: Record<string, unknown>): {
  source: string;
  eventName?: string;
  workspaceRoot?: string;
  payload: Record<string, unknown>;
} | null {
  if (raw.forgeHookQueueV1 !== true) {
    return null;
  }
  const payload = objectField(raw, "payload") ?? objectField(raw, "raw");
  if (!payload) {
    return null;
  }
  return {
    source: typeof raw.source === "string" ? raw.source : "codex",
    eventName: typeof raw.eventName === "string" ? raw.eventName : undefined,
    workspaceRoot: typeof raw.workspaceRoot === "string" ? raw.workspaceRoot : undefined,
    payload,
  };
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
