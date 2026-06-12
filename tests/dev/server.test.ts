import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("dev server", () => {
  test("serves health, entries, and invoke routes", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-server");
    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        db: "none",
      });

      try {
        const home = await fetch(`${handle.url}/`, {
          headers: { Accept: "text/html" },
        });
        expect(home.status).toBe(200);
        expect(await home.text()).toContain("Forge Dev");

        const health = await fetch(`${handle.url}/health`);
        expect(health.status).toBe(200);
        const healthBody = (await health.json()) as {
          ok: boolean;
          service: string;
          entries: number;
        };
        expect(healthBody.ok).toBe(true);
        expect(healthBody.service).toBe("forge-dev");
        expect(healthBody.entries).toBeGreaterThan(0);

        const entries = await fetch(`${handle.url}/entries`);
        expect(entries.status).toBe(200);
        const entriesBody = (await entries.json()) as {
          ok: boolean;
          entries: { name: string }[];
        };
        expect(entriesBody.ok).toBe(true);
        expect(entriesBody.entries.some((entry) => entry.name === "charge")).toBe(
          true,
        );

        const getCommand = await fetch(`${handle.url}/commands/charge`);
        expect(getCommand.status).toBe(405);
        const getCommandBody = (await getCommand.json()) as {
          example: { method: string; path: string };
        };
        expect(getCommandBody.example).toMatchObject({
          method: "POST",
          path: "/commands/charge",
        });

        const invoke = await fetch(`${handle.url}/run/charge`, {
          method: "POST",
        });
        expect(invoke.status).toBe(200);
        const invokeBody = (await invoke.json()) as {
          ok: boolean;
          result: { ok: boolean };
        };
        expect(invokeBody.ok).toBe(true);
        expect(invokeBody.result).toEqual({ ok: true });
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("surfaces runtime import failures in request diagnostics", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-server-runtime-error");
    try {
      writeFileSync(
        join(workspace, "src", "forge", "bad-import.ts"),
        [
          'import { command } from "forge/server";',
          "",
          'throw "visible import failure";',
          "",
          "export const badImport = command(async () => ({ ok: true }));",
          "",
        ].join("\n"),
        "utf8",
      );

      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        db: "none",
      });

      try {
        const invoke = await fetch(`${handle.url}/commands/badImport`, {
          method: "POST",
        });
        expect(invoke.status).toBe(500);
        const body = (await invoke.json()) as {
          diagnostics: Array<{ message: string }>;
        };
        expect(body.diagnostics[0]?.message).toContain("visible import failure");
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
