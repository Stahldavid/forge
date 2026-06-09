import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { PackageGraphCompiler } from "../../src/forge/compiler/package-graph/compiler.ts";
import {
  discoverSubpathsFromExports,
  expandPatternSubpaths,
} from "../../src/forge/compiler/package-graph/exports-discovery.ts";
import { FIXTURE_PACKAGES, tempCacheDir } from "./helpers.ts";

const MODES = ["nodenext", "bundler"] as const;

describe("PackageGraph extraction fixtures", () => {
  for (const mode of MODES) {
    test(`zod exports resolve in ${mode} mode`, async () => {
      const api = await analyze(FIXTURE_PACKAGES.zod, mode);
      const root = api.entrypoints.find((ep) => ep.subpath === ".");
      expect(root?.dtsPath).toContain("index.d.ts");
      expect(root?.exports.some((ex) => ex.name === "parse")).toBe(true);
      expect(root?.exports.find((ex) => ex.name === "parse")?.jsdoc?.summary).toContain(
        "Parse a string",
      );
      expect(
        root?.exports.find((ex) => ex.name === "parse")?.examples.length,
      ).toBeGreaterThan(0);
    });

    test(`stripe subpath exports resolve in ${mode} mode`, async () => {
      const api = await analyze(FIXTURE_PACKAGES.stripe, mode);
      const main = api.entrypoints.find((ep) => ep.subpath === ".");
      const server = api.entrypoints.find((ep) => ep.subpath === "./server");
      expect(main?.exports.some((ex) => ex.name === "Stripe")).toBe(true);
      expect(server?.exports.some((ex) => ex.name === "constructEvent")).toBe(
        true,
      );
    });

    test(`posthog client/server fixtures in ${mode} mode`, async () => {
      const client = await analyze(FIXTURE_PACKAGES.posthogJs, mode);
      const server = await analyze(FIXTURE_PACKAGES.posthogNode, mode);
      expect(client.entrypoints[0]?.exports.some((ex) => ex.name === "PostHog")).toBe(
        true,
      );
      expect(server.entrypoints[0]?.exports.some((ex) => ex.name === "createPostHog")).toBe(
        true,
      );
    });

    test(`ai entrypoints in ${mode} mode`, async () => {
      const api = await analyze(FIXTURE_PACKAGES.ai, mode);
      expect(api.entrypoints.some((ep) => ep.subpath === ".")).toBe(true);
      expect(api.entrypoints.some((ep) => ep.subpath === "./rsc")).toBe(true);
      const root = api.entrypoints.find((ep) => ep.subpath === ".");
      expect(root?.exports.some((ex) => ex.name === "generateText")).toBe(true);
    });
  }

  test("captures overload signatures", async () => {
    const api = await analyze(FIXTURE_PACKAGES.overloadLib, "nodenext");
    const fmt = api.entrypoints[0]?.exports.find((ex) => ex.name === "fmt");
    expect(fmt?.overloads?.length).toBeGreaterThan(0);
    expect(fmt?.examples.length).toBeGreaterThan(0);
  });

  test("expands pattern exports below the configured limit", () => {
    const subpaths = discoverSubpathsFromExports({
      ".": { types: "./index.d.ts" },
      "./features/*": { types: "./features/*.d.ts" },
    });
    expect(subpaths.some((s) => s.patternBacked)).toBe(true);

    const expanded = expandPatternSubpaths(
      FIXTURE_PACKAGES.patternLib.installPath,
      "./features/*",
      10,
    );
    expect(expanded).toEqual(["./features/alpha.d.ts", "./features/beta.d.ts"]);
  });

  test("respects pattern expansion limit", () => {
    const expanded = expandPatternSubpaths(
      FIXTURE_PACKAGES.patternLib.installPath,
      "./features/*",
      1,
    );
    expect(expanded.length).toBe(1);
  });

  test("emits FORGE_PKG_NO_TYPES for untyped subpaths", async () => {
    const cacheDir = tempCacheDir("untyped");
    mkdirSync(cacheDir, { recursive: true });
    const compiler = new PackageGraphCompiler();
    const result = await compiler.build([FIXTURE_PACKAGES.untypedLib], {
      runtimeInspect: false,
      resolutionMode: "nodenext",
      cacheDir,
    });
    rmSync(cacheDir, { recursive: true, force: true });

    expect(result.diagnostics.some((d) => d.code === "FORGE_PKG_NO_TYPES")).toBe(
      true,
    );
    const root = result.graph.packages[0]?.entrypoints.find(
      (ep) => ep.subpath === ".",
    );
    expect(root?.exports.length).toBe(0);
  });

  test("falls back to @types/* when bundled types are missing", async () => {
    const api = await analyze(FIXTURE_PACKAGES.needsTypesPackage, "nodenext");
    const root = api.entrypoints.find((ep) => ep.subpath === ".");
    expect(root?.dtsPath).toContain("@types");
    expect(root?.exports.some((ex) => ex.name === "fromTypes")).toBe(true);
  });

  test("contentChecksum is stable for identical inputs", async () => {
    const a = await analyze(FIXTURE_PACKAGES.zod, "nodenext");
    const b = await analyze(FIXTURE_PACKAGES.zod, "nodenext");
    expect(a.contentChecksum).toBe(b.contentChecksum);
    expect(a.contentChecksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

async function analyze(
  dep: (typeof FIXTURE_PACKAGES)[keyof typeof FIXTURE_PACKAGES],
  mode: (typeof MODES)[number],
) {
  const cacheDir = tempCacheDir(`extract-${dep.name}-${mode}`);
  mkdirSync(cacheDir, { recursive: true });
  const compiler = new PackageGraphCompiler();
  try {
    return await compiler.analyze(dep, {
      runtimeInspect: false,
      resolutionMode: mode,
      cacheDir,
    });
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}
