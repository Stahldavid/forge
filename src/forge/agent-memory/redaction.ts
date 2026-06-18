import { hashStable } from "../compiler/primitives/hash.ts";
import { redactDeltaPayload } from "../delta/redaction.ts";

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

const RAW_ARGS_KEYS = new Set(["args", "arguments", "tool_input", "toolInput", "input"]);

export interface AgentPayloadRedaction {
  value: Record<string, unknown>;
  sensitiveFieldsRemoved: string[];
}

export function redactAgentPayload(payload: Record<string, unknown>): AgentPayloadRedaction {
  const removed: string[] = [];
  const coarse = stripRawPayload(payload, [], removed) as Record<string, unknown>;
  const redacted = redactDeltaPayload(coarse);
  return {
    value: redacted.value,
    sensitiveFieldsRemoved: [...new Set([...removed, ...redacted.redaction.diagnostics])],
  };
}

function stripRawPayload(value: unknown, path: string[], removed: string[]): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item, index) => stripRawPayload(item, [...path, String(index)], removed));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = [...path, key];
    if (RAW_TEXT_KEYS.has(key)) {
      removed.push(nextPath.join("."));
      output[`${key}Hash`] = typeof child === "string" ? hashStable(child) : hashStable(JSON.stringify(child ?? null));
      output[`${key}Stored`] = false;
      if (typeof child === "string" && !isPromptLikeKey(key)) {
        const summary = summarizeText(child);
        if (summary) {
          output[`${key}Summary`] = redactDeltaPayload({ summary }).value.summary;
        }
      }
      continue;
    }
    if (RAW_ARGS_KEYS.has(key)) {
      removed.push(nextPath.join("."));
      output[`${key}Hash`] = hashStable(JSON.stringify(child ?? null));
      output[`${key}Stored`] = false;
      output[`${key}Shape`] = describeShape(child);
      continue;
    }
    output[key] = stripRawPayload(child, nextPath, removed);
  }
  return output;
}

function isPromptLikeKey(key: string): boolean {
  return key.toLowerCase().includes("prompt") || key.toLowerCase().includes("completion") || key.toLowerCase().includes("message");
}

function summarizeText(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function describeShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    return { kind: "array", length: value.length };
  }
  if (value && typeof value === "object") {
    return {
      kind: "object",
      keys: Object.keys(value as Record<string, unknown>).slice(0, 20).sort(),
    };
  }
  return { kind: typeof value };
}
