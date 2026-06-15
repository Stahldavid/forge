#!/usr/bin/env node
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  const args = {
    dryRun: false,
    install: true,
    json: false,
    keep: false,
    timeoutMs: 180000,
    templates: ["minimal-web"],
    packageManagers: ["npm"],
    forgeSpec: `file:${repoRoot}`,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--install") args.install = true;
    else if (arg === "--no-install") args.install = false;
    else if (arg === "--json") args.json = true;
    else if (arg === "--keep") args.keep = true;
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else if (arg === "--templates") args.templates = splitList(argv[++index]);
    else if (arg === "--package-managers") args.packageManagers = splitList(argv[++index]);
    else if (arg === "--forge-spec") args.forgeSpec = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  args.forgeSpec = normalizeForgeSpec(args.forgeSpec);

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  return args;
}

function splitList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeForgeSpec(spec) {
  if (!spec.startsWith("file:")) return spec;
  const fileTarget = spec.slice("file:".length);
  if (fileTarget === "" || fileTarget.startsWith("$") || isAbsolute(fileTarget)) {
    return spec;
  }
  return `file:${resolve(process.cwd(), fileTarget)}`;
}

function commandName(command) {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

function commandLine(command, args) {
  return [command, ...args].join(" ");
}

function packageScriptArgs(pm, script, extraArgs = []) {
  if (pm === "npm") return ["run", script, ...(extraArgs.length > 0 ? ["--", ...extraArgs] : [])];
  return ["run", script, ...extraArgs];
}

async function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = await runCommand(probe, args, { timeoutMs: 10000, allowFailure: true });
  return result.exitCode === 0;
}

async function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 180000;
  const startedAt = Date.now();
  return new Promise((resolveRun, rejectRun) => {
    const spawnTarget = windowsBatchTarget(command, args);
    let child;
    try {
      child = spawn(spawnTarget.command, spawnTarget.args, {
        cwd: options.cwd ?? repoRoot,
        env: { ...process.env, ...(options.env ?? {}) },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      const commandText = commandLine(command, args);
      if (options.allowFailure) {
        resolveRun({
          command: commandText,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          exitCode: 127,
          ok: false,
          stderr: "",
          stdout: "",
          timedOut: false,
        });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        rejectRun(new Error(`${commandText}: ${message}`));
      }
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      const commandText = commandLine(command, args);
      if (options.allowFailure) {
        resolveRun({
          command: commandText,
          durationMs: Date.now() - startedAt,
          error: error.message,
          exitCode: 127,
          ok: false,
          stderr,
          stdout,
          timedOut,
        });
      } else {
        error.message = `${commandText}: ${error.message}`;
        rejectRun(error);
      }
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const result = {
        command: commandLine(command, args),
        durationMs: Date.now() - startedAt,
        exitCode,
        ok: exitCode === 0 && !timedOut,
        stderr,
        stdout,
        timedOut,
      };
      if (!result.ok && !options.allowFailure) {
        const error = new Error(`Command failed: ${result.command}`);
        error.result = result;
        rejectRun(error);
        return;
      }
      resolveRun(result);
    });
  });
}

function windowsBatchTarget(command, args) {
  if (process.platform !== "win32" || !command.endsWith(".cmd")) {
    return { args, command };
  }
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/c", command, ...args],
  };
}

async function fieldCase({ appRoot, forgeSpec, install, packageManager, template, timeoutMs }) {
  const appName = `${template}-${packageManager}-field`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const appDir = join(appRoot, appName);
  const steps = [];
  const forgeArgs = [
    join(repoRoot, "bin", "forge.mjs"),
    "new",
    appName,
    "--template",
    template,
    "--package-manager",
    packageManager,
    "--forge-spec",
    forgeSpec,
    "--no-git",
    ...(install ? ["--install"] : ["--no-install"]),
  ];
  steps.push(await runCommand(process.execPath, forgeArgs, { cwd: appRoot, timeoutMs }));

  if (install) {
    const pm = commandName(packageManager);
    steps.push(await runCommand(pm, packageScriptArgs(packageManager, "generate"), { cwd: appDir, timeoutMs }));
    steps.push(
      await runCommand(pm, packageScriptArgs(packageManager, "forge", ["dev", "--once", "--json"]), {
        cwd: appDir,
        timeoutMs,
      }),
    );
    steps.push(
      await runCommand(
        pm,
        packageScriptArgs(packageManager, "forge", ["verify", "--smoke", "--json", "--script-timeout-ms", String(timeoutMs)]),
        { cwd: appDir, timeoutMs },
      ),
    );
  }

  return {
    appDir,
    ok: steps.every((step) => step.ok),
    packageManager,
    steps,
    template,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = args.templates.flatMap((template) =>
    args.packageManagers.map((packageManager) => ({ packageManager, template })),
  );

  if (args.dryRun) {
    const plan = { cases, forgeSpec: args.forgeSpec, install: args.install, ok: true, timeoutMs: args.timeoutMs };
    console.log(args.json ? JSON.stringify(plan, null, 2) : `Planned ${cases.length} ForgeOS field test case(s).`);
    return;
  }

  const appRoot = await mkdtemp(join(tmpdir(), "forgeos-field-"));
  const results = [];
  try {
    for (const testCase of cases) {
      const exists = await commandExists(testCase.packageManager);
      if (!exists) {
        results.push({ ...testCase, ok: true, skipped: true, reason: `${testCase.packageManager} not found on PATH` });
        continue;
      }
      results.push(
        await fieldCase({
          appRoot,
          forgeSpec: args.forgeSpec,
          install: args.install,
          packageManager: testCase.packageManager,
          template: testCase.template,
          timeoutMs: args.timeoutMs,
        }),
      );
    }
  } finally {
    if (!args.keep) {
      await rm(appRoot, { force: true, recursive: true });
    } else {
      await access(appRoot).catch(() => undefined);
    }
  }

  const summary = {
    appRoot: args.keep ? appRoot : undefined,
    forgeSpec: args.forgeSpec,
    install: args.install,
    ok: results.every((result) => result.ok),
    results,
  };
  console.log(args.json ? JSON.stringify(summary, null, 2) : humanSummary(summary));
  if (!summary.ok) process.exitCode = 1;
}

function humanSummary(summary) {
  const lines = ["ForgeOS field test"];
  for (const result of summary.results) {
    const status = result.skipped ? "SKIP" : result.ok ? "PASS" : "FAIL";
    lines.push(`${status} ${result.template} ${result.packageManager}`);
  }
  return lines.join("\n");
}

main().catch((error) => {
  const result = error.result ? `\n${JSON.stringify(error.result, null, 2)}` : "";
  console.error(`${error.message}${result}`);
  process.exitCode = 1;
});
