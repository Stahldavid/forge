#!/usr/bin/env node
/**
 * Lightweight Codex hook runner — no Forge CLI, no DeltaDB.
 * Reads stdin with a short timeout, enqueues a redacted event to .forge/agent/events.ndjson, exits.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { connect } from "node:net";
import { appendFileSync, mkdirSync, openSync, closeSync, existsSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const STDIN_TIMEOUT_MS = 750;
const eventName = process.argv[2];

if (!eventName) {
  process.stderr.write("usage: codex-hook.mjs <CodexHookEvent>\n");
  process.exit(2);
}

const workspaceRoot = resolve(process.cwd());
const eventsFile = join(workspaceRoot, ".forge", "agent", "events.ndjson");
const queueLockFile = `${eventsFile}.append-lock.json`;
const brokerStartLockFile = join(workspaceRoot, ".forge", "agent", "broker-start-lock.json");
const QUEUE_LOCK_WAIT_MS = 500;

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/u;

function readStdin(timeoutMs) {
  return new Promise((resolveRead) => {
    if (process.stdin.isTTY) {
      resolveRead("");
      return;
    }
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveRead(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(() => {
      process.stdin.destroy();
      finish();
    }, timeoutMs);
    process.stdin.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    process.stdin.on("end", finish);
    process.stdin.on("close", finish);
    process.stdin.on("error", finish);
    process.stdin.resume();
  });
}

async function main() {
  const stdin = await readStdin(STDIN_TIMEOUT_MS);
  const trimmed = stdin.trim();
  let raw = {};
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { _invalidPayload: true };
    } catch {
      raw = { _parseError: true, _rawLength: trimmed.length };
    }
  }
  if (!raw.hook_event_name) {
    raw.hook_event_name = eventName;
  }
  if (!raw.cwd) {
    raw.cwd = workspaceRoot;
  }

  const entry = {
    forgeHookQueueV1: true,
    queueEventId: randomUUID(),
    source: "codex",
    eventName,
    workspaceRoot,
    enqueuedAt: new Date().toISOString(),
    rawStored: false,
    payloadRedacted: true,
    payload: sanitizePayload(raw, eventName),
  };

  mkdirSync(dirname(eventsFile), { recursive: true });
  const lock = await acquireQueueLock();
  try {
    ensureQueueLineBoundary();
    appendFileSync(eventsFile, `${JSON.stringify(entry)}\n`, "utf8");
  } finally {
    releaseQueueLock(lock);
  }
  await wakeBroker();
}

function ensureQueueLineBoundary() {
  if (!existsSync(eventsFile)) return;
  const size = statSync(eventsFile).size;
  if (size === 0) return;
  const fd = openSync(eventsFile, "r");
  try {
    const last = Buffer.alloc(1);
    if (readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 10) {
      appendFileSync(eventsFile, "\n", "utf8");
    }
  } finally {
    closeSync(fd);
  }
}

async function wakeBroker() {
  const endpointPath = join(workspaceRoot, ".forge", "delta", "broker-endpoint.json");
  try {
    const endpoint = JSON.parse(readFileSync(endpointPath, "utf8"));
    if (endpoint?.root === workspaceRoot && await signalBroker(endpoint)) {
      try { unlinkSync(brokerStartLockFile); } catch { /* already absent */ }
      return;
    }
  } catch { /* no active broker */ }
  const metaPath = join(workspaceRoot, ".forge", "agent", "codex-hook.meta.json");
  let brokerRunnerPath;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    if (meta?.workspaceRoot !== workspaceRoot || typeof meta.brokerRunnerPath !== "string" ||
        !isAbsolute(meta.brokerRunnerPath) || !existsSync(meta.brokerRunnerPath)) return;
    brokerRunnerPath = meta.brokerRunnerPath;
  } catch { return; }
  try {
    const old = statSync(brokerStartLockFile);
    if (Date.now() - old.mtimeMs < 10_000) return;
    unlinkSync(brokerStartLockFile);
  } catch { /* no launch in progress */ }
  try {
    const fd = openSync(brokerStartLockFile, "wx");
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); }
    finally { closeSync(fd); }
  } catch { return; }
  try {
    const child = spawn(process.execPath, [brokerRunnerPath, workspaceRoot], {
      cwd: dirname(brokerRunnerPath), detached: true, windowsHide: true, stdio: "ignore",
    });
    child.once("error", () => { try { unlinkSync(brokerStartLockFile); } catch { /* retry on next hook */ } });
    child.unref();
  } catch {
    try { unlinkSync(brokerStartLockFile); } catch { /* retry on next hook */ }
  }
}

function signalBroker(endpoint) {
  if (typeof endpoint?.pipe !== "string" || typeof endpoint?.token !== "string" ||
      !/^[0-9a-f]{64}$/u.test(endpoint.token)) return Promise.resolve(false);
  return new Promise((resolveSignal) => {
    const socket = connect(endpoint.pipe);
    let settled = false;
    let response = "";
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveSignal(ok);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
    socket.once("connect", () => socket.write(`${JSON.stringify({ token: endpoint.token, method: "wake", args: [] })}\n`));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      const newline = response.indexOf("\n");
      if (newline < 0) return;
      try { finish(JSON.parse(response.slice(0, newline)).ok === true); }
      catch { finish(false); }
    });
  });
}

async function acquireQueueLock() {
  const started = Date.now();
  const token = randomUUID();
  for (;;) {
    try {
      const fd = openSync(queueLockFile, "wx");
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
      } finally {
        closeSync(fd);
      }
      return token;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      clearStaleQueueLock();
      if (Date.now() - started >= QUEUE_LOCK_WAIT_MS) {
        throw new Error("hook queue append lock remained busy");
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 15));
    }
  }
}

function clearStaleQueueLock() {
  try {
    const stat = statSync(queueLockFile);
    const holder = JSON.parse(readFileSync(queueLockFile, "utf8"));
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 2000) return;
    // A live compactor may hold this lock for longer than the stale-age
    // threshold. Never let a hook append to the soon-to-be-replaced file.
    if (processAlive(holder.pid) && !pidWasReused(holder.pid, holder.createdAt)) return;
    unlinkSync(queueLockFile);
  } catch {
    // A new holder may have replaced the lock; the next attempt will retry.
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function pidWasReused(pid, ownerCreatedAt) {
  const createdAt = typeof ownerCreatedAt === "string" ? Date.parse(ownerCreatedAt) : NaN;
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(createdAt)) return false;
  try {
    const output = process.platform === "win32"
      ? execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`],
        { encoding: "utf8", timeout: 3000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
      : execFileSync("ps", ["-p", String(pid), "-o", "lstart="],
        { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
    const observedStart = Date.parse(output.trim());
    return Number.isFinite(observedStart) && observedStart > createdAt + 1000;
  } catch { return false; }
}

function releaseQueueLock(token) {
  try {
    const holder = JSON.parse(readFileSync(queueLockFile, "utf8"));
    if (holder.token === token) unlinkSync(queueLockFile);
  } catch {
    // A stopped hook cannot keep the queue lock alive.
  }
}

function sanitizePayload(raw, hookEventName) {
  // Construct the queued event from known metadata. Recursively copying unknown
  // fields risks persisting new Codex payload fields containing private text.
  const payload = { hook_event_name: hookEventName, cwd: workspaceRoot };
  if (raw.session_id === "forge-hook-probe" || raw.forgeHookProbe === true) payload.forgeHookProbe = true;
  if (raw.forgeHookCanary === "FORGE_HOOK_SMOKE_CANARY") payload.forgeHookCanary = "FORGE_HOOK_SMOKE_CANARY";
  for (const key of ["session_id", "turn_id", "tool_name", "tool_use_id", "permission_mode", "model", "source", "reason", "trigger"]) {
    const value = raw[key];
    if (typeof value === "string" && SAFE_ID.test(value)) payload[key] = value;
  }

  const toolInput = objectField(raw, "tool_input") ?? objectField(raw, "toolInput");
  const toolResponse = objectField(raw, "tool_response") ?? objectField(raw, "toolResponse");
  const command = stringField(toolInput, "command") ?? stringField(raw, "command");
  if (command) {
    payload.commandHash = hashStable(command);
    payload.commandStored = false;
    payload.commandSummary = summarizeCommand(command);
    payload.commandKind = classifyCommand(stringField(raw, "tool_name") ?? stringField(raw, "toolName"), command);
  }

  const exitCode = numberField(toolResponse, "exitCode") ?? numberField(toolResponse, "exit_code") ??
    numberField(raw, "exitCode") ?? numberField(raw, "exit_code");
  if (exitCode !== undefined) {
    payload.exitCode = exitCode;
    payload.resultStatus = exitCode === 0 ? "success" : "failed";
  } else {
    const status = stringField(toolResponse, "status") ?? stringField(raw, "status");
    if (status && SAFE_ID.test(status)) {
      payload.resultStatus = status;
    }
  }
  if (toolResponse) {
    payload.responseHash = hashStable(JSON.stringify(toolResponse));
    payload.responseStored = false;
  }

  return payload;
}

function objectField(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const child = value[key];
  return child && typeof child === "object" && !Array.isArray(child) ? child : undefined;
}

function stringField(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const child = value[key];
  return typeof child === "string" && child.length > 0 ? child : undefined;
}

function numberField(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const child = value[key];
  return typeof child === "number" && Number.isFinite(child) ? child : undefined;
}

function summarizeCommand(command) {
  const match = /^\s*(forge)\s+(status|changed|check|verify|run|agent|fabric|generate|inspect|test)\b/u.exec(command);
  return match ? match.slice(1).filter(Boolean).join(" ") : "[command redacted]";
}

function classifyCommand(toolName, command) {
  if (toolName === "apply_patch" || command.includes("*** Begin Patch")) {
    return "patch";
  }
  if (/^\s*(?:node|npm|bun|pnpm|yarn|forge|git)\b/u.test(command)) {
    return "shell";
  }
  return "unknown";
}

function hashStable(value) {
  return createHash("sha256").update(value).digest("hex");
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
