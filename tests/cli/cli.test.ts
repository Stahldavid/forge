import { describe, expect, test } from "bun:test";
import { parseCli, hasUnknownOption } from "../../src/forge/cli/parse.ts";
import { main } from "../../src/forge/cli/main.ts";
import { resolveBunExecutable } from "../../src/forge/cli/bun-exec.ts";
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
      "agent-contract",
      "framework",
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

  test("resolveBunExecutable ignores extensionless Windows PATH entries", () => {
    const kiroShim = "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolveBunExecutable({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => kiroShim,
    });

    expect(resolved).toBe(realBun);
  });

  test("resolveBunExecutable ignores Kiro-Cli Windows bun executables", () => {
    const kiroExe = "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun.exe";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolveBunExecutable({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun || path === kiroExe,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => kiroExe,
    });

    expect(resolved).toBe(realBun);
  });

  test("resolveBunExecutable normalizes Windows bun shims with an exe sibling", () => {
    const bunShim = "C:\\Users\\David\\.bun\\bin\\bun";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolveBunExecutable({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      platform: "win32",
      which: () => bunShim,
    });

    expect(resolved).toBe(realBun);
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

  test("inspect framework returns framework-level context", async () => {
    const result = await runInspectCommand("framework", process.cwd());
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({
      schemaVersion: "0.1.0",
      project: {
        type: "forgeos-framework",
      },
    });
    expect(JSON.stringify(result.data)).toContain("forge dev --once --json");
    expect(JSON.stringify(result.data)).toContain("minimal-web");
  });

  test("inspect agent-contract reads the generated agent contract", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-inspect-agent-contract");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runInspectCommand("agent-contract", workspace);
      expect(result.exitCode).toBe(0);
      expect(result.data).toMatchObject({
        schemaVersion: "0.1.0",
      });
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
