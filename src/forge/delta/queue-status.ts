import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

export interface DeltaAgentQueueSnapshot {
  queuePath: ".forge/agent/events.ndjson";
  queueExists: boolean;
  queueSizeBytes: number;
  checkpointPath: ".forge/agent/events.ndjson.checkpoint.json";
  checkpointExists: boolean;
  checkpointOffset: number | null;
  effectiveOffset?: number;
  checkpointUpdatedAt?: string;
  checkpointGeneration?: string;
  queueGeneration?: string;
  generationMismatch?: boolean;
  pendingBytes: number | null;
  pendingEvents: number | null;
  incompleteLineBytes: number | null;
  freshness: "fresh" | "stale" | "unknown";
  oldestPendingAt?: string;
  oldestPendingAgeMs?: number;
  ageSource?: "event" | "queue-modified";
  error?: string;
}

function readQueueGenerationMarker(handle: number, queueSizeBytes: number): { generation?: string; endOffset: number } {
  const prefix = Buffer.allocUnsafe(Math.min(256, queueSizeBytes));
  const bytesRead = readSync(handle, prefix, 0, prefix.length, 0);
  const newline = prefix.subarray(0, bytesRead).indexOf(10);
  if (newline < 0) return { endOffset: 0 };
  try {
    const parsed = JSON.parse(prefix.subarray(0, newline).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { endOffset: 0 };
    const generation = (parsed as { forgeHookQueueGeneration?: unknown }).forgeHookQueueGeneration;
    if (typeof generation === "string" && /^[0-9a-f-]{36}$/iu.test(generation)) {
      return { generation, endOffset: newline + 1 };
    }
  } catch {
    // Legacy queue files start directly with events.
  }
  return { endOffset: 0 };
}

function oldestQueuedEventAt(handle: number, checkpointOffset: number, queueSizeBytes: number): string | undefined {
  const probe = Buffer.allocUnsafe(Math.min(64 * 1024, queueSizeBytes - checkpointOffset));
  const bytesRead = readSync(handle, probe, 0, probe.length, checkpointOffset);
  const firstLineEnd = probe.subarray(0, bytesRead).indexOf(10);
  if (firstLineEnd < 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(probe.subarray(0, firstLineEnd).toString("utf8")) as { enqueuedAt?: unknown };
    if (typeof parsed.enqueuedAt === "string" && Number.isFinite(Date.parse(parsed.enqueuedAt))) {
      return parsed.enqueuedAt;
    }
  } catch {
    // Older queue formats may not provide a parseable enqueue timestamp.
  }
  return undefined;
}

/** Inspect the hook queue without opening DeltaDB or exposing queued payloads. */
export function inspectDeltaAgentQueue(workspaceRoot: string): DeltaAgentQueueSnapshot {
  const queuePath = join(workspaceRoot, ".forge", "agent", "events.ndjson");
  const checkpointPath = `${queuePath}.checkpoint.json`;
  const snapshot: DeltaAgentQueueSnapshot = {
    queuePath: ".forge/agent/events.ndjson",
    queueExists: existsSync(queuePath),
    queueSizeBytes: 0,
    checkpointPath: ".forge/agent/events.ndjson.checkpoint.json",
    checkpointExists: existsSync(checkpointPath),
    checkpointOffset: null,
    pendingBytes: null,
    pendingEvents: null,
    incompleteLineBytes: null,
    freshness: "unknown",
  };

  try {
    if (!snapshot.queueExists) {
      return {
        ...snapshot,
        checkpointOffset: 0,
        pendingBytes: 0,
        pendingEvents: 0,
        incompleteLineBytes: 0,
        freshness: "fresh",
      };
    }
    const queueStat = statSync(queuePath);
    const queueSizeBytes = queueStat.size;
    snapshot.queueSizeBytes = queueSizeBytes;
    let checkpointOffset = 0;
    let checkpointUpdatedAt: string | undefined;
    let checkpointGeneration: string | undefined;
    if (snapshot.checkpointExists) {
      const parsed = JSON.parse(readFileSync(checkpointPath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("queue checkpoint has an invalid shape");
      }
      const checkpoint = parsed as { offset?: unknown; updatedAt?: unknown; generation?: unknown };
      if (typeof checkpoint.offset !== "number" || !Number.isSafeInteger(checkpoint.offset) || checkpoint.offset < 0) {
        throw new Error("queue checkpoint has an invalid offset");
      }
      checkpointOffset = checkpoint.offset;
      if (typeof checkpoint.generation === "string") checkpointGeneration = checkpoint.generation;
      if (typeof checkpoint.updatedAt === "string" && Number.isFinite(Date.parse(checkpoint.updatedAt))) {
        checkpointUpdatedAt = checkpoint.updatedAt;
      }
    }
    let pendingEvents = 0;
    let incompleteLineBytes = 0;
    let lineHasContent = false;
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const handle = openSync(queuePath, "r");
    let oldestPendingAt: string | undefined;
    let queueGeneration: string | undefined;
    let generationMismatch = false;
    let effectiveOffset = checkpointOffset;
    try {
      const marker = readQueueGenerationMarker(handle, queueSizeBytes);
      queueGeneration = marker.generation;
      generationMismatch = snapshot.checkpointExists && checkpointGeneration !== queueGeneration;
      if (generationMismatch) effectiveOffset = 0;
      if (effectiveOffset > queueSizeBytes) {
        throw new Error("queue checkpoint is beyond the end of the queue");
      }
      if (!generationMismatch && effectiveOffset > 0) {
        const boundary = Buffer.allocUnsafe(1);
        if (readSync(handle, boundary, 0, 1, effectiveOffset - 1) !== 1 || boundary[0] !== 10) {
          throw new Error("queue checkpoint does not end at a complete line");
        }
      }
      // The marker is control metadata, so it never contributes to pending events.
      effectiveOffset = Math.max(effectiveOffset, marker.endOffset);
      oldestPendingAt = oldestQueuedEventAt(handle, effectiveOffset, queueSizeBytes);
      let position = effectiveOffset;
      while (position < queueSizeBytes) {
        const bytesRead = readSync(handle, buffer, 0, Math.min(buffer.length, queueSizeBytes - position), position);
        if (bytesRead === 0) {
          throw new Error("queue changed while its backlog was being inspected");
        }
        for (let index = 0; index < bytesRead; index += 1) {
          const byte = buffer[index];
          incompleteLineBytes += 1;
          if (byte === 10) {
            if (lineHasContent) {
              pendingEvents += 1;
            }
            lineHasContent = false;
            incompleteLineBytes = 0;
          } else if (byte !== 9 && byte !== 13 && byte !== 32) {
            lineHasContent = true;
          }
        }
        position += bytesRead;
      }
    } finally {
      closeSync(handle);
    }
    const hasPendingBytes = pendingEvents > 0 || incompleteLineBytes > 0;
    const oldestPendingAgeMs = hasPendingBytes
      ? oldestPendingAt
        ? Math.max(0, Date.now() - Date.parse(oldestPendingAt))
        : Math.max(0, Date.now() - queueStat.mtimeMs)
      : undefined;
    return {
      ...snapshot,
      queueSizeBytes,
      checkpointOffset,
      effectiveOffset,
      ...(checkpointUpdatedAt ? { checkpointUpdatedAt } : {}),
      ...(checkpointGeneration ? { checkpointGeneration } : {}),
      ...(queueGeneration ? { queueGeneration } : {}),
      generationMismatch,
      pendingBytes: queueSizeBytes - effectiveOffset,
      pendingEvents,
      incompleteLineBytes,
      freshness: pendingEvents > 0 ? "stale" : incompleteLineBytes > 0 || generationMismatch ? "unknown" : "fresh",
      ...(pendingEvents > 0 && oldestPendingAt ? { oldestPendingAt } : {}),
      ...(oldestPendingAgeMs !== undefined ? { oldestPendingAgeMs } : {}),
      ...(hasPendingBytes ? { ageSource: oldestPendingAt ? "event" as const : "queue-modified" as const } : {}),
    };
  } catch (error) {
    return {
      ...snapshot,
      error: error instanceof Error ? error.message : "queue backlog could not be inspected",
    };
  }
}
