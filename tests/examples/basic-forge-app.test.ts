import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FORGE_GUARD_VIOLATION } from "../../src/forge/compiler/diagnostics/codes.ts";

const EXAMPLE_ROOT = join(import.meta.dir, "..", "..", "examples", "basic-forge-app");
const REPO_ROOT = join(import.meta.dir, "..", "..");
const FORGE_CLI = join(REPO_ROOT, "bin", "forge-bun.mjs");
const FORGE_MAIN = join(REPO_ROOT, "src", "forge", "cli", "main.ts");

async function runExampleCli(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["node", FORGE_CLI, FORGE_MAIN, ...args], {
    cwd: EXAMPLE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const exitCode = proc.exited;

  return {
    exitCode: await exitCode,
    stdout: await stdout,
    stderr: await stderr,
  };
}

function expectSuccess(result: { exitCode: number; stdout: string; stderr: string }): void {
  expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
}

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
  test("documents Node-first scripts instead of raw Bun commands", () => {
    const pkg = JSON.parse(readFileSync(join(EXAMPLE_ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const readme = readFileSync(join(EXAMPLE_ROOT, "README.md"), "utf8");

    expect(pkg.scripts?.forge).toBe("node ../../bin/forge.mjs");
    expect(Object.values(pkg.scripts ?? {}).some((script) => script.startsWith("bun "))).toBe(false);
    expect(readme).toContain("npm run forge:generate");
    expect(readme).not.toContain("bun run");
  });

  test("generate, check guards, and smoke dev locally", async () => {
    await setupExample();

    const generated = await runExampleCli(["generate"]);
    expectSuccess(generated);

    const checked = await runExampleCli(["check", "--json"]);
    expectSuccess(checked);

    const demoCommand = join(EXAMPLE_ROOT, "src", "commands", "badStripeCommand.ts");
    writeFileSync(
      demoCommand,
      readFileSync(join(EXAMPLE_ROOT, "guard-violation-demo", "badStripeCommand.ts"), "utf8"),
      "utf8",
    );
    const guardDemo = await runExampleCli(["check", "--json"]);
    rmSync(demoCommand, { force: true });
    expect(guardDemo.exitCode).toBe(1);
    const checkedJson = JSON.parse(guardDemo.stdout) as {
      errors?: Array<{ code?: string; file?: string }>;
    };
    expect(
      checkedJson.errors?.some((error) => error.code === FORGE_GUARD_VIOLATION),
    ).toBe(true);
    expect(
      checkedJson.errors?.some(
        (error) =>
          error.file?.includes("badStripeCommand.ts") ||
          error.file?.includes("stripeClient.ts"),
      ),
    ).toBe(true);

    const drift = await runExampleCli(["generate", "--check"]);
    expectSuccess(drift);

    expect(existsSync(join(EXAMPLE_ROOT, "forge.lock"))).toBe(true);
    expect(
      existsSync(join(EXAMPLE_ROOT, "src", "forge", "_generated", "importGuards.json")),
    ).toBe(true);
    expect(
      existsSync(join(EXAMPLE_ROOT, "src", "forge", "_generated", "runtimeGraph.json")),
    ).toBe(true);

    rmSync(join(EXAMPLE_ROOT, ".forge", "pglite"), { recursive: true, force: true });

    const dev = await runExampleCli(["dev", "--once", "--json", "--db", "pglite"]);
    expect(dev.exitCode).toBe(0);
    const devJson = JSON.parse(dev.stdout) as {
      ok?: boolean;
      diagnostics?: Array<{ code?: string; file?: string }>;
    };
    expect(devJson.ok).toBe(true);
    expect(devJson.diagnostics?.some((diagnostic) => diagnostic.code === FORGE_GUARD_VIOLATION)).toBe(false);
  }, 120_000);
});
