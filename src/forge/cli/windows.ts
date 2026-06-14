import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, win32 } from "node:path";
import { resolveBunExecutable } from "../compiler/package-manager/bun-executable.ts";
import { resolveCommandArgv } from "../compiler/package-manager/executor.ts";

export interface WindowsCheck {
  name: string;
  ok: boolean;
  severity: "error" | "warning" | "info";
  message: string;
  fixHint?: string;
  suggestedCommands?: string[];
}

export interface WindowsDoctorResult {
  ok: boolean;
  platform: NodeJS.Platform;
  checks: WindowsCheck[];
  exitCode: 0 | 1;
}

export interface WindowsSetupAction {
  name: string;
  applied: boolean;
  command?: string;
  message: string;
}

export interface WindowsSetupResult {
  ok: boolean;
  dryRun: boolean;
  doctor: WindowsDoctorResult;
  actions: WindowsSetupAction[];
  exitCode: 0 | 1;
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface WindowsProbe {
  env?: Record<string, string | undefined>;
  execPath?: string;
  exists?: (path: string) => boolean;
  homeDir?: string;
  pathEntries?: string[];
  platform?: NodeJS.Platform;
  runCommand?: (command: string, args: string[]) => CommandResult;
  symlinkAllowed?: () => boolean;
}

function defaultRunCommand(command: string, args: string[]): CommandResult {
  if (process.platform === "win32" && !command.toLowerCase().endsWith(".exe")) {
    const commandLine = [command, ...args].map(quoteCmdArg).join(" ");
    const result = spawnSync("cmd.exe", ["/d", "/s", "/c", commandLine], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }
  const argv = resolveCommandArgv([command, ...args]);
  const result = spawnSync(argv[0]!, argv.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function quoteCmdArg(value: string): string {
  return /^[A-Za-z0-9_./:=\\-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`;
}

function run(
  probe: WindowsProbe,
  command: string,
  args: string[],
): CommandResult {
  return (probe.runCommand ?? defaultRunCommand)(command, args);
}

function checkCommand(
  probe: WindowsProbe,
  name: string,
  command: string,
  args: string[],
  installHint: string,
): WindowsCheck {
  const result = run(probe, command, args);
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join(" ");
  return {
    name,
    ok: result.status === 0,
    severity: "error",
    message: result.status === 0 ? `${command} available: ${output}` : `${command} is not available`,
    fixHint: result.status === 0 ? undefined : installHint,
    suggestedCommands: result.status === 0 ? undefined : [installHint],
  };
}

function pathEntries(probe: WindowsProbe): string[] {
  if (probe.pathEntries) {
    return probe.pathEntries;
  }
  return (probe.env?.PATH ?? process.env.PATH ?? "").split(delimiter).filter(Boolean);
}

function findOnPath(probe: WindowsProbe, command: string): string | null {
  const exists = probe.exists ?? existsSync;
  const extensions = [".exe", ".cmd", ".bat", ""];
  for (const dir of pathEntries(probe)) {
    for (const extension of extensions) {
      const candidate = win32.join(dir, `${command}${extension}`);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function bunShimChecks(probe: WindowsProbe): WindowsCheck[] {
  const checks: WindowsCheck[] = [];
  const exists = probe.exists ?? existsSync;
  const candidates = pathEntries(probe)
    .flatMap((dir) => [win32.join(dir, "bun"), win32.join(dir, "bun.exe")])
    .filter((candidate) => exists(candidate));

  const suspicious = candidates.filter((candidate) => {
    const normalized = candidate.replace(/\//g, "\\").toLowerCase();
    return normalized.includes("\\kiro-cli\\") || !normalized.endsWith(".exe");
  });

  if (suspicious.length > 0) {
    checks.push({
      name: "windows-bun-shims",
      ok: false,
      severity: "warning",
      message: `suspicious Bun PATH entries detected: ${suspicious.join(", ")}`,
      fixHint: "Move the real ~/.bun/bin/bun.exe earlier in PATH or set FORGE_BUN to the real bun.exe.",
      suggestedCommands: ["$env:FORGE_BUN=\"$env:USERPROFILE\\.bun\\bin\\bun.exe\""],
    });
  } else {
    checks.push({
      name: "windows-bun-shims",
      ok: true,
      severity: "warning",
      message: "no suspicious Bun PATH entries detected",
    });
  }

  return checks;
}

function safeBunCheck(probe: WindowsProbe): { check: WindowsCheck; bunPath?: string } {
  try {
    const bunPath = resolveBunExecutable({
      env: probe.env,
      execPath: probe.execPath,
      exists: probe.exists,
      homeDir: probe.homeDir,
      platform: probe.platform,
      which: (command) => findOnPath(probe, command),
    });
    return {
      bunPath,
      check: {
        name: "windows-bun-safe-resolution",
        ok: true,
        severity: "warning",
        message: `safe Bun executable resolved: ${bunPath}`,
      },
    };
  } catch (error) {
    return {
      check: {
        name: "windows-bun-safe-resolution",
        ok: false,
        severity: "warning",
        message: error instanceof Error ? error.message : String(error),
        fixHint: "Install Bun at ~/.bun/bin/bun.exe or set FORGE_BUN to an existing bun.exe.",
        suggestedCommands: ["setx FORGE_BUN \"%USERPROFILE%\\.bun\\bin\\bun.exe\""],
      },
    };
  }
}

function gitLongPathsCheck(probe: WindowsProbe): WindowsCheck {
  const result = run(probe, "git", ["config", "--global", "--get", "core.longpaths"]);
  const enabled = result.status === 0 && result.stdout.trim().toLowerCase() === "true";
  return {
    name: "windows-git-longpaths",
    ok: enabled,
    severity: "warning",
    message: enabled ? "git core.longpaths is enabled" : "git core.longpaths is not enabled",
    fixHint: enabled ? undefined : "Run git config --global core.longpaths true.",
    suggestedCommands: enabled ? undefined : ["git config --global core.longpaths true"],
  };
}

function executionPolicyCheck(probe: WindowsProbe): WindowsCheck {
  const result = run(probe, "powershell.exe", [
    "-NoProfile",
    "-Command",
    "Get-ExecutionPolicy -Scope CurrentUser",
  ]);
  const policy = result.stdout.trim();
  const ok = result.status === 0 && !["Restricted", "Undefined"].includes(policy);
  return {
    name: "windows-powershell-execution-policy",
    ok,
    severity: "warning",
    message: result.status === 0
      ? `PowerShell CurrentUser execution policy: ${policy}`
      : "could not inspect PowerShell execution policy",
    fixHint: ok ? undefined : "Use RemoteSigned for local developer scripts if your environment allows it.",
    suggestedCommands: ok ? undefined : ["Set-ExecutionPolicy -Scope CurrentUser RemoteSigned"],
  };
}

function symlinkCheck(probe: WindowsProbe): WindowsCheck {
  let ok = false;
  if (probe.symlinkAllowed) {
    ok = probe.symlinkAllowed();
  } else {
    const root = mkdtempSync(join(tmpdir(), "forge-win-symlink-"));
    try {
      const target = join(root, "target.txt");
      const link = join(root, "link.txt");
      writeFileSync(target, "ok", "utf8");
      symlinkSync(target, link, "file");
      ok = true;
    } catch {
      ok = false;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  return {
    name: "windows-symlink-support",
    ok,
    severity: "warning",
    message: ok ? "symlink creation is available" : "symlink creation is not available",
    fixHint: ok ? undefined : "Enable Developer Mode or run the shell with permissions that allow symlink creation.",
  };
}

export async function runWindowsDoctorCommand(options: {
  workspaceRoot: string;
  probe?: WindowsProbe;
}): Promise<WindowsDoctorResult> {
  const probe = options.probe ?? {};
  const platform = probe.platform ?? process.platform;
  const checks: WindowsCheck[] = [
    {
      name: "windows-native-platform",
      ok: platform === "win32",
      severity: "info",
      message:
        platform === "win32"
          ? "running on native Windows"
          : `not running on native Windows (${platform}); Windows checks are simulated/informational`,
    },
    checkCommand(probe, "windows-node", "node", ["--version"], "Install Node.js LTS."),
    checkCommand(probe, "windows-npm", "npm", ["--version"], "Install npm with Node.js LTS."),
    checkCommand(probe, "windows-git", "git", ["--version"], "Install Git for Windows."),
  ];

  const bun = safeBunCheck({ ...probe, platform: "win32" });
  checks.push(bun.check, ...bunShimChecks(probe));

  if (platform === "win32") {
    checks.push(gitLongPathsCheck(probe));
    checks.push(executionPolicyCheck(probe));
    checks.push(symlinkCheck(probe));
  }

  const ok = checks.every((check) => check.ok || check.severity !== "error");
  return { ok, platform, checks, exitCode: ok ? 0 : 1 };
}

function commandAction(
  name: string,
  command: string,
  argv: string[],
  dryRun: boolean,
  probe: WindowsProbe,
): WindowsSetupAction {
  if (dryRun) {
    return {
      name,
      applied: false,
      command,
      message: `would run: ${command}`,
    };
  }
  const [executable, ...args] = argv;
  const result = run(probe, executable!, args);
  return {
    name,
    applied: result.status === 0,
    command,
    message:
      result.status === 0
        ? `applied: ${command}`
        : `failed: ${command}; ${(result.stderr || result.stdout).trim()}`,
  };
}

export async function runWindowsSetupCommand(options: {
  workspaceRoot: string;
  yes: boolean;
  probe?: WindowsProbe;
}): Promise<WindowsSetupResult> {
  const probe = options.probe ?? {};
  const doctor = await runWindowsDoctorCommand({
    workspaceRoot: options.workspaceRoot,
    probe,
  });
  const dryRun = !options.yes;
  const actions: WindowsSetupAction[] = [];
  const safeBun = safeBunCheck({ ...probe, platform: "win32" });
  const hasForgeBun = Boolean((probe.env ?? process.env).FORGE_BUN);

  if (safeBun.bunPath && !hasForgeBun) {
    actions.push(commandAction(
      "set-forge-bun",
      `setx FORGE_BUN "${safeBun.bunPath}"`,
      ["setx", "FORGE_BUN", safeBun.bunPath],
      dryRun,
      probe,
    ));
  }

  if (!doctor.checks.find((check) => check.name === "windows-git-longpaths")?.ok) {
    actions.push(commandAction(
      "enable-git-longpaths",
      "git config --global core.longpaths true",
      ["git", "config", "--global", "core.longpaths", "true"],
      dryRun,
      probe,
    ));
  }

  if (actions.length === 0) {
    actions.push({
      name: "windows-setup",
      applied: false,
      message: "no safe automatic Windows setup actions are required",
    });
  }

  const ok = doctor.ok && actions.every((action) => dryRun || action.applied || action.name === "windows-setup");
  return {
    ok,
    dryRun,
    doctor,
    actions,
    exitCode: ok ? 0 : 1,
  };
}

export function formatWindowsDoctorJson(result: WindowsDoctorResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatWindowsDoctorHuman(result: WindowsDoctorResult): string {
  const lines = ["Forge Windows Doctor", ""];
  for (const check of result.checks) {
    const marker = check.ok ? "OK" : check.severity === "error" ? "FAIL" : "WARN";
    lines.push(`${marker} ${check.name} - ${check.message}`);
    if (check.fixHint) {
      lines.push(`  fix: ${check.fixHint}`);
    }
  }
  lines.push("");
  lines.push(result.ok ? "Windows development environment looks usable." : "Windows development environment needs attention.");
  return `${lines.join("\n")}\n`;
}

export function formatWindowsSetupJson(result: WindowsSetupResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatWindowsSetupHuman(result: WindowsSetupResult): string {
  const lines = [result.dryRun ? "Forge Windows Setup (dry run)" : "Forge Windows Setup", ""];
  for (const action of result.actions) {
    lines.push(`${action.applied ? "APPLIED" : "PLAN"} ${action.name} - ${action.message}`);
  }
  lines.push("");
  lines.push(result.ok ? "Windows setup is ready." : "Windows setup needs attention.");
  return `${lines.join("\n")}\n`;
}
