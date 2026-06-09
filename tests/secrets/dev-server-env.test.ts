import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDevServer, resolveDevPort, resolveDevHost } from "../../src/forge/dev/server.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("dev server env", () => {
  test("/health includes env loadedFiles and missingRequiredSecrets", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-server-env");
    writeFileSync(
      join(workspace, "package.json"),
      JSON.stringify({ name: "x", dependencies: { stripe: "17.0.0" } }),
      "utf8",
    );
    writeFileSync(join(workspace, ".env.local"), "STRIPE_SECRET_KEY=sk_test\n", "utf8");

    try {
      await run(defaultGenerateOptions(workspace));

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: resolveDevHost("127.0.0.1"),
        port: resolveDevPort(0),
        mock: true,
        json: false,
        db: "none",
        worker: false,
        telemetry: ["local"],
      });

      const response = await fetch(`${handle.url}/health`);
      const body = (await response.json()) as {
        env?: { loadedFiles: string[]; missingRequiredSecrets: number };
      };

      expect(body.env?.loadedFiles).toContain(".env.local");
      expect(typeof body.env?.missingRequiredSecrets).toBe("number");

      handle.stop();
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
