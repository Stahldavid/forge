import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  FORGE_GUARD_VIOLATION,
  FORGE_RUNTIME_GUARD_BLOCKED,
} from "../../src/forge/compiler/diagnostics/codes.ts";
import { runCheckCommand } from "../../src/forge/cli/commands.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";

const EXAMPLE_ROOT = join(import.meta.dir, "..", "..", "examples", "basic-forge-app");
const REPO_ROOT = join(import.meta.dir, "..", "..");

async function setupExample(): Promise<void> {
  const setupScript = join(REPO_ROOT, "scripts", "setup-example.mjs");
  const proc = Bun.spawn(["node", setupScript], {
    cwd: EXAMPLE_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
}

describe("examples/basic-forge-app", () => {
  test("generate, check guards, and run commands locally", async () => {
    await setupExample();

    const generated = await run({
      workspaceRoot: EXAMPLE_ROOT,
      check: false,
      dryRun: false,
      json: false,
      concurrency: 2,
    });
    expect(generated.exitCode).toBe(0);

    const checked = await runCheckCommand(EXAMPLE_ROOT);
    expect(checked.exitCode).toBe(1);
    expect(
      checked.errors.some((error) => error.code === FORGE_GUARD_VIOLATION),
    ).toBe(true);
    expect(
      checked.errors.some(
        (error) =>
          error.file?.includes("badStripeCommand.ts") ||
          error.file?.includes("stripeClient.ts"),
      ),
    ).toBe(true);

    const createTicket = await runEntry(EXAMPLE_ROOT, "createTicket", {
      json: false,
      mock: false,
    });
    expect(createTicket.exitCode).toBe(0);
    expect(createTicket.ok).toBe(true);

    const badStripe = await runEntry(EXAMPLE_ROOT, "badStripeCommand", {
      json: false,
      mock: false,
    });
    expect(badStripe.exitCode).toBe(1);
    expect(
      badStripe.diagnostics.some(
        (diagnostic) => diagnostic.code === FORGE_RUNTIME_GUARD_BLOCKED,
      ),
    ).toBe(true);

    const drift = await run({
      workspaceRoot: EXAMPLE_ROOT,
      check: true,
      dryRun: false,
      json: false,
      concurrency: 2,
    });
    expect(drift.exitCode).toBe(0);

    expect(existsSync(join(EXAMPLE_ROOT, "forge.lock"))).toBe(true);
    expect(
      existsSync(join(EXAMPLE_ROOT, "src", "forge", "_generated", "importGuards.json")),
    ).toBe(true);
    expect(
      existsSync(join(EXAMPLE_ROOT, "src", "forge", "_generated", "runtimeGraph.json")),
    ).toBe(true);

    const devServer = await startDevServer({
      workspaceRoot: EXAMPLE_ROOT,
      host: "127.0.0.1",
      port: 0,
      mock: false,
      json: false,
    });

    try {
      const invoke = await fetch(`${devServer.url}/run/createTicket`, {
        method: "POST",
      });
      expect(invoke.status).toBe(200);
      const body = (await invoke.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      devServer.stop();
    }
  }, 60_000);
});
