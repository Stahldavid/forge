import { stripDeterministicHeader } from "./header.ts";

/**
 * SHA-256 hash of UTF-8 content, returned as lowercase hex.
 */
export function hashStable(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
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
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}
