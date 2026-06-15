import { createHash } from "node:crypto";
import { stripDeterministicHeader } from "./header.ts";

/**
 * SHA-256 hash of UTF-8 text, returned as lowercase hex.
 *
 * Forge generated artifacts must be stable across Windows and Linux checkouts.
 * Git may materialize source files with CRLF locally and LF in CI, so text
 * hashes normalize line endings. Use hashUtf8Bytes when byte-level identity is
 * required.
 */
export function hashStable(content: string): string {
  return createHash("sha256").update(normalizeHashText(content)).digest("hex");
}

export function normalizeHashText(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

/**
 * Hash content after stripping the deterministic header (for diff/cache keys).
 */
export function hashStableBody(content: string): string {
  return hashStable(stripDeterministicHeader(content));
}

export interface StableSymbolIdInput {
  kind: string;
  canonicalModulePath: string;
  qualifiedName: string;
  exportPath: string;
}

/**
 * Derive a collision-safe stable symbol id from kind + module + name + export path.
 */
export function deriveStableSymbolId(input: StableSymbolIdInput): string {
  const parts = [
    input.kind,
    input.canonicalModulePath,
    input.qualifiedName,
    input.exportPath,
  ];
  return hashStable(parts.join("\0"));
}

export function hashUtf8Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
