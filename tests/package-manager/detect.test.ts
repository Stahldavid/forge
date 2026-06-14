import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectPackageManager,
  detectPackageManagerFromLockfiles,
  getLockfileForPm,
  parsePackageManagerField,
} from "../../src/forge/compiler/package-manager/detect.ts";

const tempRoots: string[] = [];

function makeTempWorkspace(): string {
  const dir = join(tmpdir(), `forge-pm-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("parsePackageManagerField", () => {
  test("parses bun/npm/pnpm/yarn with version suffix", () => {
    expect(parsePackageManagerField("npm@10.2.0")).toBe("npm");
    expect(parsePackageManagerField("pnpm@9.0.0")).toBe("pnpm");
    expect(parsePackageManagerField("yarn@4.0.0")).toBe("yarn");
    expect(parsePackageManagerField("bun@1.1.0")).toBe("bun");
  });

  test("returns null for unknown values", () => {
    expect(parsePackageManagerField("deno@1.0.0")).toBeNull();
    expect(parsePackageManagerField("")).toBeNull();
  });
});

describe("detectPackageManagerFromLockfiles", () => {
  test("detects npm from package-lock.json", () => {
    const root = makeTempWorkspace();
    writeFileSync(join(root, "package-lock.json"), "{}", "utf8");
    expect(detectPackageManagerFromLockfiles(root)).toBe("npm");
  });

  test("detects pnpm from pnpm-lock.yaml", () => {
    const root = makeTempWorkspace();
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 6\n", "utf8");
    expect(detectPackageManagerFromLockfiles(root)).toBe("pnpm");
  });

  test("detects yarn from yarn.lock", () => {
    const root = makeTempWorkspace();
    writeFileSync(join(root, "yarn.lock"), "# yarn lockfile\n", "utf8");
    expect(detectPackageManagerFromLockfiles(root)).toBe("yarn");
  });

  test("detects bun from bun.lockb before bun.lock", () => {
    const root = makeTempWorkspace();
    writeFileSync(join(root, "bun.lockb"), "binary", "utf8");
    writeFileSync(join(root, "package-lock.json"), "{}", "utf8");
    expect(detectPackageManagerFromLockfiles(root)).toBe("bun");
  });

  test("returns null when no lockfile exists", () => {
    const root = makeTempWorkspace();
    expect(detectPackageManagerFromLockfiles(root)).toBeNull();
  });
});

describe("detectPackageManager", () => {
  test("prefers packageManager field over lockfile", () => {
    const root = makeTempWorkspace();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ packageManager: "pnpm@9.0.0" }),
      "utf8",
    );
    writeFileSync(join(root, "yarn.lock"), "# yarn\n", "utf8");
    expect(detectPackageManager(root)).toBe("pnpm");
  });

  test("falls back to lockfile when packageManager is absent", () => {
    const root = makeTempWorkspace();
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x" }), "utf8");
    writeFileSync(join(root, "yarn.lock"), "# yarn\n", "utf8");
    expect(detectPackageManager(root)).toBe("yarn");
  });

  test("defaults to npm when nothing matches", () => {
    const root = makeTempWorkspace();
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x" }), "utf8");
    expect(detectPackageManager(root)).toBe("npm");
  });
});

describe("getLockfileForPm", () => {
  test("maps each package manager to its lockfile name", () => {
    expect(getLockfileForPm("npm")).toBe("package-lock.json");
    expect(getLockfileForPm("pnpm")).toBe("pnpm-lock.yaml");
    expect(getLockfileForPm("yarn")).toBe("yarn.lock");
    expect(getLockfileForPm("bun")).toBe("bun.lock");
  });
});
