import { describe, expect, test } from "bun:test";
import { normalizeSignatureText } from "../../src/forge/compiler/package-graph/dts-extractor.ts";

describe("package graph signature path determinism", () => {
  test("canonicalizes absolute node_modules import paths across operating systems", () => {
    const posix = 'typeof import("/home/runner/work/forge/forge/node_modules/zod/v3/external")';
    const windows = 'typeof import("D:\\a\\forge\\forge\\node_modules\\zod\\v3\\external")';

    expect(normalizeSignatureText(posix)).toBe('typeof import("zod/v3/external")');
    expect(normalizeSignatureText(windows)).toBe('typeof import("zod/v3/external")');
  });

  test("uses the innermost node_modules boundary for pnpm and scoped packages", () => {
    expect(
      normalizeSignatureText(
        'typeof import("/repo/node_modules/.pnpm/@scope+pkg@1.2.3/node_modules/@scope/pkg/subpath")',
      ),
    ).toBe('typeof import("@scope/pkg/subpath")');
  });

  test("does not rewrite non-node_modules module specifiers", () => {
    expect(normalizeSignatureText('typeof import("./local-module")')).toBe(
      'typeof import("./local-module")',
    );
  });
});
