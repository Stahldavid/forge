import { describe, expect, test } from "bun:test";
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
});
