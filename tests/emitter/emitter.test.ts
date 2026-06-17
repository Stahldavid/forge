import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emit } from "../../src/forge/compiler/emitter/emit.ts";
import { render } from "../../src/forge/compiler/emitter/render.ts";
import { serializeForgeLock } from "../../src/forge/compiler/emitter/lock.ts";
import { buildBarrelIndexBody } from "../../src/forge/compiler/emitter/barrel.ts";
import { writeFileAtomic } from "../../src/forge/compiler/emitter/write.ts";
import {
  FORGE_DRIFT,
  FORGE_ORPHANED_GENERATED_FILE,
} from "../../src/forge/compiler/diagnostics/codes.ts";
import {
  hashStable,
  stripDeterministicHeader,
} from "../../src/forge/compiler/primitives/index.ts";
import {
  BARREL_INDEX_PATH,
  FORGE_LOCK_PATH,
  GENERATED_DIR,
} from "../../src/forge/compiler/emitter/constants.ts";
import {
  cleanupWorkspace,
  makeSampleEmitPlan,
  tempWorkspace,
} from "./helpers.ts";

const GOLDEN_DIR = join(import.meta.dir, "fixtures", "golden");

function readGolden(name: string, generatorVersion: string): string {
  return readFileSync(join(GOLDEN_DIR, name), "utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("__GENERATOR_VERSION__", generatorVersion);
}

describe("Deterministic Emitter", () => {
  test("golden byte-compare for rendered artifacts", () => {
    const plan = makeSampleEmitPlan();
    const context = {
      generatorVersion: plan.lock.generatorVersion,
      inputHash: plan.lock.inputHash,
    };

    expect(render(plan.files[0]!, context)).toBe(
      readGolden("appGraph.ts", context.generatorVersion),
    );
    expect(render(plan.files[1]!, context)).toBe(
      readGolden("appGraph.json", context.generatorVersion),
    );
    expect(render(plan.files[2]!, context)).toBe(
      readGolden("packageGraph.ts", context.generatorVersion),
    );
    expect(render(plan.files[3]!, context)).toBe(
      readGolden("packageGraph.json", context.generatorVersion),
    );

    const barrelBody = buildBarrelIndexBody(plan.files.map((file) => file.path));
    const barrelFile = {
      path: BARREL_INDEX_PATH,
      content: barrelBody,
      contentHash: hashStable(barrelBody),
    };
    expect(render(barrelFile, context)).toBe(
      readGolden("index.ts", context.generatorVersion),
    );
    expect(serializeForgeLock(plan.lock)).toBe(
      readGolden("forge.lock", context.generatorVersion),
    );
  });

  test("write mode writes only changed files and forge.lock last", async () => {
    const workspace = tempWorkspace("write");
    const plan = makeSampleEmitPlan();

    try {
      const first = await emit(plan, { workspaceRoot: workspace, mode: "write" });
      expect(first.exitCode).toBe(0);
      expect(first.changed.length).toBeGreaterThan(0);
      expect(first.changed[first.changed.length - 1]).toBe(FORGE_LOCK_PATH);

      const second = await emit(plan, { workspaceRoot: workspace, mode: "write" });
      expect(second.exitCode).toBe(0);
      expect(second.changed).toEqual([]);
      expect(second.unchanged.length).toBeGreaterThan(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("check mode reports drift without writing", async () => {
    const workspace = tempWorkspace("check");
    const plan = makeSampleEmitPlan();

    try {
      const initial = await emit(plan, { workspaceRoot: workspace, mode: "write" });
      expect(initial.exitCode).toBe(0);

      const appGraphPath = join(workspace, GENERATED_DIR, "appGraph.ts");
      const current = readFileSync(appGraphPath, "utf8");
      writeFileSync(
        appGraphPath,
        `${stripDeterministicHeader(current)}// drift\n`,
        "utf8",
      );

      const checked = await emit(plan, { workspaceRoot: workspace, mode: "check" });
      expect(checked.exitCode).toBe(1);
      expect(checked.changed).toContain(`${GENERATED_DIR}/appGraph.ts`);
      expect(checked.warnings.some((d) => d.code === FORGE_DRIFT)).toBe(true);

      const lockMtimeBefore = readFileSync(join(workspace, FORGE_LOCK_PATH), "utf8");
      const checkedAgain = await emit(plan, { workspaceRoot: workspace, mode: "check" });
      const lockMtimeAfter = readFileSync(join(workspace, FORGE_LOCK_PATH), "utf8");
      expect(lockMtimeBefore).toBe(lockMtimeAfter);
      expect(checkedAgain.changed.length).toBeGreaterThan(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("dry-run reports would-change paths without writing", async () => {
    const workspace = tempWorkspace("dry-run");
    const plan = makeSampleEmitPlan();

    try {
      const dry = await emit(plan, { workspaceRoot: workspace, mode: "dry-run" });
      expect(dry.exitCode).toBe(0);
      expect(dry.wouldChange.length).toBeGreaterThan(0);
      expect(dry.changed.length).toBeGreaterThan(0);

      const generatedDir = join(workspace, GENERATED_DIR);
      expect(() => readFileSync(join(generatedDir, "appGraph.ts"))).toThrow();
      expect(() => readFileSync(join(workspace, FORGE_LOCK_PATH))).toThrow();
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("write mode removes orphaned generated files", async () => {
    const workspace = tempWorkspace("orphan-write");
    const plan = makeSampleEmitPlan();
    const orphanPath = join(workspace, GENERATED_DIR, "stale.ts");

    try {
      mkdirSync(join(workspace, GENERATED_DIR), { recursive: true });
      writeFileSync(orphanPath, "export const stale = true;\n", "utf8");

      const planWithOrphan = {
        ...plan,
        orphanedFiles: [`${GENERATED_DIR}/stale.ts`],
      };

      const result = await emit(planWithOrphan, {
        workspaceRoot: workspace,
        mode: "write",
      });
      expect(result.exitCode).toBe(0);
      expect(result.removed).toContain(`${GENERATED_DIR}/stale.ts`);
      expect(() => readFileSync(orphanPath)).toThrow();
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("check mode reports orphaned generated files as errors", async () => {
    const workspace = tempWorkspace("orphan-check");
    const plan = makeSampleEmitPlan();

    try {
      await emit(plan, { workspaceRoot: workspace, mode: "write" });

      const orphanPath = join(workspace, GENERATED_DIR, "stale.ts");
      writeFileSync(orphanPath, "export const stale = true;\n", "utf8");

      const checked = await emit(
        { ...plan, orphanedFiles: [`${GENERATED_DIR}/stale.ts`] },
        { workspaceRoot: workspace, mode: "check" },
      );

      expect(checked.exitCode).toBe(1);
      expect(
        checked.errors.some((d) => d.code === FORGE_ORPHANED_GENERATED_FILE),
      ).toBe(true);
      expect(readFileSync(orphanPath, "utf8")).toContain("stale");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("atomic write uses temp file then rename", async () => {
    const workspace = tempWorkspace("atomic");
    const target = join(workspace, GENERATED_DIR, "atomic.ts");
    const content = "// @forge-generated generator=0.0.0 input=abc content=def\nexport const ok = true;\n";

    try {
      await writeFileAtomic(target, content);
      expect(readFileSync(target, "utf8")).toBe(content);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("write failure emits error and leaves prior content unchanged", async () => {
    const workspace = tempWorkspace("write-fail");
    const plan = makeSampleEmitPlan();

    try {
      const initial = await emit(plan, { workspaceRoot: workspace, mode: "write" });
      expect(initial.exitCode).toBe(0);

      const blockedPath = join(workspace, GENERATED_DIR, "appGraph.ts");
      const priorLock = readFileSync(join(workspace, FORGE_LOCK_PATH), "utf8");
      rmSync(blockedPath, { force: true });
      mkdirSync(blockedPath, { recursive: true });

      const failed = await emit(plan, { workspaceRoot: workspace, mode: "write" });
      expect(failed.exitCode).toBe(1);
      expect(failed.errors.some((d) => d.code === "FORGE_WRITE_ERROR")).toBe(true);
      expect(readFileSync(join(workspace, FORGE_LOCK_PATH), "utf8")).toBe(priorLock);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
