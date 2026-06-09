import { describe, expect, test } from "bun:test";
import {
  canonicalJson,
  normalizeNewlines,
  serializeCanonical,
} from "../../src/forge/compiler/primitives/serialize.ts";

describe("normalizeNewlines", () => {
  test("converts CRLF and CR to LF", () => {
    expect(normalizeNewlines("a\r\nb\rc")).toBe("a\nb\nc\n");
  });

  test("ensures exactly one trailing newline", () => {
    expect(normalizeNewlines("hello")).toBe("hello\n");
    expect(normalizeNewlines("hello\n")).toBe("hello\n");
    expect(normalizeNewlines("hello\n\n")).toBe("hello\n\n");
  });

  test("empty content becomes a single newline", () => {
    expect(normalizeNewlines("")).toBe("\n");
  });
});

describe("canonicalJson", () => {
  test("sorts object keys deterministically", () => {
    const input = { z: 1, a: 2, m: 3 };
    expect(canonicalJson(input)).toBe('{"a":2,"m":3,"z":1}');
  });

  test("nested objects have sorted keys", () => {
    const input = { b: { z: 1, a: 2 }, a: 1 };
    expect(canonicalJson(input)).toBe('{"a":1,"b":{"a":2,"z":1}}');
  });

  test("is stable across repeated serialization", () => {
    const input = { name: "forge", version: "0.0.0", packages: ["a", "z"] };
    const first = canonicalJson(input);
    const second = canonicalJson(input);
    expect(first).toBe(second);
  });
});

describe("serializeCanonical", () => {
  test("applies newline normalization to JSON output", () => {
    const result = serializeCanonical({ ok: true });
    expect(result.endsWith("\n")).toBe(true);
    expect(result).not.toContain("\r");
  });
});
