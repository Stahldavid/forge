import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "./helpers.ts";

describe("Property 2: Idempotency", () => {
  test(
    "second generate with unchanged inputs reports changed === []",
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.constantFrom(1, 2), async (concurrency) => {
          const workspace = scaffoldGenerateWorkspace(`idempotent-${concurrency}`);
          try {
            const first = await run({
              ...defaultGenerateOptions(workspace),
              concurrency,
            });
            expect(first.exitCode).toBe(0);

            const second = await run({
              ...defaultGenerateOptions(workspace),
              concurrency,
            });
            expect(second.exitCode).toBe(0);
            expect(second.changed).toEqual([]);
          } finally {
            cleanupWorkspace(workspace);
          }
        }),
        { numRuns: 2 },
      );
    },
    60000,
  );
});
