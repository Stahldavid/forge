#!/usr/bin/env node
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  const args = {
    dryRun: false,
    install: true,
    json: false,
    keep: false,
    runtimeProbes: false,
    timeoutMs: 180000,
    templates: ["minimal-web"],
    packageManagers: ["npm"],
    writeReport: undefined,
    forgeSpec: `file:${repoRoot}`,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--install") args.install = true;
    else if (arg === "--no-install") args.install = false;
    else if (arg === "--json") args.json = true;
    else if (arg === "--keep") args.keep = true;
    else if (arg === "--runtime-probes") args.runtimeProbes = true;
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else if (arg === "--templates") args.templates = splitList(argv[++index]);
    else if (arg === "--package-managers") args.packageManagers = splitList(argv[++index]);
    else if (arg === "--forge-spec") args.forgeSpec = argv[++index];
    else if (arg === "--write-report") args.writeReport = argv[++index];
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

function compactText(text, maxLength = 4000) {
  const value = String(text ?? "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.floor(maxLength / 2))}\n...[truncated ${value.length - maxLength} chars]...\n${value.slice(-Math.floor(maxLength / 2))}`;
}

function compactStep(step) {
  return {
    ...step,
    stderr: compactText(step.stderr),
    stdout: compactText(step.stdout),
  };
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

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function authHeaders() {
  return {
    "content-type": "application/json",
    "x-forge-role": "owner",
    "x-forge-tenant-id": "00000000-0000-0000-0000-000000000001",
    "x-forge-user-id": "field-test-user",
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    body,
    ok: response.ok,
    status: response.status,
  };
}

async function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError = "not started";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await fetchJson(`${url}/health`);
      if (result.ok && result.body?.ok === true) {
        return result;
      }
      lastError = `HTTP ${result.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Dev server did not become healthy at ${url}: ${lastError}`);
}

async function getFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function stopProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolveStop) => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      const timer = setTimeout(resolveStop, 5000);
      killer.once("close", () => {
        clearTimeout(timer);
        resolveStop();
      });
      killer.once("error", () => {
        clearTimeout(timer);
        resolveStop();
      });
    });
    return;
  }
  child.kill("SIGTERM");
}

async function runRuntimeProbes({ appDir, packageManager, template, timeoutMs }) {
  const pm = commandName(packageManager);
  const port = await getFreePort();
  const serverUrl = `http://127.0.0.1:${port}`;
  const scriptArgs = packageScriptArgs(packageManager, "forge", ["dev", "--api-only", "--port", String(port), "--json"]);
  const startedAt = Date.now();
  const spawnTarget = windowsBatchTarget(pm, scriptArgs);
  const child = spawn(spawnTarget.command, spawnTarget.args, {
    cwd: appDir,
    env: { ...process.env },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let childError;
  const steps = [];

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.once("error", (error) => {
    childError = error;
  });

  try {
    if (childError) {
      throw new Error(`Could not start forge dev: ${childError.message}`);
    }

    const health = await waitForHealth(serverUrl, Math.min(timeoutMs, 120000));
    steps.push({
      command: `GET ${serverUrl}/health`,
      durationMs: Date.now() - startedAt,
      exitCode: 0,
      ok: true,
      status: health.status,
    });

    const entries = await fetchJson(`${serverUrl}/entries`);
    steps.push({
      command: `GET ${serverUrl}/entries`,
      durationMs: Date.now() - startedAt,
      exitCode: entries.ok ? 0 : 1,
      ok: entries.ok && entries.body?.ok === true,
      status: entries.status,
    });

    if (template === "minimal-web") {
      const create = await fetchJson(`${serverUrl}/commands/createNote`, {
        body: JSON.stringify({ args: { body: "Created by ForgeOS field test.", title: "Field test note" } }),
        headers: authHeaders(),
        method: "POST",
      });
      steps.push({
        command: `POST ${serverUrl}/commands/createNote`,
        durationMs: Date.now() - startedAt,
        exitCode: create.ok && create.body?.ok === true ? 0 : 1,
        ok: create.ok && create.body?.ok === true,
        status: create.status,
        traceId: create.body?.traceId,
      });

      const list = await fetchJson(`${serverUrl}/queries/listNotes`, {
        body: JSON.stringify({ args: {} }),
        headers: authHeaders(),
        method: "POST",
      });
      const notes = Array.isArray(list.body?.result) ? list.body.result : [];
      steps.push({
        command: `POST ${serverUrl}/queries/listNotes`,
        durationMs: Date.now() - startedAt,
        exitCode: list.ok && notes.some((note) => note.title === "Field test note") ? 0 : 1,
        ok: list.ok && notes.some((note) => note.title === "Field test note"),
        status: list.status,
        traceId: list.body?.traceId,
      });
    } else if (template === "b2b-support-web") {
      const create = await fetchJson(`${serverUrl}/commands/createTicket`, {
        body: JSON.stringify({ args: { body: "Created by ForgeOS field test.", title: "Field test ticket" } }),
        headers: authHeaders(),
        method: "POST",
      });
      steps.push({
        command: `POST ${serverUrl}/commands/createTicket`,
        durationMs: Date.now() - startedAt,
        exitCode: create.ok && create.body?.ok === true ? 0 : 1,
        ok: create.ok && create.body?.ok === true,
        status: create.status,
        traceId: create.body?.traceId,
      });

      const list = await fetchJson(`${serverUrl}/queries/listTickets`, {
        body: JSON.stringify({ args: {} }),
        headers: authHeaders(),
        method: "POST",
      });
      const tickets = Array.isArray(list.body?.result) ? list.body.result : [];
      steps.push({
        command: `POST ${serverUrl}/queries/listTickets`,
        durationMs: Date.now() - startedAt,
        exitCode: list.ok && tickets.some((ticket) => ticket.title === "Field test ticket") ? 0 : 1,
        ok: list.ok && tickets.some((ticket) => ticket.title === "Field test ticket"),
        status: list.status,
        traceId: list.body?.traceId,
      });
    }

    return {
      ok: steps.every((step) => step.ok),
      serverUrl,
      steps: steps.map(compactStep),
      stderr: compactText(stderr),
      stdout: compactText(stdout),
    };
  } finally {
    await stopProcessTree(child);
    await new Promise((resolveClose) => {
      const timer = setTimeout(resolveClose, 5000);
      child.once("close", () => {
        clearTimeout(timer);
        resolveClose();
      });
    });
  }
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

async function fieldCase({ appRoot, forgeSpec, install, packageManager, runtimeProbes, template, timeoutMs }) {
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

    if (runtimeProbes) {
      const runtime = await runRuntimeProbes({ appDir, packageManager, template, timeoutMs });
      steps.push(...runtime.steps);
      return {
        appDir,
        ok: steps.every((step) => step.ok),
        packageManager,
        runtime,
        steps: steps.map(compactStep),
        template,
      };
    }
  }

  return {
    appDir,
    ok: steps.every((step) => step.ok),
    packageManager,
    steps: steps.map(compactStep),
    template,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = args.templates.flatMap((template) =>
    args.packageManagers.map((packageManager) => ({ packageManager, template })),
  );

  if (args.dryRun) {
    const plan = { cases, forgeSpec: args.forgeSpec, install: args.install, ok: true, runtimeProbes: args.runtimeProbes, timeoutMs: args.timeoutMs };
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
          runtimeProbes: args.runtimeProbes,
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
    runtimeProbes: args.runtimeProbes,
  };
  if (args.writeReport) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const reportPath = resolve(args.writeReport);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  console.log(args.json ? JSON.stringify(summary, null, 2) : humanSummary(summary));
  if (!summary.ok) process.exitCode = 1;
}

function humanSummary(summary) {
  const lines = ["ForgeOS field test"];
  for (const result of summary.results) {
    const status = result.skipped ? "SKIP" : result.ok ? "PASS" : "FAIL";
    const runtime = result.runtime?.serverUrl ? ` runtime=${result.runtime.serverUrl}` : "";
    lines.push(`${status} ${result.template} ${result.packageManager}${runtime}`);
  }
  return lines.join("\n");
}

main().catch((error) => {
  const result = error.result ? `\n${JSON.stringify(error.result, null, 2)}` : "";
  console.error(`${error.message}${result}`);
  process.exitCode = 1;
});
