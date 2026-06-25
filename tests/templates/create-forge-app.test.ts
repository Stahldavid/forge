import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const repoRoot = process.cwd();
const createBin = join(repoRoot, "packages", "create-forge-app", "bin", "create-forge-app.mjs");
const forgeBin = join(repoRoot, "bin", "forge.mjs");

function runCreate(args: string[], cwd: string, env: Record<string, string> = {}) {
  return spawnSync("node", [createBin, ...args], {
    cwd,
    env: {
      ...process.env,
      CREATE_FORGE_APP_FORGE_BIN: forgeBin,
      ...env,
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
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "packages", "create-forge-app", "package.json"), "utf8"),
    ) as { version?: string };

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`create-forge-app ${pkg.version}`);
    expect(result.stdout).toContain("npm create forgeos-app@alpha <app-name>");
    expect(result.stdout).toContain("--template minimal-web");
    expect(result.stdout).toContain("--template nuxt-web");
    expect(result.stdout).toContain("--template agent-workroom");
    expect(result.stdout).toContain("--template b2b-support-web");
  });

  test("passes ForgeOS public alias defaults to forge new", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "create-forge-app-test-"));
    try {
      const capturedPath = join(tempRoot, "captured.json");
      const fakeForgeBin = join(tempRoot, "fake-forge.mjs");
      writeFileSync(
        fakeForgeBin,
        `
          import { writeFileSync } from "node:fs";
          writeFileSync(process.env.CREATE_FORGE_APP_CAPTURE, JSON.stringify(process.argv.slice(2)));
          process.exit(0);
        `,
        "utf8",
      );
      const result = runCreate(["notes-app", "--no-install", "--no-git"], tempRoot, {
        CREATE_FORGE_APP_CAPTURE: capturedPath,
        CREATE_FORGE_APP_FORGE_BIN: fakeForgeBin,
      });

      expect(result.status).toBe(0);
      const captured = JSON.parse(readFileSync(capturedPath, "utf8")) as string[];
      expect(captured).toEqual([
        "new",
        "notes-app",
        "--no-install",
        "--no-git",
        "--template",
        "minimal-web",
        "--package-manager",
        "npm",
        "--forge-spec",
        "npm:forgeos@alpha",
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
