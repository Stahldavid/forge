import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const script = resolve("scripts/smoke-packed-package.mjs");
const { cleanupOwnedSmokeTemp } = await import(pathToFileURL(script).href);

test("packed smoke stops its owned broker before deletion and retries transient locks", async () => {
  const root = mkdtempSync(join(tmpdir(), "forgeos-pack-smoke-"));
  const app = join(root, "smoke-app"); mkdirSync(app);
  const calls: string[] = [];
  try {
    await cleanupOwnedSmokeTemp(root, {
      shutdown: async (path: string) => { expect([root, app]).toContain(path); calls.push(path === root ? "stop-parent" : "stop-app"); },
      remove: (path: string) => {
        expect(path).toBe(root); calls.push("remove");
        if (calls.length === 3) throw Object.assign(new Error("locked"), { code: "EPERM" });
        rmSync(path, { recursive: true, force: true });
      },
      sleep: async () => { calls.push("wait"); },
    });
    expect(calls).toEqual(["stop-parent", "stop-app", "remove", "wait", "remove"]);
    expect(existsSync(root)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("packed smoke cleanup refuses unowned paths and bounds a persistent lock", async () => {
  await expect(cleanupOwnedSmokeTemp(tmpdir())).rejects.toThrow("not an owned temporary directory");
  await expect(cleanupOwnedSmokeTemp("forgeos-pack-smoke-relative")).rejects.toThrow("not an owned temporary directory");
  const root = mkdtempSync(join(tmpdir(), "forgeos-pack-smoke-"));
  let attempts = 0;
  try {
    await expect(cleanupOwnedSmokeTemp(root, {
      shutdown: async () => {},
      remove: () => { attempts += 1; throw Object.assign(new Error("persistent lock"), { code: "EPERM" }); },
      sleep: async () => {},
    })).rejects.toThrow("persistent lock");
    expect(attempts).toBe(6);
    expect(existsSync(root)).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("packed smoke preserves primary failure and separately records cleanup failure", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-smoke-error-test-"));
  try {
    const injected = readFileSync(script, "utf8")
      .replace('assert(!(await portReachable(previewPort)), `port ${previewPort} is already in use before public smoke`);', 'throw new Error("primary-smoke-regression");')
      .replaceAll("await cleanupOwnedSmokeTemp(tempRoot);", 'throw new Error("secondary-cleanup-regression");');
    const fixtureScript = join(root, "smoke.mjs"); const report = join(root, "report.json");
    writeFileSync(fixtureScript, injected);
    const result = spawnSync(process.execPath, [fixtureScript], {
      encoding: "utf8", windowsHide: true, timeout: 10000,
      env: { ...process.env, SMOKE_PACKED_PACKAGE_DRY_RUN: "0", SMOKE_PACKED_PACKAGE_REPORT: report },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("primary-smoke-regression");
    expect(result.stderr).not.toContain("Error: secondary-cleanup-regression");
    const evidence = JSON.parse(readFileSync(report, "utf8"));
    expect(evidence).toMatchObject({ ok: false, error: "primary-smoke-regression", cleanup: { error: "secondary-cleanup-regression" } });
    expect(evidence.steps).toEqual([]);
    // The injected cleanup failure deliberately retained this exact owned path.
    if (typeof evidence.tempRoot !== "string") throw new Error("missing owned temporary path");
    // Validate it through the production helper rather than removing a computed path.
    return cleanupOwnedSmokeTemp(evidence.tempRoot);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
