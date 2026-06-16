import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const repoRoot = process.cwd();
const createBin = join(repoRoot, "packages", "create-forge-app", "bin", "create-forge-app.mjs");
const forgeBin = join(repoRoot, "bin", "forge.mjs");

function runCreate(args: string[], cwd: string) {
  return spawnSync("node", [createBin, ...args], {
    cwd,
    env: {
      ...process.env,
      CREATE_FORGE_APP_FORGE_BIN: forgeBin,
    },
    encoding: "utf8",
    windowsHide: true,
  });
}

describe("create-forge-app", () => {
  test("package metadata exposes npm create bins", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "packages", "create-forge-app", "package.json"), "utf8"),
    ) as {
      name?: string;
      bin?: Record<string, string>;
      publishConfig?: Record<string, unknown>;
    };

    expect(pkg.name).toBe("create-forgeos-app");
    expect(pkg.bin?.["create-forgeos-app"]).toBe("bin/create-forge-app.mjs");
    expect(pkg.bin?.["create-forge-app"]).toBe("bin/create-forge-app.mjs");
    expect(pkg.bin?.["forgeos-app"]).toBe("bin/create-forge-app.mjs");
    expect(pkg.bin?.["forge-app"]).toBe("bin/create-forge-app.mjs");
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.publishConfig?.tag).toBe("alpha");
  });

  test("prints help", () => {
    const result = runCreate(["--help"], repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("npm create forgeos-app@alpha <app-name>");
    expect(result.stdout).toContain("--template minimal-web");
  });

  test("creates a minimal npm app with public ForgeOS alias defaults", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "create-forge-app-test-"));
    try {
      const result = runCreate(["notes-app", "--no-install", "--no-git"], tempRoot);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Created notes-app from template minimal-web.");

      const pkg = JSON.parse(
        readFileSync(join(tempRoot, "notes-app", "package.json"), "utf8"),
      ) as {
        packageManager?: string;
        dependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };

      expect(pkg.packageManager?.startsWith("npm@")).toBe(true);
      expect(pkg.dependencies?.forge).toBe("npm:forgeos@alpha");
      expect(pkg.scripts?.dev).toBe("forge dev");
      expect(readFileSync(join(tempRoot, "notes-app", "README.md"), "utf8")).toContain(
        "npm run dev",
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
