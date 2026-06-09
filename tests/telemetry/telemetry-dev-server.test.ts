import { describe, expect, test } from "bun:test";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("telemetry dev server", () => {
  test("health and telemetry routes expose pending counts", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-telemetry");
    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        telemetry: ["local"],
      });

      try {
        const health = await fetch(`${handle.url}/health`);
        const healthBody = (await health.json()) as {
          telemetry: { pending: number; failed: number; sinks: string[] };
        };
        expect(healthBody.telemetry.sinks).toEqual(["local"]);

        const telemetry = await fetch(`${handle.url}/telemetry`);
        expect(telemetry.status).toBe(200);
        const telemetryBody = (await telemetry.json()) as { ok: boolean; summary: unknown };
        expect(telemetryBody.ok).toBe(true);
        expect(telemetryBody.summary).toBeTruthy();
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
