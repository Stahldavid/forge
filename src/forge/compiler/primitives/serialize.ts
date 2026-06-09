import type { JsonValue } from "../types/json.ts";
import { compareBytes } from "./compare.ts";

/**
 * Normalize line endings to LF and ensure exactly one trailing newline.
 */
export function normalizeNewlines(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.length === 0) {
    return "\n";
  }
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function sortObjectKeys(value: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(value).sort(compareBytes);
  for (const key of keys) {
    sorted[key] = canonicalizeValue(value[key]);
  }
  return sorted;
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }

  if (isPlainObject(value)) {
    return sortObjectKeys(value);
  }

  return value;
}

/**
 * Serialize a value to canonical JSON with stable key ordering.
 */
export function canonicalJson(value: unknown): string {
  const canonical = canonicalizeValue(value);
  return JSON.stringify(canonical);
}

/**
 * Serialize to canonical JSON with normalized newlines and trailing newline.
 */
export function serializeCanonical(value: unknown): string {
  return normalizeNewlines(canonicalJson(value));
}

export function serializeJsonValue(value: JsonValue): string {
  return serializeCanonical(value);
}
