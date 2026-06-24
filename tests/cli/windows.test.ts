import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import {
  runWindowsDoctorCommand,
  runWindowsSetupCommand,
  type WindowsProbe,
} from "../../src/forge/cli/windows.ts";

function winProbe(overrides: Partial<WindowsProbe> = {}): WindowsProbe {
  const home = "C:\\Users\\David";
  const realBun = `${home}\\.bun\\bin\\bun.exe`;
  const kiroBun = `${home}\\AppData\\Local\\Kiro-Cli\\bun.exe`;
  return {
    env: {
      PATH: `${home}\\AppData\\Local\\Kiro-Cli;${home}\\.bun\\bin`,
    },
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    exists: (path) => path === realBun || path === kiroBun || path.endsWith("node.exe"),
    homeDir: home,
    pathEntries: [`${home}\\AppData\\Local\\Kiro-Cli`, `${home}\\.bun\\bin`],
    platform: "win32",
    runCommand: (command, args) => {
      const joined = [command, ...args].join(" ");
      if (joined === "node --version") {
        return { status: 0, stdout: "v22.0.0\n", stderr: "" };
      }
      if (joined === "npm --version") {
        return { status: 0, stdout: "10.9.0\n", stderr: "" };
      }
      if (joined === "git --version") {
        return { status: 0, stdout: "git version 2.45.0\n", stderr: "" };
      }
      if (joined === "git config --global --get core.longpaths") {
        return { status: 1, stdout: "", stderr: "" };
      }
      if (joined === "powershell.exe -NoProfile -Command Get-ExecutionPolicy -Scope CurrentUser") {
        return { status: 0, stdout: "RemoteSigned\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    symlinkAllowed: () => true,
    ...overrides,
  };
}

describe("Windows CLI diagnostics", () => {
  test("parseCli accepts doctor windows and setup windows", () => {
    expect(parseCli(["doctor", "windows", "--json"]).command).toMatchObject({
      kind: "doctor",
      target: "windows",
      json: true,
    });
    expect(parseCli(["setup", "windows", "--yes", "--json"]).command).toMatchObject({
      kind: "setup",
      target: "windows",
      yes: true,
      json: true,
    });
  });

  test("parseCli rejects unknown doctor subcommands", () => {
    const parsed = parseCli(["doctor", "mac"]);

    expect(parsed.command).toBeNull();
    expect(parsed.errors).toContain("forge doctor supports subcommand: windows, agent, or delta");
  });

  test("doctor windows detects suspicious Kiro Bun shims while resolving real Bun", async () => {
    const result = await runWindowsDoctorCommand({
      workspaceRoot: process.cwd(),
      probe: winProbe(),
    });

    expect(result.ok).toBe(true);
    expect(result.platform).toBe("win32");
    expect(result.checks.find((check) => check.name === "windows-bun-safe-resolution")?.ok)
      .toBe(true);
    const shim = result.checks.find((check) => check.name === "windows-bun-shims");
    expect(shim?.ok).toBe(false);
    expect(shim?.message).toContain("Kiro-Cli");
  });

  test("setup windows dry-run plans safe environment fixes", async () => {
    const result = await runWindowsSetupCommand({
      workspaceRoot: process.cwd(),
      yes: false,
      probe: winProbe(),
    });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.actions.map((action) => action.name)).toContain("set-forge-bun");
    expect(result.actions.map((action) => action.name)).toContain("enable-git-longpaths");
    expect(result.actions.every((action) => action.applied === false)).toBe(true);
    expect(result.actions.find((action) => action.name === "set-forge-bun")?.command)
      .toContain("setx FORGE_BUN");
  });

  test("Codex app-server probe waits for process close before cleanup", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "forge", "cli", "codex-app-server.ts"),
      "utf8",
    );
    expect(source).toContain('child.once("close"');
    expect(source).not.toContain('child.once("exit"');
    expect(source).not.toContain('child.on("exit"');
  });
});
