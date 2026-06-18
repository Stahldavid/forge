import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runNodeForge } from "./node-compat-helpers.ts";

describe("Node-compatible CLI template scaffolding", () => {
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
