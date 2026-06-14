import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
});
