import { describe, expect, test } from "bun:test";
import {
  deriveStableSymbolId,
  hashStable,
  hashStableBody,
} from "../../src/forge/compiler/primitives/hash.ts";
import {
  formatDeterministicHeader,
  prependDeterministicHeader,
  stripDeterministicHeader,
} from "../../src/forge/compiler/primitives/header.ts";

describe("hashStable", () => {
  test("returns deterministic SHA-256 hex for the same input", () => {
    const a = hashStable("hello");
    const b = hashStable("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("differs for different inputs", () => {
    expect(hashStable("hello")).not.toBe(hashStable("world"));
  });

  test("normalizes line endings for cross-platform generated artifacts", () => {
    expect(hashStable("line one\nline two\n")).toBe(
      hashStable("line one\r\nline two\r\n"),
    );
    expect(hashStable("line one\rline two\r")).toBe(
      hashStable("line one\nline two\n"),
    );
  });
});

describe("deriveStableSymbolId", () => {
  test("produces distinct ids for same name in different modules", () => {
    const idA = deriveStableSymbolId({
      kind: "query",
      canonicalModulePath: "src/a.ts",
      qualifiedName: "getUser",
      exportPath: "",
    });
    const idB = deriveStableSymbolId({
      kind: "query",
      canonicalModulePath: "src/b.ts",
      qualifiedName: "getUser",
      exportPath: "",
    });
    expect(idA).not.toBe(idB);
  });

  test("produces identical ids for identical tuples", () => {
    const input = {
      kind: "command",
      canonicalModulePath: "src/commands/charge.ts",
      qualifiedName: "charge",
      exportPath: "default",
    };
    expect(deriveStableSymbolId(input)).toBe(deriveStableSymbolId(input));
  });
});

describe("hashStableBody", () => {
  test("ignores deterministic header when hashing", () => {
    const body = "export const x = 1;\n";
    const withHeader = prependDeterministicHeader(body, {
      generatorVersion: "0.0.0",
      inputHash: "abc123",
    });
    expect(hashStableBody(withHeader)).toBe(hashStable(body));
  });
});

describe("deterministic header", () => {
  test("round-trips through strip and format", () => {
    const body = "export const x = 1;\n";
    const header = formatDeterministicHeader({
      generatorVersion: "1.0.0",
      inputHash: "input-hash",
      contentHash: hashStable(body),
    });
    const full = header + body;
    expect(stripDeterministicHeader(full)).toBe(body);
  });

  test("strips CRLF headers from Windows checkouts", () => {
    const body = "{\"ok\":true}\r\n";
    const full =
      "// @forge-generated generator=1.0.0 input=input-hash content=content-hash\r\n" +
      body;
    expect(stripDeterministicHeader(full)).toBe(body);
  });

  test("contains no timestamp", () => {
    const header = formatDeterministicHeader({
      generatorVersion: "1.0.0",
      inputHash: "input-hash",
      contentHash: "content-hash",
    });
    expect(header).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(header).not.toMatch(/timestamp/i);
  });
});
