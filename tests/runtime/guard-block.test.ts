import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORGE_GUARD_VIOLATION,
  FORGE_RUNTIME_GUARD_BLOCKED,
} from "../../src/forge/compiler/diagnostics/codes.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

const APP_GRAPH_FIXTURES = join(import.meta.dir, "..", "app-graph", "fixtures");
const PACKAGE_FIXTURES = join(import.meta.dir, "..", "fixtures", "packages");

function scaffoldGuardWorkspace(prefix: string): string {
  const workspace = tempWorkspace(prefix);

  writeFileSync(
    join(workspace, "package.json"),
    JSON.stringify(
      {
        name: "forge-runtime-guard-test",
        private: true,
        type: "module",
        dependencies: {
          stripe: "^17.0.0",
        },
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

  const srcDir = join(workspace, "src", "forge");
  mkdirSync(srcDir, { recursive: true });

  writeFileSync(
    join(srcDir, "guard-stripe-helper.ts"),
    readFileSync(join(APP_GRAPH_FIXTURES, "guard-stripe-helper.ts"), "utf8"),
    "utf8",
  );
  writeFileSync(
    join(srcDir, "guard-command-chain.ts"),
    readFileSync(join(APP_GRAPH_FIXTURES, "guard-command-chain.ts"), "utf8"),
    "utf8",
  );

  cpSync(PACKAGE_FIXTURES, join(workspace, "node_modules"), {
    recursive: true,
    force: true,
  });

  return workspace;
}

describe("runtime guard preflight", () => {
  test("blocks command with transitive stripe import", async () => {
    const workspace = scaffoldGuardWorkspace("runtime-guard-block");
    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const executed = await runEntry(workspace, "charge", {
        json: false,
        mock: false,
      });

      expect(executed.exitCode).toBe(1);
      expect(executed.ok).toBe(false);
      expect(
        executed.diagnostics.some(
          (diagnostic) => diagnostic.code === FORGE_RUNTIME_GUARD_BLOCKED,
        ),
      ).toBe(true);
      expect(
        executed.diagnostics.some(
          (diagnostic) => diagnostic.code === FORGE_GUARD_VIOLATION,
        ),
      ).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
