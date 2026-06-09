import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { forgeAdd } from "../../src/forge/compiler/integration/add.ts";
import {
  restoreVersionControlledSnapshot,
  snapshotVersionControlled,
} from "../../src/forge/compiler/integration/snapshot.ts";
import { loadExistingForgeLock } from "../../src/forge/compiler/integration/plan.ts";
import {
  cleanupWorkspace,
  createFailingPmAdapter,
  createFixturePmAdapter,
  scaffoldAddWorkspace,
} from "./helpers.ts";

describe("Property 9: Lock Integrity", () => {
  test("successful add verifies every forge.lock.generatedFiles path exists", async () => {
    const workspace = scaffoldAddWorkspace("lock-integrity");
    try {
      const result = await forgeAdd("zod", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      const lock = loadExistingForgeLock(workspace);
      expect(lock).not.toBeNull();

      for (const entry of lock!.packages) {
        for (const file of entry.generatedFiles) {
          expect(existsSync(join(workspace, file))).toBe(true);
        }
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("transactional failure restores snapshotted version-controlled files", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("stripe", "zod"), async (alias) => {
        const workspace = scaffoldAddWorkspace(`rollback-${alias}`);
        const snapshot = snapshotVersionControlled(workspace);
        const originalPkg = readFileSync(join(workspace, "package.json"), "utf8");

        writeFileSync(
          join(workspace, "package.json"),
          `${JSON.stringify({ name: "mutated", version: "9.9.9" }, null, 2)}\n`,
          "utf8",
        );

        restoreVersionControlledSnapshot(workspace, snapshot);
        expect(readFileSync(join(workspace, "package.json"), "utf8")).toBe(originalPkg);

        const result = await forgeAdd(alias, {
          workspaceRoot: workspace,
          json: false,
          dryRun: false,
          runtimeInspect: false,
          sandboxBackend: "none",
          allowScripts: false,
          pmAdapter: createFailingPmAdapter(),
        });

        expect(result.exitCode).toBe(1);
        expect(readFileSync(join(workspace, "package.json"), "utf8")).toBe(originalPkg);
        cleanupWorkspace(workspace);
      }),
      { numRuns: 2 },
    );
  });
});
