import { createHash } from "node:crypto";
import { AgentFabricError } from "./errors.ts";
import type { Digest, DigestFunction } from "./types.ts";

/**
 * P0a canonical JSON profile.
 *
 * This profile is intentionally explicit and deterministic for the current
 * TypeScript/JavaScript reference implementation. Cross-language JCS
 * conformance is a separate protocol profile and is not claimed here.
 */
export const P0A_CANONICALIZATION_PROFILE = "forge-canonical-json/v0.1" as const;

function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AgentFabricError(
        "AF_CANONICALIZATION_FAILED",
        "Canonical values cannot contain non-finite numbers",
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    throw new AgentFabricError(
      "AF_CANONICALIZATION_FAILED",
      `Unsupported canonical value type: ${typeof value}`,
    );
  }

  if (typeof value === "bigint") {
    throw new AgentFabricError(
      "AF_CANONICALIZATION_FAILED",
      "BigInt values must be encoded as strings before canonicalization",
    );
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new AgentFabricError("AF_CANONICALIZATION_FAILED", "Canonical values cannot be cyclic");
    }
    seen.add(value);
    const normalized = value.map((item) => normalize(item, seen));
    seen.delete(value);
    return normalized;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new AgentFabricError("AF_CANONICALIZATION_FAILED", "Canonical values cannot be cyclic");
    }
    seen.add(value);
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) {
        throw new AgentFabricError(
          "AF_CANONICALIZATION_FAILED",
          `Canonical object property ${key} is undefined`,
        );
      }
      normalized[key] = normalize(record[key], seen);
    }
    seen.delete(value);
    return normalized;
  }

  throw new AgentFabricError("AF_CANONICALIZATION_FAILED", "Unsupported canonical value");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value, new Set<object>()));
}

export function sha256Digest(canonicalValue: string): Digest {
  return `sha256:${createHash("sha256").update(canonicalValue).digest("hex")}`;
}

export function digestCanonical(
  value: unknown,
  digest: DigestFunction,
): Digest {
  return digest(stableStringify(value));
}
