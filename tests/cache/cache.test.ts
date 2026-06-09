import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import {
  ConcurrencyTracker,
  runWithConcurrency,
  runWithConcurrencyTracked,
} from "../../src/forge/compiler/cache/scheduler.ts";
import { PackageGraphCompiler } from "../../src/forge/compiler/package-graph/compiler.ts";
import { FIXTURE_PACKAGES, tempCacheDir } from "../package-graph/helpers.ts";

describe("bounded concurrency scheduler", () => {
  test("runWithConcurrency preserves result order", async () => {
    const input = [1, 2, 3, 4, 5];
    const out = await runWithConcurrency(input, 2, async (value) => value * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  test("concurrency 1 runs sequentially", async () => {
    const tracker = new ConcurrencyTracker();
    const items = Array.from({ length: 6 }, (_, i) => i);

    await runWithConcurrencyTracked(
      items,
      1,
      async (item) => {
        await Bun.sleep(1);
        return item;
      },
      tracker,
    );

    expect(tracker.maxObserved).toBe(1);
  });

  test("respects concurrency upper bound", async () => {
    const tracker = new ConcurrencyTracker();
    const items = Array.from({ length: 12 }, (_, i) => i);

    await runWithConcurrencyTracked(
      items,
      3,
      async (item) => {
        await Bun.sleep(5);
        return item;
      },
      tracker,
    );

    expect(tracker.maxObserved).toBeLessThanOrEqual(3);
    expect(tracker.maxObserved).toBeGreaterThan(1);
  });
});

describe("PackageGraphCompiler concurrency", () => {
  test("build analyzes multiple packages with bounded workers", async () => {
    const cacheDir = tempCacheDir("multi");
    mkdirSync(cacheDir, { recursive: true });
    const compiler = new PackageGraphCompiler();

    const deps = [
      FIXTURE_PACKAGES.zod,
      FIXTURE_PACKAGES.stripe,
      FIXTURE_PACKAGES.ai,
      FIXTURE_PACKAGES.posthogJs,
    ];

    const result = await compiler.build(deps, {
      runtimeInspect: false,
      resolutionMode: "nodenext",
      cacheDir,
      concurrency: 2,
    });

    rmSync(cacheDir, { recursive: true, force: true });
    expect(result.graph.packages.length).toBe(4);
    expect(result.graph.packages.map((p) => p.name).sort()).toEqual(
      ["ai", "posthog-js", "stripe", "zod"],
    );
  });
});
