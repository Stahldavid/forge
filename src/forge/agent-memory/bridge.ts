import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { createDeltaId } from "../delta/ids.ts";
import { DeltaStore, DeltaStoreBusyError, describeDeltaStoreBusy, summarizeDeltaStoreBusy } from "../delta/store.ts";
import { pidWasReused } from "../delta/process-identity.ts";
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
  AgentMemoryFreshness,
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
  | { ok: true; events: AgentMemoryEventRecord[]; freshness: AgentMemoryFreshness; exitCode: 0 }
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
  const primaryEnvelopes = new Set(primary.map((event) => JSON.stringify(event.data.envelope)).filter((value) => value !== undefined));
  const merged = [...primary, ...fallback.filter((event) => !primaryEnvelopes.has(JSON.stringify(event.data.envelope)))]
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
      const freshness = await refreshAgentMemory(options.workspaceRoot);
      return await buildAgentMemoryContext({
        workspaceRoot: options.workspaceRoot,
        entry: options.entry,
        change: options.change,
        proof: options.proof,
        handoff: options.handoff,
        limit: options.limit,
        freshness,
      });
    } catch (error) {
      return memoryUnavailable(error, options.workspaceRoot);
    }
  }
  const freshness = await refreshAgentMemory(options.workspaceRoot);
  const events = await listAgentMemoryEventsWithSchemaRepair(options.workspaceRoot, options.entry, options.limit);
  if (!Array.isArray(events)) {
    return events;
  }
  return {
    ok: true,
    events,
    freshness: { ...freshness, ...(events.at(-1)?.capturedAt ? { latestMatchingEventAt: events.at(-1)!.capturedAt } : {}) },
    exitCode: 0,
  };
}

/** Drain a short batch before reads; the broker continues draining in the background. */
export async function refreshAgentMemory(workspaceRoot: string): Promise<AgentMemoryFreshness> {
  const watchFile = join(workspaceRoot, ".forge", "agent", "events.ndjson");
  if (!existsSync(watchFile)) {
    return { status: "current", pendingBytes: 0, queuedEvents: 0, inspectedEventsTruncated: false };
  }
  let drainError: string | undefined;
  try {
    const drained = await drainAgentMemoryQueueFile({
      workspaceRoot,
      watchFile,
      source: "codex",
      maxEvents: 128,
      maxDurationMs: 1_000,
    });
    drainError = drained.busy ? "Agent Memory store is busy" : drained.errors[0];
  } catch (error) {
    drainError = error instanceof Error ? error.message : String(error);
  }
  try {
    const queue = inspectAgentMemoryQueueFile({ workspaceRoot, watchFile, source: "codex" });
    const pendingBytes = Math.max(0, statSync(watchFile).size - queue.bytesRead);
    return {
      status: drainError ? "unavailable" : pendingBytes > 0 ? "pending" : "current",
      pendingBytes,
      queuedEvents: queue.events,
      inspectedEventsTruncated: queue.truncated === true,
      ...(queue.latestEventAt ? { lastQueuedAt: queue.latestEventAt } : {}),
      ...(drainError ? { error: drainError } : {}),
    };
  } catch (error) {
    return {
      status: "unavailable",
      pendingBytes: 0,
      queuedEvents: 0,
      inspectedEventsTruncated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ingestEnvelope(workspaceRoot: string, envelope: AgentEventEnvelope): Promise<AgentIngestResult> {
  const store = await openMemoryStore(workspaceRoot, "write");
  if (isMemoryUnavailable(store)) {
    if (shouldUseFallbackMemory(store, workspaceRoot)) {
      const event = appendFallbackAgentMemoryEvent(
        workspaceRoot,
        envelope,
        summarizeAgentEvent(envelope),
        extractAgentEventBindings(envelope),
      );
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
    return await recordAgentMemoryEnvelope(store, envelope);
  } finally {
    await store.close();
  }
}

async function recordAgentMemoryEnvelope(store: DeltaStore, envelope: AgentEventEnvelope, idempotencyKey?: string): Promise<AgentIngestResult> {
  const event = await store.recordAgentMemoryEvent({
    envelope,
    summary: summarizeAgentEvent(envelope),
    bindings: extractAgentEventBindings(envelope),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
  return { ok: true, event, envelope, exitCode: 0 };
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

function queueAppendLockPath(watchFile: string): string {
  return `${watchFile}.append-lock.json`;
}

function queueDrainLockPath(watchFile: string): string {
  return `${watchFile}.drain-lock.json`;
}

function queueLockHolderAlive(pid: unknown): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

function clearStaleQueueAppendLock(lockPath: string): void {
  try {
    const stat = statSync(lockPath);
    const holder = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown; createdAt?: unknown };
    const ageMs = Date.now() - stat.mtimeMs;
    // A large queue can take longer than 30 seconds to compact. Reclaiming a
    // live writer's lock by age would let a hook append to the old queue just
    // before the atomic replacement and silently drop that event.
    if (ageMs < 2_000 || (queueLockHolderAlive(holder.pid) &&
        !(typeof holder.pid === "number" && pidWasReused(holder.pid, holder.createdAt)))) {
      return;
    }
    unlinkSync(lockPath);
  } catch {
    // A concurrent hook may have replaced the lock; retry acquisition instead.
  }
}

async function acquireQueueFileLock(lockPath: string, waitMs: number): Promise<string | null> {
  const token = randomUUID();
  const started = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
      } finally {
        closeSync(fd);
      }
      return token;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
      clearStaleQueueAppendLock(lockPath);
      if (Date.now() - started >= waitMs) {
        return null;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 15));
    }
  }
}

async function acquireQueueAppendLock(watchFile: string, waitMs = 500): Promise<string | null> {
  return acquireQueueFileLock(queueAppendLockPath(watchFile), waitMs);
}

function releaseQueueFileLock(lockPath: string, token: string): void {
  try {
    const holder = JSON.parse(readFileSync(lockPath, "utf8")) as { token?: unknown };
    if (holder.token === token) {
      unlinkSync(lockPath);
    }
  } catch {
    // Best effort; stale lock recovery handles interrupted processes.
  }
}

function releaseQueueAppendLock(watchFile: string, token: string): void {
  releaseQueueFileLock(queueAppendLockPath(watchFile), token);
}

function readQueueCheckpoint(watchFile: string, fileSize: number): number {
  const checkpointFile = queueCheckpointPath(watchFile);
  if (!existsSync(checkpointFile)) {
    return 0;
  }
  try {
    const parsed = JSON.parse(readFileSync(checkpointFile, "utf8")) as unknown;
    const checkpoint = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as { offset?: unknown; generation?: unknown }
      : undefined;
    const offset = checkpoint?.offset;
    if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) {
      return 0;
    }
    // An atomic queue replacement can land before its checkpoint reset. The
    // generation mismatch makes the new tail replay from byte zero.
    if ((typeof checkpoint?.generation === "string" ? checkpoint.generation : undefined) !== readQueueGeneration(watchFile)) {
      return 0;
    }
    return offset > fileSize ? 0 : Math.floor(offset);
  } catch {
    return 0;
  }
}

function readQueueGeneration(watchFile: string): string | undefined {
  if (!existsSync(watchFile)) return undefined;
  const fd = openSync(watchFile, "r");
  try {
    const prefix = Buffer.alloc(256);
    const bytes = readSync(fd, prefix, 0, prefix.length, 0);
    const newline = prefix.subarray(0, bytes).indexOf(10);
    if (newline < 0) return undefined;
    const value = JSON.parse(prefix.subarray(0, newline).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const generation = (value as { forgeHookQueueGeneration?: unknown }).forgeHookQueueGeneration;
    return typeof generation === "string" && /^[0-9a-f-]{36}$/iu.test(generation) ? generation : undefined;
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

function writeQueueCheckpoint(watchFile: string, offset: number, generation = readQueueGeneration(watchFile)): void {
  const checkpointFile = queueCheckpointPath(watchFile);
  mkdirSync(dirname(checkpointFile), { recursive: true });
  const temporary = `${checkpointFile}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, "wx");
    try {
      writeFileSync(fd,
      `${JSON.stringify({
      schema: "forge.agent-hook-queue-checkpoint.v1",
      file: watchFile,
      offset,
      ...(generation ? { generation } : {}),
      updatedAt: new Date().toISOString(),
      }, null, 2)}\n`,
      "utf8",
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, checkpointFile);
    syncParentDirectory(checkpointFile);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function syncParentDirectory(path: string): void {
  try {
    const fd = openSync(dirname(path), "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch {
    // Windows cannot fsync a directory through Node. The file itself was
    // fsynced before rename, and generation checks recover either rename state.
  }
}

const DEFAULT_QUEUE_COMPACT_AFTER_BYTES = 256 * 1024;
const DEFAULT_QUEUE_HISTORY_MAX_BYTES = 1024 * 1024;

function trimBufferStart(buffer: Buffer, maxBytes: number): Buffer {
  if (buffer.length <= maxBytes) {
    return buffer;
  }
  return buffer.subarray(buffer.length - maxBytes);
}

async function compactAgentMemoryQueueFile(options: {
  watchFile: string;
  originalBuffer: Buffer;
  consumedOffset: number;
  compactAfterBytes: number;
  historyMaxBytes: number;
}): Promise<{ compacted: boolean; historyFile: string }> {
  const historyFile = queueHistoryPath(options.watchFile);
  if (options.consumedOffset < options.compactAfterBytes) {
    return { compacted: false, historyFile };
  }
  const lock = await acquireQueueAppendLock(options.watchFile);
  if (!lock) {
    return { compacted: false, historyFile };
  }
  try {
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
    const generation = randomUUID();
    const marker = Buffer.from(`${JSON.stringify({ forgeHookQueueGeneration: generation })}\n`, "utf8");
    const tail = currentBuffer.subarray(options.consumedOffset);
    const temporary = `${options.watchFile}.${process.pid}.${generation}.tmp`;
    try {
      const fd = openSync(temporary, "wx");
      try {
        writeFileSync(fd, Buffer.concat([marker, tail]));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      // The old queue remains intact until this atomic replacement. If the
      // process stops before checkpoint reset, generation mismatch replays tail.
      renameSync(temporary, options.watchFile);
      syncParentDirectory(options.watchFile);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    writeQueueCheckpoint(options.watchFile, marker.length, generation);
    return { compacted: true, historyFile };
  } finally {
    releaseQueueAppendLock(options.watchFile, lock);
  }
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

export interface AgentMemoryQueueDrainOptions {
  workspaceRoot: string;
  watchFile: string;
  source: string;
  eventName?: string;
  startOffset?: number;
  compactAfterBytes?: number;
  historyMaxBytes?: number;
  maxEvents?: number;
  maxDurationMs?: number;
  /** The owner broker can pass its already-open store to avoid a second PGlite. */
  store?: DeltaStore;
}

export interface AgentMemoryQueueDrainResult {
  eventsIngested: number;
  errors: string[];
  bytesRead: number;
  pendingBytes: number;
  checkpointFile: string;
  compacted: boolean;
  historyFile: string;
  busy?: AgentMemoryUnavailableResult["busy"];
}

export async function drainAgentMemoryQueueFile(options: AgentMemoryQueueDrainOptions): Promise<AgentMemoryQueueDrainResult> {
  const lockPath = queueDrainLockPath(options.watchFile);
  const lock = await acquireQueueFileLock(lockPath, options.store ? 0 : options.maxDurationMs ? 1_000 : 30_000);
  if (!lock) {
    const fileSize = existsSync(options.watchFile) ? statSync(options.watchFile).size : 0;
    const checkpoint = readQueueCheckpoint(options.watchFile, fileSize);
    return {
      eventsIngested: 0,
      errors: [],
      bytesRead: checkpoint,
      pendingBytes: Math.max(0, fileSize - checkpoint),
      checkpointFile: queueCheckpointPath(options.watchFile),
      compacted: false,
      historyFile: queueHistoryPath(options.watchFile),
    };
  }
  try {
    return await drainAgentMemoryQueueFileUnlocked(options);
  } finally {
    releaseQueueFileLock(lockPath, lock);
  }
}

async function drainAgentMemoryQueueFileUnlocked(options: AgentMemoryQueueDrainOptions): Promise<AgentMemoryQueueDrainResult> {
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
  // Avoid opening PGlite when the queue has no complete lines. Once there is work,
  // acquire its writer lock before reading the checkpoint: another drainer may
  // have consumed these bytes while this process waited for the lock.
  const initialBuffer = readFileSync(options.watchFile);
  const initialOffset = options.startOffset ?? readQueueCheckpoint(options.watchFile, initialBuffer.length);
  if (splitCompleteJsonLines(initialBuffer.subarray(Math.min(initialOffset, initialBuffer.length))).complete.length === 0) {
    return {
      eventsIngested: 0,
      errors: [],
      bytesRead: initialOffset,
      pendingBytes: Math.max(0, initialBuffer.length - initialOffset),
      checkpointFile: queueCheckpointPath(options.watchFile),
      compacted: false,
      historyFile,
    };
  }

  const opened = options.store ?? await openMemoryStore(options.workspaceRoot, "write");
  if (isMemoryUnavailable(opened)) {
    return {
      eventsIngested: 0,
      errors: opened.busy ? [] : [opened.error],
      bytesRead: initialOffset,
      pendingBytes: Math.max(0, initialBuffer.length - initialOffset),
      checkpointFile: queueCheckpointPath(options.watchFile),
      compacted: false,
      historyFile,
      ...(opened.busy ? { busy: opened.busy } : {}),
    };
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = readFileSync(options.watchFile);
  } catch (error) {
    if (!options.store) await opened.close();
    throw error;
  }
  let bytesRead = options.startOffset ?? readQueueCheckpoint(options.watchFile, fileBuffer.length);
  if (bytesRead > fileBuffer.length) {
    bytesRead = 0;
  }
  const { complete } = splitCompleteJsonLines(fileBuffer.subarray(bytesRead));
  const queueGeneration = readQueueGeneration(options.watchFile);
  let eventsIngested = 0;
  const errors: string[] = [];
  let consumedOffset = bytesRead;
  let linesProcessed = 0;
  const startedAt = Date.now();
  const store = opened;

  try {
    for (const line of complete) {
      if ((options.maxEvents && linesProcessed >= options.maxEvents) ||
          (options.maxDurationMs && linesProcessed > 0 && Date.now() - startedAt >= options.maxDurationMs)) {
        break;
      }
      linesProcessed += 1;
      if (!line.raw.trim()) {
        consumedOffset = bytesRead + line.endOffset;
        writeQueueCheckpoint(options.watchFile, consumedOffset, queueGeneration);
        continue;
      }
      const parsed = normalizeRawInput(line.raw);
      if (!parsed) {
        quarantineQueuedLine(options.watchFile, line.raw, bytesRead + line.endOffset, "invalid-json-object");
        consumedOffset = bytesRead + line.endOffset;
        writeQueueCheckpoint(options.watchFile, consumedOffset, queueGeneration);
        continue;
      }
      if (typeof parsed.forgeHookQueueGeneration === "string") {
        consumedOffset = bytesRead + line.endOffset;
        writeQueueCheckpoint(options.watchFile, consumedOffset, queueGeneration);
        continue;
      }
      if (isAgentMemoryEventRecord(parsed)) {
        const legacyEnvelope = legacyFallbackEnvelope(parsed);
        if (!legacyEnvelope) {
          quarantineQueuedLine(options.watchFile, line.raw, bytesRead + line.endOffset, "invalid-legacy-memory-record");
          consumedOffset = bytesRead + line.endOffset;
          writeQueueCheckpoint(options.watchFile, consumedOffset, queueGeneration);
          continue;
        }
        if (!workspaceRootsMatch(legacyEnvelope.workspace.root, options.workspaceRoot)) {
          consumedOffset = bytesRead + line.endOffset;
          writeQueueCheckpoint(options.watchFile, consumedOffset, queueGeneration);
          continue;
        }
        const migrated = await recordAgentMemoryEnvelope(store, legacyEnvelope, `fallback:${parsed.id}`);
        if (!migrated.ok) {
          errors.push(migrated.error ?? "legacy Agent Memory migration failed");
          break;
        }
        eventsIngested += 1;
        consumedOffset = bytesRead + line.endOffset;
        writeQueueCheckpoint(options.watchFile, consumedOffset, queueGeneration);
        continue;
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
        writeQueueCheckpoint(options.watchFile, consumedOffset, queueGeneration);
        continue;
      }
      const queueEventId = typeof parsed.queueEventId === "string" && /^[0-9a-f-]{36}$/iu.test(parsed.queueEventId)
        ? parsed.queueEventId
        : createHash("sha256").update(`${queueGeneration ?? "legacy"}:${bytesRead + line.endOffset}:${line.raw}`).digest("hex");
      const result = await recordAgentMemoryEnvelope(store, envelope, `hook:${ingestSource}:${queueEventId}`);
      if (result.ok) {
        eventsIngested += 1;
        consumedOffset = bytesRead + line.endOffset;
        writeQueueCheckpoint(options.watchFile, consumedOffset, queueGeneration);
      } else if (isDeltaBusyIngestResult(result)) {
        return {
          eventsIngested,
          errors,
          bytesRead,
          pendingBytes: Math.max(0, fileBuffer.length - consumedOffset),
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
      ? await compactAgentMemoryQueueFile({
          watchFile: options.watchFile,
          originalBuffer: fileBuffer,
          consumedOffset,
          compactAfterBytes: options.compactAfterBytes ?? DEFAULT_QUEUE_COMPACT_AFTER_BYTES,
          historyMaxBytes: options.historyMaxBytes ?? DEFAULT_QUEUE_HISTORY_MAX_BYTES,
        })
      : { compacted: false, historyFile };
    const bytesAfterRetention = retention.compacted
      ? readQueueCheckpoint(options.watchFile, statSync(options.watchFile).size)
      : consumedOffset;

    return {
      eventsIngested,
      errors,
      bytesRead: bytesAfterRetention,
      pendingBytes: Math.max(0, statSync(options.watchFile).size - bytesAfterRetention),
      checkpointFile: queueCheckpointPath(options.watchFile),
      compacted: retention.compacted,
      historyFile: retention.historyFile,
    };
  } finally {
    if (!options.store) await store.close();
  }
}

function quarantineQueuedLine(watchFile: string, raw: string, offset: number, reason: string): void {
  // Preserve only a digest and position. Legacy queue lines may contain private
  // fields, so a rejection log must never copy their raw text.
  appendFileSync(`${watchFile}.rejects.ndjson`, `${JSON.stringify({
    schema: "forge.agent-hook-rejection.v1",
    offset,
    hash: createHash("sha256").update(raw).digest("hex"),
    reason,
    rejectedAt: new Date().toISOString(),
  })}\n`, "utf8");
}

function legacyFallbackEnvelope(record: AgentMemoryEventRecord): AgentEventEnvelope | undefined {
  const data = record.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const envelope = data.envelope;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return undefined;
  const candidate = envelope as Partial<AgentEventEnvelope>;
  if (candidate.schema !== "forge.agent-event.v1" ||
      typeof candidate.source?.agent !== "string" || typeof candidate.source.integration !== "string" ||
      typeof candidate.workspace?.root !== "string" || typeof candidate.event?.kind !== "string" ||
      typeof candidate.event.timestamp !== "string" || typeof candidate.capture?.trustLevel !== "string" ||
      typeof candidate.capture.confidence !== "number" || !candidate.payload ||
      typeof candidate.payload !== "object" || Array.isArray(candidate.payload)) return undefined;
  return candidate as AgentEventEnvelope;
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
  const { complete } = splitCompleteJsonLines(inspected.buffer);
  const result: AgentMemoryQueueInspectionResult = {
    ...base,
    bytesRead,
    inspectedBytes: inspected.buffer.length,
    skippedBytes: inspected.skippedBytes,
    truncated: inspected.truncated,
    pendingBytes: Math.max(0, fileBuffer.length - bytesRead),
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
    if (typeof parsed.forgeHookQueueGeneration === "string" || isAgentMemoryEventRecord(parsed)) continue;
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
    } else if (envelope.source.integration === "native-hook" && envelope.capture.trustLevel === "direct-hook" &&
               typeof envelope.session.externalSessionId === "string" &&
               envelope.session.externalSessionId !== "forge-hook-probe" &&
               envelope.payload.forgeHookProbe !== true) {
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
    const scheduleIngest = () => {
      pendingIngest = pendingIngest.then(ingestNewContent, ingestNewContent);
    };
    // File notifications can be coalesced or lost during queue compaction and
    // on Windows. Polling also resumes after a transient Delta busy result.
    const pollTimer = setInterval(scheduleIngest, Math.max(250, options.pollIntervalMs ?? 2_000));
    let watcher: ReturnType<typeof watch> | undefined;
    try {
      watcher = watch(watchFile, { persistent: true }, scheduleIngest);
      watcher.on("error", () => {
        watcher?.close();
        watcher = undefined;
      });
    } catch {
      // The polling timer keeps draining when fs.watch is unavailable.
    }
    const shutdown = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      clearInterval(pollTimer);
      watcher?.close();
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
  const events = formatAgentMemoryEventsHuman("events" in result ? result.events : []);
  return "freshness" in result && result.freshness
    ? `${events.trimEnd()}\n${formatFreshnessHuman(result.freshness)}\n`
    : events;
}

function formatFreshnessHuman(freshness: AgentMemoryFreshness): string {
  return `freshness: ${freshness.status} (${freshness.pendingBytes} queued bytes${freshness.inspectedEventsTruncated ? ", recent queue sample only" : ""})`;
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
    ...(result.freshness ? [formatFreshnessHuman(result.freshness)] : []),
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
