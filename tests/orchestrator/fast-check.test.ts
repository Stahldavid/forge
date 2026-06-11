import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  FORGE_DRIFT,
  FORGE_ORPHANED_GENERATED_FILE,
} from "../../src/forge/compiler/diagnostics/codes.ts";
import {
  BARREL_INDEX_PATH,
  FORGE_LOCK_PATH,
  GENERATED_DIR,
} from "../../src/forge/compiler/emitter/constants.ts";
import { runFastGenerateCheck } from "../../src/forge/compiler/orchestrator/fast-check.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/index.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "./helpers.ts";

describe("fast generated check", () => {
  test("returns a clean hit when the manifest proves generated artifacts are current", async () => {
    const workspace = scaffoldGenerateWorkspace("fast-check-clean");
    try {
      await run(defaultGenerateOptions(workspace));

      const checked = runFastGenerateCheck(workspace);
      expect(checked.kind).toBe("hit");
      if (checked.kind !== "hit") return;

      expect(checked.result.exitCode).toBe(0);
      expect(checked.result.changed).toEqual([]);
      expect(checked.result.unchanged).toContain(FORGE_LOCK_PATH);
      expect(checked.result.unchanged).toContain(BARREL_INDEX_PATH);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("reports generated drift without rebuilding the compiler graph", async () => {
    const workspace = scaffoldGenerateWorkspace("fast-check-drift");
    try {
      await run(defaultGenerateOptions(workspace));

      const appGraphPath = join(workspace, GENERATED_DIR, "appGraph.ts");
      const current = readFileSync(appGraphPath, "utf8");
      writeFileSync(
        appGraphPath,
        `${stripDeterministicHeader(current)}// drift\n`,
        "utf8",
      );

      const checked = runFastGenerateCheck(workspace);
      expect(checked.kind).toBe("hit");
      if (checked.kind !== "hit") return;

      expect(checked.result.exitCode).toBe(1);
      expect(checked.result.changed).toContain(`${GENERATED_DIR}/appGraph.ts`);
      expect(checked.result.warnings.some((diag) => diag.code === FORGE_DRIFT)).toBe(true);
      expect(checked.result.errors).toEqual([]);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("reports orphaned generated files from the manifest file set", async () => {
    const workspace = scaffoldGenerateWorkspace("fast-check-orphan");
    try {
      await run(defaultGenerateOptions(workspace));
      writeFileSync(
        join(workspace, GENERATED_DIR, "orphan.ts"),
        "export const orphan = true;\n",
        "utf8",
      );

      const checked = runFastGenerateCheck(workspace);
      expect(checked.kind).toBe("hit");
      if (checked.kind !== "hit") return;

      expect(checked.result.exitCode).toBe(1);
      expect(
        checked.result.errors.some(
          (diag) => diag.code === FORGE_ORPHANED_GENERATED_FILE,
        ),
      ).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("misses when source inputs change so the full generator can recompute semantics", async () => {
    const workspace = scaffoldGenerateWorkspace("fast-check-source-change");
    try {
      await run(defaultGenerateOptions(workspace));
      writeFileSync(
        join(workspace, "src", "forge", "commands.ts"),
        `${readFileSync(join(workspace, "src", "forge", "commands.ts"), "utf8")}\nexport const localOnly = true;\n`,
        "utf8",
      );

      const checked = runFastGenerateCheck(workspace);
      expect(checked.kind).toBe("miss");
      if (checked.kind !== "miss") return;
      expect(checked.reason).toContain("fingerprint");
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
