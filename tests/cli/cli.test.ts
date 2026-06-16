import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

  test("main prints focused help for empty command", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main([]);
      expect(code).toBe(0);
      expect(output).toContain("forge dev --once --json");
      expect(output).toContain("forge do \"fix\" --json");
      expect(output).toContain("forge doctor windows --json");
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("main prints CLI version", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(["--version"]);
      expect(code).toBe(0);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("main prints JSON CLI version", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(["--version", "--json"]);
      expect(code).toBe(0);
      const parsed = JSON.parse(output) as { version?: string; cliVersion?: string };
      expect(parsed.version).toBe(parsed.cliVersion);
      expect(parsed.version).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    } finally {
      process.stdout.write = originalWrite;
    }
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
      "--smoke",
      "--script-timeout-ms",
      "1234",
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("verify");
    if (parsed.command?.kind === "verify") {
      expect(parsed.command.options.skipTests).toBe(true);
      expect(parsed.command.options.skipEslint).toBe(true);
      expect(parsed.command.options.smoke).toBe(true);
      expect(parsed.command.options.scriptTimeoutMs).toBe(1234);
    }
  });

  test("parseCli accepts impact test timeout", () => {
    const parsed = parseCli(["test", "run", "--changed", "--timeout-ms", "77", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("test");
    if (parsed.command?.kind === "test") {
      expect(parsed.command.options.timeoutMs).toBe(77);
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

  test("resolveBunExecutable refuses ambiguous Windows bun fallback", () => {
    expect(() => resolveBunExecutable({
      env: {},
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: () => false,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun.exe",
    })).toThrow("Unable to resolve a safe Bun executable on Windows");
  });

  test("resolveBunExecutable honors explicit FORGE_BUN", () => {
    const realBun = "D:\\Tools\\bun\\bun.exe";
    const resolved = resolveBunExecutable({
      env: { FORGE_BUN: realBun },
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      platform: "win32",
      which: () => null,
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

  test("verify reports package script timeouts", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-verify-timeout");
    try {
      const pkgPath = join(workspace, "package.json");
      writeFileSync(
        pkgPath,
        JSON.stringify(
          {
            name: "forge-verify-timeout-test",
            private: true,
            type: "module",
            packageManager: "npm@10.9.0",
            scripts: {
              typecheck: "node -e \"setTimeout(() => {}, 5000)\"",
            },
            dependencies: { zod: "^3.24.0" },
          },
          null,
          2,
        ),
        "utf8",
      );
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runVerifyCommand({
        workspaceRoot: workspace,
        json: true,
        skipTests: true,
        skipTypecheck: false,
        skipEslint: true,
        strict: false,
        scriptTimeoutMs: 50,
      });

      expect(result.ok).toBe(false);
      expect(result.steps.find((step) => step.name === "typecheck")?.timedOut).toBe(true);
      expect(result.steps.find((step) => step.name === "typecheck")?.failureKind).toBe("timeout");
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_VERIFY_SCRIPT_TIMEOUT")).toBe(true);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_VERIFY_TYPECHECK")).toBe(false);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("verify reports package script failure output", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-verify-script-failure");
    try {
      const pkgPath = join(workspace, "package.json");
      writeFileSync(
        pkgPath,
        JSON.stringify(
          {
            name: "forge-verify-script-failure-test",
            private: true,
            type: "module",
            packageManager: "npm@10.9.0",
            scripts: {
              typecheck: "node -e \"console.error('typecheck exploded'); process.exit(7)\"",
            },
            dependencies: { zod: "^3.24.0" },
          },
          null,
          2,
        ),
        "utf8",
      );
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runVerifyCommand({
        workspaceRoot: workspace,
        json: true,
        skipTests: true,
        skipTypecheck: false,
        skipEslint: true,
        strict: false,
        scriptTimeoutMs: 120000,
      });

      const typecheck = result.steps.find((step) => step.name === "typecheck");
      const diagnostic = result.diagnostics.find((item) => item.code === "FORGE_VERIFY_TYPECHECK");
      expect(result.ok).toBe(false);
      expect(typecheck?.failureKind).toBe("script-failure");
      expect(diagnostic?.message).toContain("exit code 7");
      expect(diagnostic?.fixHint).toContain("typecheck exploded");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("verify --changed propagates impact command resolution diagnostics", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-verify-changed-resolution");
    const previous = process.env.FORGE_BUN;
    try {
      mkdirSync(join(workspace, "tests"), { recursive: true });
      writeFileSync(
        join(workspace, "tests", "changed.test.ts"),
        `import { test, expect } from "bun:test"; test("changed", () => expect(1).toBe(1));`,
        "utf8",
      );
      await runGenerateCommand(defaultGenerateOptions(workspace));
      spawnSync("git", ["init"], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["config", "user.email", "forge@example.test"], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["config", "user.name", "Forge Test"], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["add", "."], { cwd: workspace, windowsHide: true });
      spawnSync("git", ["commit", "-m", "baseline"], { cwd: workspace, windowsHide: true });
      writeFileSync(
        join(workspace, "tests", "changed.test.ts"),
        `import { test, expect } from "bun:test"; test("changed", () => expect(2).toBe(2));`,
        "utf8",
      );

      process.env.FORGE_BUN = join(workspace, "missing-bun.exe");
      const result = await runVerifyCommand({
        workspaceRoot: workspace,
        json: true,
        skipTests: false,
        skipTypecheck: true,
        skipEslint: true,
        strict: false,
        changed: true,
        scriptTimeoutMs: 120000,
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_TEST_COMMAND_RESOLUTION_FAILED")).toBe(true);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_VERIFY_CHANGED_INCOMPLETE")).toBe(true);
      expect(result.steps.find((step) => step.command?.startsWith("bun test tests/changed.test.ts"))?.failureKind)
        .toBe("command-resolution-error");
    } finally {
      if (previous === undefined) {
        delete process.env.FORGE_BUN;
      } else {
        process.env.FORGE_BUN = previous;
      }
      cleanupWorkspace(workspace);
    }
  }, 60_000);

  test("verify --standard uses impact tests instead of the full test script", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-verify-standard");
    try {
      const pkgPath = join(workspace, "package.json");
      writeFileSync(
        pkgPath,
        JSON.stringify(
          {
            name: "forge-verify-standard-test",
            private: true,
            type: "module",
            packageManager: "npm@10.9.0",
            scripts: {
              test: "node -e \"process.exit(99)\"",
            },
            dependencies: { zod: "^3.24.0" },
          },
          null,
          2,
        ),
        "utf8",
      );
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runVerifyCommand({
        workspaceRoot: workspace,
        json: true,
        skipTests: false,
        skipTypecheck: true,
        skipEslint: true,
        strict: false,
        standard: true,
      });

      expect(result.ok).toBe(true);
      expect(result.profile).toBe("standard");
      expect(result.steps.some((step) => step.name === "impact-tests")).toBe(true);
      expect(result.steps.find((step) => step.name === "tests")?.skipped).toBe(true);
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
