import { describe, expect, test } from "bun:test";
import { encodeSseMessage } from "../../src/forge/runtime/live/sse.ts";
import type { LiveMessage } from "../../src/forge/runtime/live/types.ts";
import { createLiveSubscriptionManager } from "../../src/forge/runtime/live/subscription-manager.ts";
import {
  listLiveInvalidations,
  readLiveInvalidations,
} from "../../src/forge/runtime/live/invalidation-log.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";
import {
  cleanupLiveWorkspace,
  createMigratedMemoryDb,
  readGeneratedJson,
  scaffoldLiveWorkspace,
} from "../live/helpers.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("H24 Production LiveQuery hardening", () => {
  test("generates production live manifests and durable invalidation DDL", async () => {
    const { root } = await scaffoldLiveWorkspace("h24-manifests");
    try {
      const manifest = readGeneratedJson<{
        mode: string;
        invalidationSource: string;
        wakeupAdapters: string[];
        transports: string[];
      }>(root, "liveProductionManifest.json");
      const protocol = readGeneratedJson<{ messages: string[] }>(root, "liveProtocol.json");
      const transport = readGeneratedJson<{ defaultTransport: string }>(
        root,
        "liveTransportConfig.json",
      );
      const sqlPlan = readGeneratedJson<{
        systemTables: Array<{ sql: string }>;
        indexes: Array<{ sql: string }>;
      }>(root, "sqlPlan.json");

      expect(manifest.mode).toBe("production-hardened");
      expect(manifest.invalidationSource).toBe("durable-table");
      expect(manifest.wakeupAdapters).toEqual(["postgres-notify", "polling"]);
      expect(manifest.transports).toEqual(["sse"]);
      expect(protocol.messages).toEqual(["hello", "snapshot", "error", "heartbeat", "reset"]);
      expect(transport.defaultTransport).toBe("sse");
      expect(sqlPlan.systemTables.map((entry) => entry.sql).join("\n")).toContain(
        "_forge_live_invalidations",
      );
      expect(sqlPlan.indexes.map((entry) => entry.sql).join("\n")).toContain(
        "forge_live_invalidations_table_tenant_revision_idx",
      );
    } finally {
      cleanupLiveWorkspace(root);
    }
  }, 30_000);

  test("successful writes create durable invalidations and rollback creates none", async () => {
    const { root, tenantA } = await scaffoldLiveWorkspace("h24-invalidation-tx");
    try {
      const { adapter } = await createMigratedMemoryDb(root);

      const committed = await runEntry(root, "createTicket", {
        json: false,
        mock: false,
        args: { title: "durable" },
        db: adapter,
        auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" },
      });
      expect(committed.ok).toBe(true);

      const invalidations = await listLiveInvalidations(adapter);
      expect(invalidations).toHaveLength(1);
      expect(invalidations[0]).toEqual(
        expect.objectContaining({
          revision: 2,
          tableName: "tickets",
          tenantId: tenantA,
          operation: "insert",
          sourceKind: "command",
          sourceName: "createTicket",
        }),
      );

      const rolledBack = await runEntry(root, "failTicket", {
        json: false,
        mock: false,
        args: {},
        db: adapter,
        auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" },
      });
      expect(rolledBack.ok).toBe(false);
      expect(await listLiveInvalidations(adapter)).toHaveLength(1);
    } finally {
      cleanupLiveWorkspace(root);
    }
  }, 30_000);

  test("runtime B catches runtime A invalidation through durable polling", async () => {
    const { root, tenantA } = await scaffoldLiveWorkspace("h24-multi-runtime");
    try {
      const { adapter, tableMap } = await createMigratedMemoryDb(root);
      const messages: LiveMessage[] = [];
      const runtimeB = createLiveSubscriptionManager({
        workspaceRoot: root,
        adapter,
        loadTableMap: () => tableMap,
        limits: { rerunDebounceMs: 5 },
      });

      await runtimeB.subscribe({
        name: "liveTickets",
        args: {},
        auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" },
        send: (message) => messages.push(message),
      });

      await runEntry(root, "createTicket", {
        json: false,
        mock: false,
        args: { title: "from runtime A" },
        db: adapter,
        auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" },
      });

      expect(await runtimeB.processInvalidationsSince(0)).toBe(1);
      await delay(20);

      const snapshots = messages.filter((message) => message.type === "snapshot");
      expect(snapshots).toHaveLength(2);
      expect(snapshots[1]).toEqual(expect.objectContaining({ revision: 2 }));
      expect((snapshots[1] as Extract<LiveMessage, { type: "snapshot" }>).data).toEqual([
        expect.objectContaining({ title: "from runtime A" }),
      ]);
      runtimeB.stop();
    } finally {
      cleanupLiveWorkspace(root);
    }
  }, 30_000);

  test("tenant isolation, coalescing, auth expiry, and sse protocol are enforced", async () => {
    const { root, tenantA, tenantB } = await scaffoldLiveWorkspace("h24-hardening");
    try {
      const { adapter, tableMap } = await createMigratedMemoryDb(root);
      const messages: LiveMessage[] = [];
      const manager = createLiveSubscriptionManager({
        workspaceRoot: root,
        adapter,
        loadTableMap: () => tableMap,
        limits: { rerunDebounceMs: 10 },
      });

      await manager.subscribe({
        name: "liveTickets",
        args: {},
        auth: {
          kind: "user",
          userId: "u1",
          tenantId: tenantA,
          role: "member",
          token: {
            issuer: "issuer",
            audience: "audience",
            subject: "u1",
            authProvider: "test",
            expiresAt: Math.floor(Date.now() / 1000) + 60,
          },
        },
        send: (message) => messages.push(message),
      });

      await runEntry(root, "createTicket", {
        json: false,
        mock: false,
        args: { title: "other" },
        db: adapter,
        auth: { kind: "user", userId: "u2", tenantId: tenantB, role: "member" },
      });
      await manager.processInvalidationsSince(0);
      await delay(20);
      expect(messages.filter((message) => message.type === "snapshot")).toHaveLength(1);

      await Promise.all([
        runEntry(root, "createTicket", {
          json: false,
          mock: false,
          args: { title: "burst 1" },
          db: adapter,
          auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" },
        }),
        runEntry(root, "createTicket", {
          json: false,
          mock: false,
          args: { title: "burst 2" },
          db: adapter,
          auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" },
        }),
      ]);
      const rows = await readLiveInvalidations(adapter, 0);
      await manager.processInvalidationsSince(0);
      await delay(30);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      expect(messages.filter((message) => message.type === "snapshot")).toHaveLength(2);

      const expiredMessages: LiveMessage[] = [];
      const expired = await manager.subscribe({
        name: "liveTickets",
        args: {},
        auth: {
          kind: "user",
          userId: "expired",
          tenantId: tenantA,
          role: "member",
          token: {
            issuer: "issuer",
            audience: "audience",
            subject: "expired",
            authProvider: "test",
            expiresAt: Math.floor(Date.now() / 1000) - 1,
          },
        },
        send: (message) => expiredMessages.push(message),
      });
      await manager.notifyDataChanged({ tables: ["tickets"], tenantId: tenantA });
      expect(expiredMessages).toContainEqual(
        expect.objectContaining({
          type: "error",
          subscriptionId: expired.id,
          code: "FORGE_AUTH_TOKEN_EXPIRED",
        }),
      );

      expect(encodeSseMessage({
        type: "snapshot",
        subscriptionId: "sub_1",
        revision: 42,
        data: [],
      })).toContain("id: 42\nevent: snapshot");
      expect(encodeSseMessage({
        type: "heartbeat",
        serverTime: "2026-01-01T00:00:00.000Z",
      })).toContain("event: heartbeat");

      const parsedStatus = parseCli(["live", "status", "--json"]);
      expect(parsedStatus.command).toEqual(
        expect.objectContaining({ kind: "live", subcommand: "status", json: true }),
      );
      const parsedDebug = parseCli(["live", "debug", "sub_123", "--json"]);
      expect(parsedDebug.command).toEqual(
        expect.objectContaining({ kind: "live", subcommand: "debug", name: "sub_123" }),
      );
      manager.stop();
    } finally {
      cleanupLiveWorkspace(root);
    }
  }, 30_000);
});
