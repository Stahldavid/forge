import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FORGE_ORPHANED_GENERATED_FILE } from "../../src/forge/compiler/diagnostics/codes.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/index.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "./helpers.ts";

describe("Property 3: Check Equals Drift", () => {
  test("check exits 1 iff write would change a file", async () => {
    const workspace = scaffoldGenerateWorkspace("check-equals-write");
    try {
      const writeResult = await run(defaultGenerateOptions(workspace));
      expect(writeResult.exitCode).toBe(0);

      const cleanCheck = await run({
        ...defaultGenerateOptions(workspace),
        check: true,
      });
      expect(cleanCheck.exitCode).toBe(0);

      const appGraphPath = join(workspace, GENERATED_DIR, "appGraph.ts");
      const original = readFileSync(appGraphPath, "utf8");
      writeFileSync(
        appGraphPath,
        `${stripDeterministicHeader(original)}// mutation\n`,
        "utf8",
      );

      const driftCheck = await run({
        ...defaultGenerateOptions(workspace),
        check: true,
      });
      expect(driftCheck.exitCode).toBe(1);
      expect(driftCheck.changed.length).toBeGreaterThan(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test(
    "check exits 1 when orphaned generated files exist",
    async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-z][a-z0-9]{2,8}$/),
        async (suffix) => {
          const workspace = scaffoldGenerateWorkspace(`orphan-${suffix}`);
          try {
            await run(defaultGenerateOptions(workspace));

            const orphanRel = `${GENERATED_DIR}/orphan-${suffix}.ts`;
            mkdirSync(join(workspace, GENERATED_DIR), { recursive: true });
            writeFileSync(
              join(workspace, orphanRel),
              "export const orphan = true;\n",
              "utf8",
            );

            const checked = await run({
              ...defaultGenerateOptions(workspace),
              check: true,
            });
            expect(checked.exitCode).toBe(1);
            expect(
              checked.errors.some(
                (d) => d.code === FORGE_ORPHANED_GENERATED_FILE,
              ),
            ).toBe(true);
          } finally {
            cleanupWorkspace(workspace);
          }
        },
      ),
      { numRuns: 3 },
    );
  }, 30_000);

  test("check exits 0 when no drift, orphans, or errors", async () => {
    const workspace = scaffoldGenerateWorkspace("check-clean");
    try {
      await run(defaultGenerateOptions(workspace));
      const checked = await run({
        ...defaultGenerateOptions(workspace),
        check: true,
      });
      expect(checked.exitCode).toBe(0);
      expect(checked.errors).toHaveLength(0);
      expect(checked.changed).toEqual([]);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
