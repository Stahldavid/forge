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
  }, 30_000);

  test("node bin emits structured json for forge new --json", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-node-new-json-"));
    try {
      const result = await runNodeForge([
        "new",
        "json-app",
        "--template",
        "minimal-web",
        "--package-manager",
        "npm",
        "--no-install",
        "--no-git",
        "--json",
      ], { cwd: workspace });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trimStart()).toStartWith("{");
      expect(result.stdout).not.toContain("Next steps:");
      const payload = JSON.parse(result.stdout) as {
        schemaVersion?: string;
        ok?: boolean;
        name?: string;
        template?: string;
        packageManager?: string;
        exitCode?: number;
        nextSteps?: string[];
      };
      expect(payload).toMatchObject({
        schemaVersion: "0.1.0",
        ok: true,
        name: "json-app",
        template: "minimal-web",
        packageManager: "npm",
        exitCode: 0,
      });
      expect(payload.nextSteps).toContain("npm install");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 30_000);
});
