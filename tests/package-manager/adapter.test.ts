import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createPackageManagerAdapter,
  parsePackageName,
  readInstalledVersion,
} from "../../src/forge/compiler/package-manager/index.ts";
import type {
  CommandExecutor,
  CommandRunResult,
} from "../../src/forge/compiler/package-manager/executor.ts";
import { resolvePackageManagerArgv } from "../../src/forge/compiler/package-manager/executor.ts";

const tempRoots: string[] = [];

function makeTempWorkspace(): string {
  const dir = join(
    tmpdir(),
    `forge-pm-adapter-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
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

function seedInstalledPackage(
  cwd: string,
  name: string,
  version: string,
): void {
  const segments = name.startsWith("@") ? name.slice(1).split("/") : [name];
  const pkgDir = join(cwd, "node_modules", ...segments);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, version }),
    "utf8",
  );
}

describe("parsePackageName", () => {
  test("parses scoped and unscoped specs", () => {
    expect(parsePackageName("lodash@4.17.21")).toBe("lodash");
    expect(parsePackageName("@scope/pkg@1.0.0")).toBe("@scope/pkg");
    expect(parsePackageName("zod")).toBe("zod");
  });
});

describe("readInstalledVersion", () => {
  test("reads version from node_modules", () => {
    const root = makeTempWorkspace();
    seedInstalledPackage(root, "zod", "3.24.1");
    expect(readInstalledVersion("zod", root)).toBe("3.24.1");
    expect(readInstalledVersion("zod@^3", root)).toBe("3.24.1");
  });

  test("returns null when package is missing", () => {
    const root = makeTempWorkspace();
    expect(readInstalledVersion("missing-pkg", root)).toBeNull();
  });
});

describe("PackageManagerAdapter with mock executor", () => {
  test("default executor resolution ignores extensionless Windows bun PATH entries", () => {
    const kiroShim = "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolvePackageManagerArgv(["bun", "add", "zod"], {
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => kiroShim,
    });

    expect(resolved).toEqual([realBun, "add", "zod"]);
  });

  test("default executor resolution ignores Kiro-Cli bun.exe PATH entries", () => {
    const kiroExe = "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun.exe";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolvePackageManagerArgv(["bun", "install"], {
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun || path === kiroExe,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => kiroExe,
    });

    expect(resolved).toEqual([realBun, "install"]);
  });

  test("add runs PM command with ignoreScripts default true", async () => {
    const root = makeTempWorkspace();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "test-ws", version: "0.0.0" }),
      "utf8",
    );

    const calls: { argv: string[]; cwd: string }[] = [];
    const executor: CommandExecutor = {
      async run(argv, options) {
        calls.push({ argv: [...argv], cwd: options.cwd });
        seedInstalledPackage(options.cwd, "zod", "3.24.1");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const adapter = createPackageManagerAdapter("npm", { executor });
    const result = await adapter.add("zod@^3", { cwd: root, ignoreScripts: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cwd).toBe(root);
    expect(calls[0]?.argv).toContain("--ignore-scripts");
    expect(result.resolvedVersion).toBe("3.24.1");
  });

  test("add omits --ignore-scripts when allow-scripts opt-in", async () => {
    const root = makeTempWorkspace();
    writeFileSync(join(root, "package.json"), "{}", "utf8");

    let capturedArgv: string[] = [];
    const executor: CommandExecutor = {
      async run(argv) {
        capturedArgv = [...argv];
        seedInstalledPackage(root, "zod", "3.0.0");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const adapter = createPackageManagerAdapter("pnpm", { executor });
    await adapter.add("zod", { cwd: root, ignoreScripts: false });

    expect(capturedArgv).not.toContain("--ignore-scripts");
  });

  test("detectResolvedVersion returns installed version", async () => {
    const root = makeTempWorkspace();
    seedInstalledPackage(root, "stripe", "14.0.0");

    const adapter = createPackageManagerAdapter("npm");
    await expect(adapter.detectResolvedVersion("stripe", root)).resolves.toBe(
      "14.0.0",
    );
  });

  test("dryRunAdd installs in temp dir without modifying workspace", async () => {
    const root = makeTempWorkspace();
    const workspacePkg = { name: "workspace", version: "1.0.0", dependencies: {} };
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify(workspacePkg, null, 2),
      "utf8",
    );

    let capturedArgv: string[] = [];
    const executor: CommandExecutor = {
      async run(argv, options) {
        capturedArgv = [...argv];
        expect(options.cwd).not.toBe(root);
        expect(options.cwd).toContain("dry-run");
        seedInstalledPackage(options.cwd, "zod", "3.24.1");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const adapter = createPackageManagerAdapter("bun", { executor });
    const result = await adapter.dryRunAdd("zod@^3", { cwd: root, ignoreScripts: true });

    expect(capturedArgv).toContain("--ignore-scripts");
    expect(result.resolvedVersion).toBe("3.24.1");
    expect(result.lockfileChanged).toBe(false);

    const workspaceAfter = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as typeof workspacePkg;
    expect(workspaceAfter).toEqual(workspacePkg);
    expect(existsSync(join(root, "node_modules", "zod"))).toBe(false);
  });

  test("add throws PackageManagerCommandError on non-zero exit", async () => {
    const root = makeTempWorkspace();
    writeFileSync(join(root, "package.json"), "{}", "utf8");

    const failingResult: CommandRunResult = {
      exitCode: 1,
      stdout: "",
      stderr: "install failed",
    };
    const executor: CommandExecutor = {
      async run() {
        return failingResult;
      },
    };

    const adapter = createPackageManagerAdapter("npm", { executor });
    await expect(
      adapter.add("nonexistent-pkg", { cwd: root, ignoreScripts: true }),
    ).rejects.toMatchObject({ exitCode: 1 });
  });
});
