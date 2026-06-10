import { describe, expect, test } from "bun:test";
import type { LiveMessage } from "../../src/forge/runtime/live/types.ts";
import { createLiveSubscriptionManager } from "../../src/forge/runtime/live/subscription-manager.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import {
  cleanupLiveWorkspace,
  createMigratedMemoryDb,
  readGeneratedJson,
  scaffoldLiveWorkspace,
} from "./helpers.ts";

describe("liveQuery MVP", () => {
  test("generates live registry and sends initial snapshot", async () => {
    const { root, tenantA } = await scaffoldLiveWorkspace("live-registry");
    try {
      const registry = readGeneratedJson<{ liveQueries: Array<{ name: string; policy?: string }> }>(
        root,
        "liveQueryRegistry.json",
      );
      const manifest = readGeneratedJson<{ liveQueries: Array<{ name: string }> }>(
        root,
        "subscriptionManifest.json",
      );
      expect(registry.liveQueries).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "liveTickets", policy: "tickets.read" }),
      ]));
      expect(manifest.liveQueries).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "liveTickets" }),
      ]));

      const { adapter, tableMap } = await createMigratedMemoryDb(root);
      const messages: LiveMessage[] = [];
      const manager = createLiveSubscriptionManager({
        workspaceRoot: root,
        adapter,
        loadTableMap: () => tableMap,
      });

      const subscription = await manager.subscribe({
        name: "liveTickets",
        args: {},
        auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" },
        send: (message) => messages.push(message),
      });
      expect(subscription.dependencies).toEqual([
        { table: "tickets", tenantId: tenantA },
      ]);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(
        expect.objectContaining({ type: "snapshot", revision: 1, data: [] }),
      );
    } finally {
      cleanupLiveWorkspace(root);
    }
  }, 30_000);

  test("reruns after command commit and ignores other tenants", async () => {
    const { root, tenantA, tenantB } = await scaffoldLiveWorkspace("live-invalidation");
    try {
      const { adapter, tableMap } = await createMigratedMemoryDb(root);
      const messages: LiveMessage[] = [];
      const manager = createLiveSubscriptionManager({
        workspaceRoot: root,
        adapter,
        loadTableMap: () => tableMap,
      });

      await manager.subscribe({
        name: "liveTickets",
        args: {},
        auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" },
        send: (message) => messages.push(message),
      });

      await runEntry(root, "createTicket", {
        json: false,
        mock: false,
        args: { title: "other tenant" },
        db: adapter,
        auth: { kind: "user", userId: "u2", tenantId: tenantB, role: "member" },
        liveManager: manager,
      });
      expect(messages).toHaveLength(1);

      const result = await runEntry(root, "createTicket", {
        json: false,
        mock: false,
        args: { title: "Live ticket" },
        db: adapter,
        auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" },
        liveManager: manager,
      });

      expect(result.ok).toBe(true);
      expect(messages).toHaveLength(2);
      expect(messages[1]).toEqual(
        expect.objectContaining({ type: "snapshot", revision: 2 }),
      );
      expect((messages[1] as Extract<LiveMessage, { type: "snapshot" }>).data).toEqual([
        expect.objectContaining({ title: "Live ticket", status: "open" }),
      ]);
    } finally {
      cleanupLiveWorkspace(root);
    }
  }, 30_000);

  test("does not notify when command rolls back", async () => {
    const { root, tenantA } = await scaffoldLiveWorkspace("live-rollback");
    try {
      const { adapter, tableMap } = await createMigratedMemoryDb(root);
      const messages: LiveMessage[] = [];
      const manager = createLiveSubscriptionManager({
        workspaceRoot: root,
        adapter,
        loadTableMap: () => tableMap,
      });

      await manager.subscribe({
        name: "liveTickets",
        args: {},
        auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" },
        send: (message) => messages.push(message),
      });

      const result = await runEntry(root, "failTicket", {
        json: false,
        mock: false,
        args: {},
        db: adapter,
        auth: { kind: "user", userId: "u1", tenantId: tenantA, role: "member" },
        liveManager: manager,
      });

      expect(result.ok).toBe(false);
      expect(messages).toHaveLength(1);
    } finally {
      cleanupLiveWorkspace(root);
    }
  }, 30_000);
});
