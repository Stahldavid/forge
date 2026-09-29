import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { DeltaStore } from "../../src/forge/delta/store.ts";
import { probeDeltaBroker, shutdownDeltaBroker } from "../../src/forge/delta/broker.ts";

describe("Delta broker", () => {
  test("shares one owner across clients and drains the real hook queue", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-delta-broker-"));
    const queue = join(root, ".forge", "agent", "events.ndjson");
    mkdirSync(join(root, ".forge", "agent"), { recursive: true });
    writeFileSync(queue, `${JSON.stringify({
      forgeHookQueueV1: true,
      source: "codex",
      eventName: "SessionStart",
      workspaceRoot: root,
      enqueuedAt: "2026-01-01T00:00:00.000Z",
      raw: { session_id: "broker-test-session", hook_event_name: "SessionStart" },
    })}\n`, "utf8");
    const previous = process.env.FORGE_DELTA_BACKGROUND_DRAIN;
    process.env.FORGE_DELTA_BACKGROUND_DRAIN = "1";
    let first: DeltaStore | undefined;
    let second: DeltaStore | undefined;
    try {
      [first, second] = await Promise.all([DeltaStore.open(root), DeltaStore.open(root, { access: "read" })]);
      const owner = await probeDeltaBroker(root);
      expect(owner.active).toBe(true);
      expect(owner.pid).toBeGreaterThan(0);
      const [status, timeline] = await Promise.all([first.status(), second.timeline({})]);
      expect(status.recording).toBe(true);
      expect(Array.isArray(timeline)).toBe(true);
      const nodeClient = spawnSync("node", [
        "--import", "tsx", "--input-type=module", "-e",
        'import { DeltaStore } from "./src/forge/delta/store.ts"; const store = await DeltaStore.open(process.argv[1], { access: "read" }); const status = await store.status(); await store.close(); console.log(status.recording);',
        root,
      ], { cwd: process.cwd(), encoding: "utf8", timeout: 15_000, windowsHide: true });
      expect(nodeClient.status).toBe(0);
      expect(nodeClient.stdout.trim()).toBe("true");
      const endpointPath = join(root, ".forge", "delta", "broker-endpoint.json");
      const endpointBytes = readFileSync(endpointPath);
      const endpoint = JSON.parse(endpointBytes.toString("utf8")) as {
        pipe: string; token: string; pid: number;
      };
      const unicodeSummary = "ação 😀 do Codex";
      const frame = Buffer.from(`${JSON.stringify({
        token: endpoint.token, method: "appendOperation", args: [{ kind: "broker.unicode", summary: unicodeSummary }],
      })}\n`, "utf8");
      const emojiAt = frame.indexOf(Buffer.from("😀", "utf8"));
      expect(emojiAt).toBeGreaterThan(0);
      const fragmented = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const socket = connect(endpoint.pipe);
        const chunks: Buffer[] = [];
        socket.once("error", reject);
        socket.once("connect", () => {
          socket.write(frame.subarray(0, emojiAt + 2));
          setTimeout(() => socket.write(frame.subarray(emojiAt + 2)), 5);
        });
        socket.on("data", (chunk: Buffer) => chunks.push(chunk));
        socket.once("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>); }
          catch (error) { reject(error); }
        });
      });
      expect(fragmented.ok).toBe(true);
      const unicodeEvents = await second.timeline({});
      expect(unicodeEvents.some((event) => event.summary === unicodeSummary)).toBe(true);
      let events = await second.listAgentMemoryEvents({ target: "codex" });
      const deadline = Date.now() + 15_000;
      while (events.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        events = await second.listAgentMemoryEvents({ target: "codex" });
      }
      expect(events).toHaveLength(1);
      expect(events[0]?.externalSessionId).toBe("broker-test-session");
      expect(existsSync(`${queue}.checkpoint.json`)).toBe(true);
      expect(readFileSync(`${queue}.checkpoint.json`, "utf8")).toContain("offset");
      await first.close();
      await second.close();
      await shutdownDeltaBroker(root);
      const ownerAlive = () => {
        try { process.kill(endpoint.pid, 0); return true; } catch { return false; }
      };
      const ownerExitDeadline = Date.now() + 15_000;
      while (ownerAlive() && Date.now() < ownerExitDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
      expect(ownerAlive()).toBe(false);
      writeFileSync(endpointPath, endpointBytes, { flag: "wx" });
      const recovered = await DeltaStore.open(root);
      try { expect((await recovered.status()).recording).toBe(true); }
      finally { await recovered.close(); }
    } finally {
      if (previous === undefined) delete process.env.FORGE_DELTA_BACKGROUND_DRAIN;
      else process.env.FORGE_DELTA_BACKGROUND_DRAIN = previous;
      await first?.close().catch(() => undefined);
      await second?.close().catch(() => undefined);
      await shutdownDeltaBroker(root).catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  }, 45_000);
});
