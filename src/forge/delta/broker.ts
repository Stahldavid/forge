import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { createServer, connect, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DeltaStoreBusyError, type DeltaStore } from "./store.ts";
import { inspectDeltaAgentQueue } from "./queue-status.ts";
import { pidWasReused } from "./process-identity.ts";

const START_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const IDLE_MS = 120_000;
const ENDPOINT_NAME = "broker-endpoint.json";

export const DELTA_BROKER_METHODS = new Set([
  "init", "ensureActor", "createSession", "endSession", "appendOperation", "recordAgentMemoryEvent",
  "listAgentMemoryEvents", "status", "statusDetails", "timeline", "semanticTimeline",
  "rebuildSemanticTimeline", "explain", "recordFilePath", "currentWorkSession", "listWorkSessions",
  "getWorkSessionDetails", "renameWorkSession", "detachWorkSessionOperation", "mergeWorkSessions",
  "splitWorkSession",
]);

interface BrokerEndpoint {
  version: 1;
  root: string;
  pid: number;
  createdAt: string;
  pipe: string;
  token: string;
}

interface BrokerResponse {
  ok: boolean;
  value?: unknown;
  isUndefined?: boolean;
  error?: { name: string; message: string; code?: string; stack?: string; lockPath?: string; holder?: Record<string, unknown> | null };
}

function endpointPath(root: string): string { return join(root, ".forge", "delta", ENDPOINT_NAME); }
function failurePath(root: string, pid: number): string { return join(root, ".forge", "delta", `broker-start-${pid}.json`); }
function pipePath(root: string): string {
  const id = createHash("sha256").update(root).digest("hex").slice(0, 24);
  return process.platform === "win32" ? `\\\\.\\pipe\\forge-delta-${id}` : join(tmpdir(), `forge-delta-${process.getuid?.() ?? "user"}-${id}.sock`);
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
function unlinkUnchanged(path: string, bytes: Buffer): void {
  try { if (readFileSync(path).equals(bytes)) unlinkSync(path); } catch { /* replacement or already gone */ }
}
function readEndpoint(root: string): BrokerEndpoint | null {
  const path = endpointPath(root);
  let bytes: Buffer;
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("Delta broker endpoint must not be a symbolic link");
    bytes = readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (bytes.length > 2048) throw new Error("Delta broker endpoint is oversized");
  let value: Partial<BrokerEndpoint>;
  try { value = JSON.parse(bytes.toString("utf8")) as Partial<BrokerEndpoint>; }
  catch { throw new Error("Delta broker endpoint is invalid JSON"); }
  if (value.version !== 1 || value.root !== root || !Number.isSafeInteger(value.pid) ||
      (value.pid ?? 0) <= 0 || value.pipe !== pipePath(root) ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.token !== "string" || !/^[0-9a-f]{64}$/u.test(value.token)) {
    throw new Error("Delta broker endpoint is inconsistent");
  }
  if (!alive(value.pid!)) {
    unlinkUnchanged(path, bytes); return null;
  }
  if (process.platform !== "win32" && (statSync(path).mode & 0o077) !== 0) {
    throw new Error("Delta broker endpoint permissions are too broad");
  }
  return value as BrokerEndpoint;
}
function serializeError(error: unknown): NonNullable<BrokerResponse["error"]> {
  const item = error instanceof Error ? error : new Error(String(error));
  const code = "code" in item && typeof item.code === "string" ? item.code : undefined;
  return {
    name: item.name, message: item.message, ...(code ? { code } : {}), ...(item.stack ? { stack: item.stack } : {}),
    ...(item instanceof DeltaStoreBusyError ? { lockPath: item.lockPath, holder: item.holder } : {}),
  };
}
function reviveError(error: NonNullable<BrokerResponse["error"]> | undefined): Error {
  const revived = error?.code === "FORGE_DELTA_BUSY" && error.lockPath
    ? new DeltaStoreBusyError(error.lockPath, error.holder ?? null)
    : new Error(error?.message ?? "Delta broker request failed");
  revived.name = error?.name ?? "DeltaBrokerError";
  if (error?.code) Object.assign(revived, { code: error.code });
  if (error?.stack) revived.stack = error.stack;
  return revived;
}

async function send(endpoint: BrokerEndpoint, method: string, args: unknown[], timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint.pipe);
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(new Error(`Delta broker ${method} timed out after ${timeoutMs} ms`)));
    socket.once("error", (error) => finish(error));
    socket.once("close", () => finish(new Error(`Delta broker closed ${method} without a response`)));
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > MAX_MESSAGE_BYTES) { finish(new Error("Delta broker response exceeded limit")); return; }
      const data = Buffer.concat(chunks);
      const newline = data.indexOf(10);
      if (newline < 0) return;
      try {
        const result = JSON.parse(data.subarray(0, newline).toString("utf8")) as BrokerResponse;
        if (!result.ok) finish(reviveError(result.error));
        else finish(undefined, result.isUndefined ? undefined : result.value);
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ token: endpoint.token, method, args })}\n`);
    });
  });
}

let starting = new Map<string, Promise<BrokerEndpoint>>();
export async function ensureDeltaBroker(workspaceRoot: string): Promise<BrokerEndpoint> {
  const root = realpathSync(workspaceRoot);
  const existing = starting.get(root);
  if (existing) return existing;
  const task = (async () => {
    let endpoint = readEndpoint(root);
    if (endpoint) {
      const former = endpoint;
      try { await send(former, "ping", [], 1_500); return former; }
      catch (error) {
        if (pidWasReused(former.pid, former.createdAt)) {
          const path = endpointPath(root);
          if (existsSync(path)) {
            const bytes = readFileSync(path);
            try {
              const current = JSON.parse(bytes.toString("utf8")) as Partial<BrokerEndpoint>;
              if (current.pid === former.pid && current.token === former.token) unlinkUnchanged(path, bytes);
            } catch { /* invalid endpoint is reported by the next read */ }
          }
          endpoint = null;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        const current = readEndpoint(root);
        if (current?.pid === former.pid && current.token === former.token && alive(former.pid)) {
          throw new Error(`Delta broker pid ${former.pid} is unresponsive`, { cause: error });
        }
      }
    }
    const runner = fileURLToPath(new URL("./broker-runner.mjs", import.meta.url));
    const runningTest = process.env.NODE_ENV === "test" || process.argv.some((arg) => /\.test\.[cm]?[jt]sx?$/u.test(arg));
    const child = spawn(process.execPath, [runner, root], {
      // Windows cannot remove a workspace while a child keeps it as cwd.
      cwd: dirname(runner), detached: true, windowsHide: true, stdio: "ignore",
      env: {
        ...process.env,
        FORGE_DELTA_BACKGROUND_DRAIN: process.env.FORGE_DELTA_BACKGROUND_DRAIN ?? (runningTest ? "0" : "1"),
      },
    });
    let childExited = false;
    let spawnError: Error | undefined;
    child.once("exit", () => { childExited = true; });
    child.once("error", (error) => { spawnError = error; childExited = true; });
    child.unref();
    const started = Date.now();
    for (;;) {
      endpoint = readEndpoint(root);
      if (endpoint) {
        try { await send(endpoint, "ping", [], 1_500); return endpoint; }
        catch { /* owner may still be publishing */ }
      }
      if (childExited) break;
      if (Date.now() - started >= START_TIMEOUT_MS) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const path = child.pid ? failurePath(root, child.pid) : undefined;
    if (path && existsSync(path)) {
      const result = JSON.parse(readFileSync(path, "utf8")) as NonNullable<BrokerResponse["error"]>;
      unlinkSync(path);
      throw reviveError(result);
    }
    if (spawnError) throw spawnError;
    throw new Error("Delta broker did not become ready within 15 seconds");
  })();
  starting.set(root, task);
  try { return await task; } finally { starting.delete(root); }
}

export async function requestDeltaBroker(workspaceRoot: string, method: string, args: unknown[]): Promise<unknown> {
  if (!DELTA_BROKER_METHODS.has(method) && method !== "openHandle" && method !== "closeHandle" && method !== "stop") {
    throw new Error(`Delta broker method is unavailable: ${method}`);
  }
  const root = realpathSync(workspaceRoot);
  const endpoint = await ensureDeltaBroker(root);
  // A timed-out write may already have committed. Never replay it automatically.
  return send(endpoint, method, args);
}

/** Stop this workspace's verified owner and release its PGlite files. */
export async function shutdownDeltaBroker(workspaceRoot: string): Promise<void> {
  const root = realpathSync(workspaceRoot);
  const endpoint = readEndpoint(root);
  if (!endpoint) return;
  await send(endpoint, "stop", [], 10_000);
}

export async function probeDeltaBroker(workspaceRoot: string): Promise<{ active: boolean; pid?: number; error?: string }> {
  const root = realpathSync(workspaceRoot);
  let endpoint: BrokerEndpoint | null;
  try { endpoint = readEndpoint(root); }
  catch (error) { return { active: false, error: error instanceof Error ? error.message : String(error) }; }
  if (!endpoint) return { active: false };
  try { await send(endpoint, "ping", [], 1_500); return { active: true, pid: endpoint.pid }; }
  catch (error) { return { active: false, pid: endpoint.pid, error: error instanceof Error ? error.message : String(error) }; }
}

export async function runDeltaBroker(workspaceRoot: string | undefined): Promise<void> {
  if (!workspaceRoot) throw new Error("Delta broker requires a workspace root");
  const root = realpathSync(workspaceRoot);
  const pipe = pipePath(root);
  const path = endpointPath(root);
  let store: DeltaStore | undefined;
  let server: Server | undefined;
  const sockets = new Set<Socket>();
  let published: BrokerEndpoint | undefined;
  let lastActivity = Date.now();
  let pending = 0;
  const handles = new Set<string>();
  let closing = false;
  const backgroundDrain = process.env.FORGE_DELTA_BACKGROUND_DRAIN !== "0";
  let queuePendingBytes = backgroundDrain ? (inspectDeltaAgentQueue(root).pendingBytes ?? 1) : 0;
  let serial = Promise.resolve();
  try {
    const { DeltaStore, markDeltaBrokerOwnerProcess } = await import("./store.ts");
    markDeltaBrokerOwnerProcess();
    store = await DeltaStore.open(root, { waitMs: 10_000, retryDelayMs: 100 });
    const oldEndpoint = readEndpoint(root);
    if (oldEndpoint) {
      try {
        if (await send(oldEndpoint, "ping", [], 1_500) === true) {
          throw new Error("A Delta broker owner already answers for this workspace");
        }
      } catch (error) {
        if (!pidWasReused(oldEndpoint.pid, oldEndpoint.createdAt)) throw error;
        const bytes = readFileSync(path);
        const current = JSON.parse(bytes.toString("utf8")) as Partial<BrokerEndpoint>;
        if (current.pid === oldEndpoint.pid && current.token === oldEndpoint.token) unlinkUnchanged(path, bytes);
      }
    }
    if (process.platform !== "win32" && existsSync(pipe)) {
      const existing = readEndpoint(root);
      if (existing) throw new Error("Delta broker pipe is owned by another process");
      unlinkSync(pipe);
    }
    const token = randomBytes(32).toString("hex");
    published = { version: 1, root, pid: process.pid, createdAt: new Date().toISOString(), pipe, token };
    const equalToken = (value: unknown): boolean => typeof value === "string" && value.length === token.length &&
      timingSafeEqual(Buffer.from(value), Buffer.from(token));
    server = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      const chunks: Buffer[] = [];
      let size = 0;
      socket.setTimeout(REQUEST_TIMEOUT_MS + 5_000, () => socket.destroy());
      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size > MAX_MESSAGE_BYTES) { socket.destroy(); return; }
        const body = Buffer.concat(chunks);
        const newline = body.indexOf(10);
        if (newline < 0) return;
        socket.removeAllListeners("data");
        let request: { token?: unknown; method?: unknown; args?: unknown };
        try { request = JSON.parse(body.subarray(0, newline).toString("utf8")) as typeof request; }
        catch { socket.end(`${JSON.stringify({ ok: false, error: { name: "Error", message: "Invalid Delta broker JSON" } })}\n`); return; }
        if (!equalToken(request.token) || typeof request.method !== "string" ||
            (request.method !== "ping" && request.method !== "wake" && request.method !== "openHandle" && request.method !== "closeHandle" &&
              request.method !== "stop" &&
              !DELTA_BROKER_METHODS.has(request.method)) || !Array.isArray(request.args)) {
          socket.end(`${JSON.stringify({ ok: false, error: { name: "Error", message: "Unauthorized Delta broker request" } })}\n`);
          return;
        }
        lastActivity = Date.now();
        pending += 1;
        const method = request.method;
        const args = request.args;
        const work = serial.then(async () => {
          if (closing) throw new Error("Delta broker is closing");
          if (method === "ping") return true;
          if (method === "wake") {
            queuePendingBytes = inspectDeltaAgentQueue(root).pendingBytes ?? 1;
            setImmediate(drainQueue);
            return true;
          }
          if (method === "stop") {
            closing = true;
            await store!.close();
            if (published && existsSync(path)) unlinkUnchanged(path, Buffer.from(JSON.stringify(published)));
            setImmediate(() => { shutdownAndExit(); });
            return true;
          }
          if (method === "openHandle") {
            if (typeof args[0] !== "string" || !/^[0-9a-f-]{36}$/u.test(args[0])) throw new Error("Invalid Delta handle ID");
            handles.add(args[0]);
            return true;
          }
          if (method === "closeHandle") {
            if (typeof args[0] !== "string" || !/^[0-9a-f-]{36}$/u.test(args[0])) throw new Error("Invalid Delta handle ID");
            handles.delete(args[0]);
            if (handles.size === 0 && queuePendingBytes === 0 && pending === 1) {
              closing = true;
              await store!.close();
              if (published && existsSync(path)) unlinkUnchanged(path, Buffer.from(JSON.stringify(published)));
              setImmediate(() => { shutdownAndExit(); });
            }
            return true;
          }
          return (store as unknown as Record<string, (...values: unknown[]) => Promise<unknown>>)[method](...args);
        });
        serial = work.then(() => undefined, () => undefined);
        void work.then((value) => {
          if (!socket.destroyed) socket.end(`${JSON.stringify({ ok: true, value: value ?? null, isUndefined: value === undefined })}\n`);
        }, (error) => {
          if (!socket.destroyed) socket.end(`${JSON.stringify({ ok: false, error: serializeError(error) })}\n`);
        }).finally(() => { pending -= 1; lastActivity = Date.now(); });
      });
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(pipe, resolve); });
    if (process.platform !== "win32") chmodSync(pipe, 0o600);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(published), { flag: "wx", mode: 0o600 });
    let drainScheduled = false;
    const drainQueue = () => {
      if (!backgroundDrain || drainScheduled || closing) return;
      drainScheduled = true;
      const work = serial.then(async () => {
        const { drainAgentMemoryQueueFile } = await import("../agent-memory/bridge.ts");
        return drainAgentMemoryQueueFile({
          workspaceRoot: root,
          watchFile: join(root, ".forge", "agent", "events.ndjson"),
          source: "codex", maxEvents: 128, maxDurationMs: 1_000, store: store!,
        });
      });
      serial = work.then(() => undefined, () => undefined);
      void work.then((result) => {
        queuePendingBytes = result.pendingBytes;
        if (result.eventsIngested > 0) lastActivity = Date.now();
        if (result.pendingBytes > 0 && result.eventsIngested > 0) setTimeout(drainQueue, 0);
      }, () => { queuePendingBytes = 1; }).finally(() => { drainScheduled = false; });
    };
    const drainTimer = backgroundDrain ? setInterval(drainQueue, 2_000) : undefined;
    if (backgroundDrain) setTimeout(drainQueue, 0);
    const timer = setInterval(() => {
      if (pending !== 0 || queuePendingBytes !== 0 || Date.now() - lastActivity <= IDLE_MS) return;
      // The hook can append between periodic drains. Recheck the durable queue
      // before dropping its last local owner; an authenticated wake races
      // safely with closing and starts a replacement owner if rejected.
      queuePendingBytes = inspectDeltaAgentQueue(root).pendingBytes ?? 1;
      if (queuePendingBytes === 0) shutdownAndExit();
      else drainQueue();
    }, 10_000);
    let shutdownTask: Promise<void> | undefined;
    const shutdown = (): Promise<void> => {
      if (shutdownTask) return shutdownTask;
      shutdownTask = (async () => {
        clearInterval(timer);
        if (drainTimer) clearInterval(drainTimer);
        await serial;
        await store!.close();
        if (published && existsSync(path)) unlinkUnchanged(path, Buffer.from(JSON.stringify(published)));
        if (server!.listening) {
          const closed = new Promise<void>((resolve) => server!.close(() => resolve()));
          // Some Bun/Windows clients retain a half-open pipe after reading the
          // response. The owner has already released PGlite, so bound shutdown.
          const force = setTimeout(() => { for (const socket of sockets) socket.destroy(); }, 100);
          await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
          clearTimeout(force);
          for (const socket of sockets) socket.destroy();
        }
        if (process.platform !== "win32" && existsSync(pipe)) unlinkSync(pipe);
      })();
      return shutdownTask;
    };
    let exiting = false;
    const shutdownAndExit = (): void => {
      if (exiting) return;
      exiting = true;
      void shutdown().then(() => process.exit(0), () => process.exit(1));
    };
    process.once("SIGTERM", shutdownAndExit);
    process.once("SIGINT", shutdownAndExit);
  } catch (error) {
    if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await store?.close().catch(() => undefined);
    // Concurrent hook and CLI wakeups can launch two candidates. The process
    // that loses the physical store lock exits quietly once a real owner answers.
    try {
      const other = readEndpoint(root);
      if (other && other.pid !== process.pid && await send(other, "ping", [], 1_500) === true) return;
    } catch { /* preserve the original startup failure below */ }
    const failure = failurePath(root, process.pid);
    try { writeFileSync(failure, JSON.stringify(serializeError(error)), { mode: 0o600 }); } catch { /* diagnostic is best effort */ }
    throw error;
  }
}
