import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";

async function runNodeForge(
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["node", join(process.cwd(), "bin", "forge.mjs"), ...args], {
    cwd: options.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("Node-compatible CLI", () => {
  test("root Forge scripts use the Node bootstrap by default", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.forge).toBe("node ./bin/forge.mjs");
    expect(pkg.scripts?.test).toBe("node ./bin/forge-bun.mjs test --timeout 120000");
    expect(pkg.scripts?.["forge:check"]).toBe("node ./bin/forge.mjs check");
    expect(pkg.scripts?.["forge:generate"]).toBe("node ./bin/forge.mjs generate");
    expect(pkg.scripts?.["forge:generate:check"]).toBe(
      "node ./bin/forge.mjs generate --check",
    );
    expect(pkg.scripts?.["forge:bun"]).toBe("node ./bin/forge-bun.mjs src/forge/cli/main.ts");
    expect(pkg.scripts?.verify).toBe("node ./bin/forge.mjs verify");
    expect(pkg.scripts?.lint).toBe("node --import tsx ./src/forge/cli/lint-forge.ts");
    expect(existsSync(join(process.cwd(), "bin", "forge-bun.mjs"))).toBe(true);
  });

  test("node bin can inspect framework context", async () => {
    const result = await runNodeForge(["inspect", "framework", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).data.project.type).toBe("forgeos-framework");
  });

  test("node bin scaffolds npm template apps without Bun", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-node-compat-"));
    try {
      const result = await runNodeForge([
        "new",
        "node-app",
        "--template",
        "minimal-web",
        "--package-manager",
        "npm",
        "--no-install",
        "--no-git",
      ], { cwd: workspace });

      expect(result.exitCode).toBe(0);
      const pkg = JSON.parse(
        readFileSync(join(workspace, "node-app", "package.json"), "utf8"),
      ) as { packageManager?: string; scripts?: Record<string, string> };
      expect(pkg.packageManager?.startsWith("npm@")).toBe(true);
      expect(pkg.scripts?.dev).toBe("forge dev");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("node bin keeps dev api server alive for generated apps", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-node-dev-"));
    try {
      const created = await runNodeForge([
        "new",
        "support-app",
        "--template",
        "b2b-support-web",
        "--package-manager",
        "npm",
        "--no-install",
        "--no-git",
      ], { cwd: workspace });
      expect(created.exitCode).toBe(0);

      const appRoot = join(workspace, "support-app");
      const generated = await runNodeForge(["generate"], { cwd: appRoot });
      expect(generated.exitCode).toBe(0);

      const dev = spawnSync(
        "node",
        [
          join(process.cwd(), "bin", "forge.mjs"),
          "dev",
          "--api-only",
          "--port",
          "0",
          "--no-watch",
        ],
        {
          cwd: appRoot,
          encoding: "utf8",
          timeout: 45_000,
          windowsHide: true,
        },
      );

      expect(`${dev.stdout}\n${dev.stderr}`).toContain("API runtime");
      expect(`${dev.stdout}\n${dev.stderr}`).not.toContain("tsx-namespace");
      expect(`${dev.stdout}\n${dev.stderr}`).not.toContain("ENOENT");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 90_000);
});
