import { describe, expect, test } from "bun:test";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("ai dev server", () => {
  test("/health reports ai mode and providers", async () => {
    const workspace = scaffoldGenerateWorkspace("ai-dev");
    try {
      await run(defaultGenerateOptions(workspace));

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        mockAi: true,
        json: false,
        db: "none",
      });

      const response = await fetch(`${handle.url}/health`);
      const body = (await response.json()) as {
        ai: { enabled: boolean; mode: string; providers: unknown[] };
      };

      expect(body.ai.enabled).toBe(true);
      expect(body.ai.mode).toBe("mock");
      expect(Array.isArray(body.ai.providers)).toBe(true);

      handle.stop();
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
