#!/usr/bin/env node
/**
 * Lightweight Codex hook runner — no Forge CLI, no DeltaDB.
 * Reads stdin with a short timeout, enqueues a redacted event to .forge/agent/events.ndjson, exits.
 */
import { createHash } from "node:crypto";
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

const RAW_TEXT_KEYS = new Set([
  "prompt",
  "userPrompt",
  "last_assistant_message",
  "lastAssistantMessage",
  "completion",
  "message",
  "transcript",
  "transcript_path",
  "transcriptPath",
  "output",
  "stdout",
  "stderr",
  "result",
]);

const RAW_ARGS_KEYS = new Set(["args", "arguments", "tool_input", "toolInput", "tool_response", "toolResponse", "input"]);

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
  appendFileSync(eventsFile, `${JSON.stringify(entry)}\n`, "utf8");
}

function sanitizePayload(raw, hookEventName) {
  const payload = stripRawPayload(raw);
  if (!payload.hook_event_name) {
    payload.hook_event_name = hookEventName;
  }
  if (!payload.cwd) {
    payload.cwd = workspaceRoot;
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

  const description = stringField(toolInput, "description");
  if (description) {
    payload.approvalDescriptionSummary = safeSummary(description, 180);
  }

  const exitCode = numberField(toolResponse, "exitCode") ?? numberField(toolResponse, "exit_code") ??
    numberField(raw, "exitCode") ?? numberField(raw, "exit_code");
  if (exitCode !== undefined) {
    payload.exitCode = exitCode;
    payload.resultStatus = exitCode === 0 ? "success" : "failed";
  } else {
    const status = stringField(toolResponse, "status") ?? stringField(raw, "status");
    if (status) {
      payload.resultStatus = status;
    }
  }

  const responseSummary = summarizeToolResponse(toolResponse);
  if (responseSummary) {
    payload.responseSummary = responseSummary;
  }
  if (toolResponse) {
    payload.responseHash = hashStable(JSON.stringify(toolResponse));
    payload.responseStored = false;
  }

  return payload;
}

function stripRawPayload(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => stripRawPayload(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (RAW_TEXT_KEYS.has(key)) {
      output[`${key}Hash`] = hashStable(typeof child === "string" ? child : JSON.stringify(child ?? null));
      output[`${key}Stored`] = false;
      if (typeof child === "string" && !isPromptLikeKey(key)) {
        const summary = safeSummary(child, 160);
        if (summary) {
          output[`${key}Summary`] = summary;
        }
      }
      continue;
    }
    if (RAW_ARGS_KEYS.has(key)) {
      output[`${key}Hash`] = hashStable(JSON.stringify(child ?? null));
      output[`${key}Stored`] = false;
      output[`${key}Shape`] = describeShape(child);
      continue;
    }
    output[key] = stripRawPayload(child);
  }
  return output;
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

function describeShape(value) {
  if (Array.isArray(value)) {
    return { kind: "array", length: value.length };
  }
  if (value && typeof value === "object") {
    return {
      kind: "object",
      keys: Object.keys(value).slice(0, 20).sort(),
    };
  }
  return { kind: typeof value };
}

function summarizeCommand(command) {
  return safeSummary(
    command
      .replace(/--(token|api-key|apikey|password|secret)\s+[^\s]+/giu, "--$1 [REDACTED]")
      .replace(/(["']?)(token|apiKey|api_key|password|secret)(["']?)\s*:\s*(["'])(.*?)\4/giu, "$1$2$3: \"[REDACTED]\""),
    220,
  ) ?? "[command redacted]";
}

function summarizeToolResponse(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return undefined;
  }
  const text = stringField(response, "stdout") ?? stringField(response, "stderr") ??
    stringField(response, "output") ?? stringField(response, "result");
  return text ? safeSummary(text, 180) : undefined;
}

function safeSummary(value, maxLength) {
  const normalized = scrubSecretTokens(value).replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
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

function isPromptLikeKey(key) {
  return key.toLowerCase().includes("prompt") || key.toLowerCase().includes("completion") || key.toLowerCase().includes("message");
}

function scrubSecretTokens(value) {
  return value
    .replace(/\bsk[-_][A-Za-z0-9_\-.]{8,}\b/gu, "[REDACTED]")
    .replace(/\bnpm_[A-Za-z0-9]{16,}\b/gu, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/gu, "[REDACTED]")
    .replace(/\b(?:xox[baprs]-)[A-Za-z0-9-]{16,}\b/gu, "[REDACTED]");
}

function hashStable(value) {
  return createHash("sha256").update(value).digest("hex");
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
