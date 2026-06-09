import { describe, expect, test } from "bun:test";
import { createDebouncedCallback } from "../../src/forge/dev/watch.ts";

describe("dev watch debounce", () => {
  test("debounced callback fires once with accumulated changes", async () => {
    const calls: number[] = [];
    const debounced = createDebouncedCallback(50, async (changedCount) => {
      calls.push(changedCount);
    });

    debounced(1);
    debounced(2);
    debounced(3);

    await Bun.sleep(120);

    expect(calls).toEqual([6]);
  });
});

describe("shouldSkipWatchPath", () => {
  test("skips generated and dependency directories", async () => {
    const { shouldSkipWatchPath } = await import("../../src/forge/dev/watch.ts");

    expect(shouldSkipWatchPath("src/forge/_generated/appGraph.ts")).toBe(true);
    expect(shouldSkipWatchPath("node_modules/zod/index.js")).toBe(true);
    expect(shouldSkipWatchPath(".forge/cache/manifest.json")).toBe(true);
    expect(shouldSkipWatchPath("src/commands/createTicket.ts")).toBe(false);
  });
});
