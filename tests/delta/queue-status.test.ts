import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { inspectDeltaAgentQueue } from "../../src/forge/delta/queue-status.ts";
import { deltaQueueDrainCheck } from "../../src/forge/delta/status.ts";

describe("Delta agent queue inspection", () => {
  test("counts only complete lines after the durable checkpoint", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-queue-status-"));
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queuePath = join(agentDir, "events.ndjson");
      const consumed = `${JSON.stringify({ event: "consumed" })}\n`;
      const pending = `${JSON.stringify({ event: "pending", data: "x".repeat(70_000) })}\n`;
      writeFileSync(queuePath, `${consumed}${pending}partial`);
      writeFileSync(`${queuePath}.checkpoint.json`, JSON.stringify({ offset: Buffer.byteLength(consumed), updatedAt: "2026-09-29T00:00:00.000Z" }));

      const snapshot = inspectDeltaAgentQueue(root);
      expect(snapshot).toMatchObject({
        checkpointOffset: Buffer.byteLength(consumed),
        pendingEvents: 1,
        pendingBytes: Buffer.byteLength(`${pending}partial`),
        incompleteLineBytes: 7,
        freshness: "stale",
      });
      expect(deltaQueueDrainCheck(snapshot)).toMatchObject({ ok: false, severity: "warning" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("invalid checkpoint keeps backlog unknown", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-queue-status-"));
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "events.ndjson"), "{\"event\":1}\n");
      writeFileSync(join(agentDir, "events.ndjson.checkpoint.json"), "{\"offset\":9999}");

      const snapshot = inspectDeltaAgentQueue(root);
      expect(snapshot).toMatchObject({
        pendingEvents: null,
        freshness: "unknown",
        queueSizeBytes: 12,
      });
      expect(deltaQueueDrainCheck(snapshot)).toMatchObject({ ok: false, severity: "error" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an incomplete trailing line is visible and becomes unhealthy when aged", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-queue-status-"));
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queuePath = join(agentDir, "events.ndjson");
      writeFileSync(queuePath, "{\"event\":\"unfinished\"");

      const recent = inspectDeltaAgentQueue(root);
      expect(recent).toMatchObject({
        pendingEvents: 0,
        incompleteLineBytes: 21,
        freshness: "unknown",
        ageSource: "queue-modified",
      });
      expect(deltaQueueDrainCheck(recent)).toMatchObject({ ok: false, severity: "warning" });

      const sixMinutesAgo = new Date(Date.now() - 6 * 60_000);
      utimesSync(queuePath, sixMinutesAgo, sixMinutesAgo);
      const aged = inspectDeltaAgentQueue(root);
      expect(aged.oldestPendingAgeMs).toBeGreaterThanOrEqual(5 * 60_000);
      expect(deltaQueueDrainCheck(aged)).toMatchObject({
        ok: false,
        severity: "error",
        evidence: { pendingEvents: 0, incompleteLineBytes: 21, freshness: "unknown" },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an event queued for over five minutes fails the drain check", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-queue-status-"));
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const enqueuedAt = new Date(Date.now() - 6 * 60_000).toISOString();
      writeFileSync(join(agentDir, "events.ndjson"), `${JSON.stringify({ enqueuedAt, event: "waiting" })}\n`);

      const snapshot = inspectDeltaAgentQueue(root);
      expect(snapshot).toMatchObject({ pendingEvents: 1, freshness: "stale", ageSource: "event" });
      expect(snapshot.oldestPendingAgeMs).toBeGreaterThanOrEqual(5 * 60_000);
      expect(deltaQueueDrainCheck(snapshot)).toMatchObject({
        ok: false,
        severity: "error",
        evidence: { pendingEvents: 1, oldestPendingAt: enqueuedAt },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a checkpoint from the previous queue generation cannot hide new events", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-queue-status-"));
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queuePath = join(agentDir, "events.ndjson");
      const oldGeneration = "11111111-1111-1111-1111-111111111111";
      const newGeneration = "22222222-2222-2222-2222-222222222222";
      const marker = `${JSON.stringify({ forgeHookQueueGeneration: newGeneration })}\n`;
      const first = `${JSON.stringify({ enqueuedAt: new Date().toISOString(), event: "new-1" })}\n`;
      const second = `${JSON.stringify({ event: "new-2" })}\n`;
      writeFileSync(queuePath, `${marker}${first}${second}`);
      const checkpointPath = `${queuePath}.checkpoint.json`;
      writeFileSync(checkpointPath, JSON.stringify({ generation: oldGeneration, offset: Buffer.byteLength(`${marker}${first}`) }));

      const mismatch = inspectDeltaAgentQueue(root);
      expect(mismatch).toMatchObject({
        checkpointGeneration: oldGeneration,
        queueGeneration: newGeneration,
        generationMismatch: true,
        pendingEvents: 2,
        effectiveOffset: Buffer.byteLength(marker),
        freshness: "stale",
      });

      writeFileSync(checkpointPath, JSON.stringify({ generation: newGeneration, offset: Buffer.byteLength(`${marker}${first}`) }));
      const matched = inspectDeltaAgentQueue(root);
      expect(matched).toMatchObject({ generationMismatch: false, pendingEvents: 1, freshness: "stale" });

      writeFileSync(queuePath, marker);
      writeFileSync(checkpointPath, JSON.stringify({ generation: oldGeneration, offset: Buffer.byteLength(`${marker}${first}`) }));
      const markerOnly = inspectDeltaAgentQueue(root);
      expect(markerOnly).toMatchObject({ generationMismatch: true, pendingEvents: 0, freshness: "unknown" });
      expect(deltaQueueDrainCheck(markerOnly)).toMatchObject({ ok: false, severity: "error" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
