import { test, expect, spyOn } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ManagedRunStore } from "../../src/forge/agent-fabric/managed-run-store.ts";
import { managedDigest, type ManagedRunState } from "../../src/forge/agent-fabric/managed-run-contract.ts";
import { createWorkflow } from "../../src/forge/agent-fabric/workflow-engine.ts";
function state(root: string, runId: string): ManagedRunState {
  const workflow = createWorkflow({ workflowId: "work", nodes: [{ nodeId: "check", kind: "verification", required: true, inputDigest: "a".repeat(64), dependsOn: [] }] });
  return { schemaVersion: 1, runId, repositoryRoot: root, ownerPid: process.pid, version: 0, spec: { requestId: "start", goal: "Check fixture", scope: ["source"], workflow: { workflowId: "work", nodes: workflow.nodes }, executors: [{ nodeId: "check", type: "command", argv: ["node", "--version"] }], publish: false }, workflow, status: "preparing", steps: [], events: [], cursor: 0, instructions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
test("atomic state receipts replay original acknowledgment with latest state and reject CAS/fingerprint conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-managed-store-test-")); try {
    const store = await ManagedRunStore.open(root), options = { requestId: "start", fingerprint: managedDigest("start") };
    const first = await store.transact("run:one", options, () => state(store.root, "run:one"));
    expect(first.state.version).toBe(1); await store.transact("run:one", {}, current => ({ ...current!, status: "running" }));
    const replay = await store.transact("run:one", options, () => { throw new Error("must not execute"); });
    expect(replay.replayed).toBe(true); expect(replay.ack).toEqual(first.ack); expect(replay.state.version).toBe(2);
    await expect(store.transact("run:one", { ...options, fingerprint: managedDigest("other") }, () => first.state)).rejects.toMatchObject({ code: "AF_RUN_REQUEST_CONFLICT" });
    await expect(store.transact("run:one", { expectedVersion: 1 }, () => first.state)).rejects.toMatchObject({ code: "AF_RUN_VERSION_CONFLICT" });
    replay.state.instructions.push("outside mutation"); expect((await store.read("run:one"))!.instructions).toEqual([]); expect(await store.list()).toEqual(["run:one"]);
    expect(await store.read("missing")).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("independent stores serialize concurrent compare and swap", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-managed-store-test-")); try {
    const a = await ManagedRunStore.open(root), b = await ManagedRunStore.open(root);
    await a.transact("run", {}, () => state(a.root, "run"));
    const results = await Promise.allSettled([a.transact("run", { expectedVersion: 1 }, current => ({ ...current!, status: "running" })), b.transact("run", { expectedVersion: 1 }, current => ({ ...current!, status: "paused" }))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await a.read("run"))!.version).toBe(2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("corruption is detected and dead owner plus reclaim guard are safely reclaimed", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-managed-store-test-")); try {
    const store = await ManagedRunStore.open(root), path = join(store.directory, `${managedDigest("run").slice(7)}.json`);
    await writeFile(`${path}.lock`, JSON.stringify({ pid: 2147483647, token: "dead-owner" }));
    await writeFile(`${path}.lock.reclaim`, JSON.stringify({ pid: 2147483647, token: "dead-guard" }));
    await store.transact("run", {}, () => state(store.root, "run")); expect((await store.read("run"))!.version).toBe(1);
    const raw = JSON.parse(await readFile(path, "utf8")); raw.record.state.status = "completed"; await writeFile(path, JSON.stringify(raw));
    await expect(store.read("run")).rejects.toMatchObject({ code: "AF_RUN_STORE" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("transient Windows replacement errors retry the same temp without deleting the prior record", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-managed-store-test-")); let renameSpy: ReturnType<typeof spyOn> | undefined;
  try {
    const store = await ManagedRunStore.open(root); await store.transact("run", {}, () => state(store.root, "run"));
    const originalRename = fsPromises.rename, attemptedSources: string[] = []; let attempts = 0;
    renameSpy = spyOn(fsPromises, "rename").mockImplementation(async (source, destination) => {
      attemptedSources.push(String(source)); attempts++;
      if (attempts <= 3) {
        expect((await store.read("run"))!.version).toBe(1);
        throw Object.assign(new Error("temporary reader handle"), { code: ["EPERM", "EACCES", "EBUSY"][attempts - 1] });
      }
      return originalRename(source, destination);
    });
    await store.transact("run", {}, current => ({ ...current!, status: "running" }));
    expect(attempts).toBe(4); expect(new Set(attemptedSources).size).toBe(1); expect((await store.read("run"))!.version).toBe(2);
  } finally { renameSpy?.mockRestore(); await rm(root, { recursive: true, force: true }); }
});

test("transient Windows lock reader errors do not block a committed run or weaken ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-managed-store-test-")); let readSpy: ReturnType<typeof spyOn> | undefined;
  try {
    const store = await ManagedRunStore.open(root);
    const originalRead = fsPromises.readFile; let failures = 0;
    readSpy = spyOn(fsPromises, "readFile").mockImplementation((async (path: Parameters<typeof originalRead>[0], options: unknown) => {
      if (String(path).endsWith(".json.lock") && failures < 3) {
        failures++;
        throw Object.assign(new Error("temporary Windows reader handle"), { code: ["EPERM", "EACCES", "EBUSY"][failures - 1] });
      }
      return originalRead(path, options as "utf8");
    }) as typeof originalRead);
    await store.transact("run", {}, () => state(store.root, "run"));
    expect(failures).toBe(3); expect((await store.read("run"))!.version).toBe(1);
  } finally { readSpy?.mockRestore(); await rm(root, { recursive: true, force: true }); }
});
