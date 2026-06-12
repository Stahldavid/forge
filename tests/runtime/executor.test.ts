import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { FORGE_DB_ADAPTER_UNAVAILABLE } from "../../src/forge/compiler/diagnostics/codes.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("runtime executor", () => {
  test("runs a simple command from generated runtime graph", async () => {
    const workspace = scaffoldGenerateWorkspace("runtime-executor");
    try {
      const result = await run(defaultGenerateOptions(workspace));
      expect(result.exitCode).toBe(0);

      const executed = await runEntry(workspace, "charge", {
        json: false,
        mock: false,
      });

      expect(executed.exitCode).toBe(0);
      expect(executed.ok).toBe(true);
      expect(executed.result).toEqual({ ok: true });
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("returns a database hint for DB-backed commands without an adapter", async () => {
    const workspace = scaffoldGenerateWorkspace("runtime-executor-db-hint");
    try {
      writeFileSync(
        join(workspace, "src", "forge", "db-command.ts"),
        [
          'import { command } from "forge/server";',
          "",
          "export const createUser = command({",
          "  handler: async (ctx) => ctx.db.users.insert({ id: 'u1' }),",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await run(defaultGenerateOptions(workspace));
      expect(result.exitCode).toBe(0);

      const executed = await runEntry(workspace, "createUser", {
        json: false,
        mock: false,
        db: null,
      });

      expect(executed.exitCode).toBe(1);
      expect(executed.ok).toBe(false);
      const diagnostic = executed.diagnostics.find(
        (candidate) => candidate.code === FORGE_DB_ADAPTER_UNAVAILABLE,
      );
      expect(diagnostic?.fixHint).toContain("forge dev");
      expect(diagnostic?.suggestedCommands).toContain("forge dev");
      expect(diagnostic?.suggestedCommands).toContain("forge dev --once --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
