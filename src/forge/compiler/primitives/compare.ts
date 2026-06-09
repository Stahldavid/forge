/**
 * Compare two strings by UTF-8 byte sequence (case-sensitive, locale-independent).
 * Returns negative if a < b, positive if a > b, zero if equal.
 */
export function compareBytes(a: string, b: string): number {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const len = Math.min(aBytes.length, bBytes.length);

  for (let i = 0; i < len; i++) {
    const diff = aBytes[i]! - bBytes[i]!;
    if (diff !== 0) {
      return diff;
    }
  }

  return aBytes.length - bBytes.length;
}

export function compareBytesAsc(a: string, b: string): number {
  return compareBytes(a, b);
}

export function compareBytesDesc(a: string, b: string): number {
  return compareBytes(b, a);
}
