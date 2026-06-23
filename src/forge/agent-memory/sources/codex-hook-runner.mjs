#!/usr/bin/env node
/**
 * Lightweight Codex hook runner — no Forge CLI, no DeltaDB.
 * Reads stdin with a short timeout, enqueues to .forge/agent/events.ndjson, exits.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const STDIN_TIMEOUT_MS = 750;
const eventName = process.argv[2];

if (!eventName) {
  process.stderr.write("usage: codex-hook.mjs <CodexHookEvent>\n");
  process.exit(2);
}

const workspaceRoot = resolve(process.cwd());
const eventsFile = join(workspaceRoot, ".forge", "agent", "events.ndjson");

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
    raw,
  };

  mkdirSync(dirname(eventsFile), { recursive: true });
  appendFileSync(eventsFile, `${JSON.stringify(entry)}\n`, "utf8");
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
