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

function canonicalizationFailure(message: string): never {
  throw new AgentFabricError("AF_CANONICALIZATION_FAILED", message);
}

function assertJsonObjectShape(value: object): void {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    canonicalizationFailure("Canonical objects must have Object.prototype or null prototype");
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      canonicalizationFailure("Canonical objects cannot contain symbol properties");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) {
      canonicalizationFailure(`Canonical object property ${key} must be enumerable`);
    }
    if (!("value" in descriptor)) {
      canonicalizationFailure(`Canonical object property ${key} cannot be an accessor`);
    }
  }
}

function assertJsonArrayShape(value: readonly unknown[]): void {
  const ownKeys = Reflect.ownKeys(value);
  const expectedIndexKeys = new Set(Array.from({ length: value.length }, (_, index) => String(index)));

  for (const key of ownKeys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !expectedIndexKeys.has(key)) {
      canonicalizationFailure("Canonical arrays cannot contain extra or symbol properties");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      canonicalizationFailure(`Canonical array index ${key} must be an enumerable data property`);
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      canonicalizationFailure("Canonical arrays cannot be sparse");
    }
  }
}

function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      canonicalizationFailure("Canonical values cannot contain non-finite numbers");
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    canonicalizationFailure(`Unsupported canonical value type: ${typeof value}`);
  }

  if (typeof value === "bigint") {
    canonicalizationFailure("BigInt values must be encoded as strings before canonicalization");
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) canonicalizationFailure("Canonical values cannot be cyclic");
    assertJsonArrayShape(value);
    seen.add(value);
    const normalized = value.map((item) => normalize(item, seen));
    seen.delete(value);
    return normalized;
  }

  if (typeof value === "object") {
    if (seen.has(value)) canonicalizationFailure("Canonical values cannot be cyclic");
    assertJsonObjectShape(value);
    seen.add(value);
    const record = value as Record<string, unknown>;
    // A null-prototype accumulator is required so an own `__proto__` key is
    // preserved as data rather than invoking Object.prototype's legacy setter.
    const normalized = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) {
        canonicalizationFailure(`Canonical object property ${key} is undefined`);
      }
      normalized[key] = normalize(record[key], seen);
    }
    seen.delete(value);
    return normalized;
  }

  canonicalizationFailure("Unsupported canonical value");
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
