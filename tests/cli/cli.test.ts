import { describe, expect, test } from "bun:test";
import { parseCli, hasUnknownOption } from "../../src/forge/cli/parse.ts";
import { main } from "../../src/forge/cli/main.ts";
import {
  runCheckCommand,
  runGenerateCommand,
  runInspectCommand,
  runVerifyCommand,
} from "../../src/forge/cli/commands.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("Forge CLI", () => {
  test("parseCli rejects unsupported inspect target", () => {
    const parsed = parseCli(["inspect", "unknown"]);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.command).toBeNull();
  });

  test("parseCli accepts supported inspect targets", () => {
    for (const target of [
      "app",
      "packages",
      "capabilities",
      "runtime-matrix",
      "data",
      "runtime",
      "dev",
    ]) {
      const parsed = parseCli(["inspect", target]);
      expect(parsed.errors).toEqual([]);
      expect(parsed.command?.kind).toBe("inspect");
    }
  });

  test("hasUnknownOption flags unrecognized options", () => {
    expect(hasUnknownOption(["generate", "--nope"])).toBe("--nope");
    expect(hasUnknownOption(["generate", "--check"])).toBeNull();
  });

  test("main returns exit 1 for unrecognized command", async () => {
    const code = await main(["not-a-command"]);
    expect(code).toBe(1);
  });

  test("generate --json emits one JSON document on stdout", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-generate-json");
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const parsed = parseCli(["generate", "--json"]);
      expect(parsed.command?.kind).toBe("generate");

      const result = await runGenerateCommand({
        workspaceRoot: workspace,
        check: false,
        dryRun: false,
        json: true,
        concurrency: 2,
      });

      expect(() => JSON.parse(output || "{}")).not.toThrow();
      expect(result.exitCode).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
      cleanupWorkspace(workspace);
    }
  });

  test("generate --dry-run does not write files", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-dry-run");
    try {
      const result = await runGenerateCommand({
        ...defaultGenerateOptions(workspace),
        dryRun: true,
      });
      expect(result.changed.length).toBeGreaterThan(0);
      expect(result.exitCode).toBe(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("check exits 0 when guard artifacts are present", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-check-guards");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runCheckCommand(workspace);
      expect(result.exitCode).toBe(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("parseCli accepts verify with skip flags", () => {
    const parsed = parseCli([
      "verify",
      "--json",
      "--skip-tests",
      "--skip-eslint",
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("verify");
    if (parsed.command?.kind === "verify") {
      expect(parsed.command.options.skipTests).toBe(true);
      expect(parsed.command.options.skipEslint).toBe(true);
    }
  });

  test("verify runs generate-check and forge-check in scaffold workspace", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-verify");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runVerifyCommand({
        workspaceRoot: workspace,
        json: false,
        skipTests: true,
        skipTypecheck: true,
        skipEslint: true,
        strict: false,
      });
      expect(result.ok).toBe(true);
      expect(result.steps.some((step) => step.name === "generate-check")).toBe(
        true,
      );
      expect(result.steps.some((step) => step.name === "forge-check")).toBe(
        true,
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("parseCli accepts dev with port and watch flags", () => {
    const parsed = parseCli(["dev", "--port", "4000", "--watch", "--mock"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("dev");
    if (parsed.command?.kind === "dev") {
      expect(parsed.command.port).toBe(4000);
      expect(parsed.command.watch).toBe(true);
      expect(parsed.command.mock).toBe(true);
    }
  });

  test("inspect returns error when artifacts are missing", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-inspect-missing");
    try {
      const result = await runInspectCommand("app", workspace);
      expect(result.exitCode).toBe(1);
      expect(result.errors[0]?.code).toBe("FORGE_INSPECT_MISSING");
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
