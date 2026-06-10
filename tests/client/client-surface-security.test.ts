import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { runInspectCommand } from "../../src/forge/cli/commands.ts";
import { cleanupWorkspace, scaffoldClientWorkspace } from "./helpers.ts";

describe("client surface security", () => {
  test("client manifest excludes server-only adapters and packages", async () => {
    const { root } = await scaffoldClientWorkspace("client-security");
    try {
      const manifest = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "clientManifest.json"), "utf8"),
        ),
      ) as {
        queries: string[];
        commands: string[];
        liveQueries: string[];
        excluded: {
          actions: string[];
          workflows: string[];
          serverAdapters: string[];
          serverPackages: string[];
        };
      };

      expect(manifest.queries).toContain("listTickets");
      expect(manifest.commands).toContain("createTicket");
      expect(manifest.liveQueries).toEqual(["watchUser"]);

      const clientTs = readFileSync(join(root, GENERATED_DIR, "client.ts"), "utf8");
      const clientTypes = readFileSync(join(root, GENERATED_DIR, "clientTypes.ts"), "utf8");

      for (const forbidden of [
        "stripe.server",
        "posthog.server",
        "sentry.server",
        "ai.server",
        "ctx.secrets",
        "secretRegistry",
      ]) {
        expect(clientTs).not.toContain(forbidden);
        expect(clientTypes).not.toContain(forbidden);
      }

      expect(manifest.excluded.actions.length).toBeGreaterThanOrEqual(0);
      expect(manifest.excluded.workflows.length).toBeGreaterThanOrEqual(0);
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("forge inspect client --json lists client surface", async () => {
    const { root } = await scaffoldClientWorkspace("client-inspect");
    try {
      const previousCwd = process.cwd();
      try {
        process.chdir(root);

        const result = await runInspectCommand("client", root);
        expect(result.exitCode).toBe(0);
        expect(result.data).toMatchObject({
          queries: expect.arrayContaining(["listTickets", "getTicket"]),
          commands: expect.arrayContaining(["createTicket", "manageBilling"]),
          liveQueries: ["watchUser"],
        });
      } finally {
        process.chdir(previousCwd);
      }
    } finally {
      cleanupWorkspace(root);
    }
  });
});
