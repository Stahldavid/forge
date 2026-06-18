import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";
import { runNodeForgeUntilOutput } from "./node-compat-helpers.ts";
import { cleanupWorkspace, defaultGenerateOptions, tempWorkspace } from "../orchestrator/helpers.ts";

function scaffoldNodeDevWorkspace(prefix: string): string {
  const workspace = tempWorkspace(prefix);
  writeFileSync(
    join(workspace, "package.json"),
    JSON.stringify(
      {
        name: "forge-node-dev-test",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(workspace, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
    "utf8",
  );
  mkdirSync(join(workspace, "src", "forge"), { recursive: true });
  writeFileSync(join(workspace, "src", "forge", "schema.ts"), "\n", "utf8");
  return workspace;
}

describe("Node-compatible CLI dev server", () => {
  test("node bin keeps dev api server alive for generated apps", async () => {
    const workspace = scaffoldNodeDevWorkspace("node-compat-dev-server");
    try {
      const generated = await runGenerateCommand(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const dev = await runNodeForgeUntilOutput([
        "dev",
        "--api-only",
        "--db",
        "none",
        "--no-worker",
        "--skip-startup-console",
        "--port",
        "0",
        "--no-watch",
      ], {
        cwd: workspace,
        match: "API runtime",
        timeoutMs: 60_000,
      });

      expect(`${dev.stdout}\n${dev.stderr}`).toContain("API runtime");
      expect(dev.matched).toBe(true);
      expect(dev.timedOut).toBe(false);
      expect(`${dev.stdout}\n${dev.stderr}`).not.toContain("tsx-namespace");
      expect(`${dev.stdout}\n${dev.stderr}`).not.toContain("ENOENT");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 90_000);
});
