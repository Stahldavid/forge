import { expect, test } from "bun:test";
import type { DbAdapter } from "../../src/forge/runtime/db/adapter.ts";
import { serializeLocalAdapter } from "../../src/forge/agent-fabric/serialized-local-adapter.ts";

test("inbox queries wait until the control transaction finishes", async () => {
  const calls: string[] = [];
  const inner: DbAdapter = {
    kind: "pglite",
    async query(sql) { calls.push(sql); return { rows: [], rowCount: 1 }; },
    async begin() {
      calls.push("BEGIN");
      return {
        async query(sql) { calls.push(sql); return { rows: [], rowCount: 1 }; },
        async commit() { calls.push("COMMIT"); },
        async rollback() { calls.push("ROLLBACK"); },
      };
    },
    async close() { calls.push("CLOSE"); },
  };
  const adapter = serializeLocalAdapter(inner);
  const tx = await adapter.begin();
  await tx.query("journal write");
  const inboxWrite = adapter.query("inbox write");
  await Promise.resolve();
  expect(calls).toEqual(["BEGIN", "journal write"]);
  await tx.rollback();
  await inboxWrite;
  expect(calls).toEqual(["BEGIN", "journal write", "ROLLBACK", "inbox write"]);
  await adapter.close();
});

test("a failed commit rolls back before another inbox query", async () => {
  const calls: string[] = [];
  const inner: DbAdapter = {
    kind: "pglite",
    async query(sql) { calls.push(sql); return { rows: [], rowCount: 1 }; },
    async begin() {
      calls.push("BEGIN");
      return {
        async query(sql) { calls.push(sql); return { rows: [], rowCount: 1 }; },
        async commit() { calls.push("COMMIT"); throw new Error("commit failed"); },
        async rollback() { calls.push("ROLLBACK"); },
      };
    },
    async close() {},
  };
  const adapter = serializeLocalAdapter(inner);
  const tx = await adapter.begin();
  const inboxWrite = adapter.query("inbox write");
  await expect(tx.commit()).rejects.toThrow("commit failed");
  await inboxWrite;
  expect(calls).toEqual(["BEGIN", "COMMIT", "ROLLBACK", "inbox write"]);
});
