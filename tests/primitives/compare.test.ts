import { describe, expect, test } from "bun:test";
import { compareBytes } from "../../src/forge/compiler/primitives/compare.ts";
import { comparePaths, normalizePath } from "../../src/forge/compiler/primitives/paths.ts";

describe("compareBytes", () => {
  test("orders ASCII strings lexicographically by UTF-8 bytes", () => {
    expect(compareBytes("a", "b")).toBeLessThan(0);
    expect(compareBytes("b", "a")).toBeGreaterThan(0);
    expect(compareBytes("abc", "abc")).toBe(0);
  });

  test("is case-sensitive", () => {
    expect(compareBytes("A", "a")).toBeLessThan(0);
    expect(compareBytes("a", "A")).toBeGreaterThan(0);
  });

  test("compares by byte length when prefixes match", () => {
    expect(compareBytes("ab", "abc")).toBeLessThan(0);
    expect(compareBytes("abc", "ab")).toBeGreaterThan(0);
  });

  test("handles multi-byte UTF-8 sequences", () => {
    // UTF-8: ä = [0xC3, 0xA4], b = [0x62]; 0xC3 > 0x62
    expect(compareBytes("ä", "b")).toBeGreaterThan(0);
    expect(compareBytes("b", "ä")).toBeLessThan(0);
  });
});

describe("normalizePath", () => {
  test("converts backslashes to forward slashes", () => {
    expect(normalizePath("src\\forge\\cli")).toBe("src/forge/cli");
  });

  test("strips leading ./ segments", () => {
    expect(normalizePath("./src/forge/cli")).toBe("src/forge/cli");
  });

  test("collapses duplicate slashes", () => {
    expect(normalizePath("src//forge///cli")).toBe("src/forge/cli");
  });

  test("removes trailing slash except root", () => {
    expect(normalizePath("src/forge/")).toBe("src/forge");
  });
});

describe("comparePaths", () => {
  test("compares normalized POSIX paths", () => {
    expect(comparePaths("src\\b", "src/a")).toBeGreaterThan(0);
    expect(comparePaths("src/a", "src\\b")).toBeLessThan(0);
  });
});
