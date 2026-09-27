#!/usr/bin/env node
/**
 * Lightweight Codex hook runner — no Forge CLI, no DeltaDB.
 * Reads stdin with a short timeout, enqueues a redacted event to .forge/agent/events.ndjson, exits.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, openSync, closeSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const STDIN_TIMEOUT_MS = 750;
const eventName = process.argv[2];

if (!eventName) {
  process.stderr.write("usage: codex-hook.mjs <CodexHookEvent>\n");
  process.exit(2);
}

const workspaceRoot = resolve(process.cwd());
const eventsFile = join(workspaceRoot, ".forge", "agent", "events.ndjson");
const queueLockFile = `${eventsFile}.append-lock.json`;
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
    appendFileSync(eventsFile, `${JSON.stringify(entry)}\n`, "utf8");
  } finally {
    releaseQueueLock(lock);
  }
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
    if (ageMs < 30000 && processAlive(holder.pid)) return;
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
