import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = mkdtempSync(join(tmpdir(), "forgeos-pack-smoke-"));
const npmCommand = "npm";
const previewPort = 5174;
const dryRun = process.argv.includes("--dry-run") || process.env.SMOKE_PACKED_PACKAGE_DRY_RUN === "1";
const defaultReportPath = join(repoRoot, ".forge", "field-reports", "release-smoke-latest.json");
const reportPath = process.env.SMOKE_PACKED_PACKAGE_REPORT
  ? resolve(process.env.SMOKE_PACKED_PACKAGE_REPORT)
  : defaultReportPath;
const commandTimeoutMs = Number(process.env.SMOKE_PACKED_PACKAGE_STEP_TIMEOUT_MS ?? 180_000);
let tarballPath = "";
const evidence = {
  schemaVersion: "0.1.0",
  kind: "release-packed-package-smoke",
  ok: false,
  dryRun,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  version: null,
  tempRoot,
  reportPath,
  previewPort,
  steps: [],
  artifacts: {},
  cleanup: {
    previewPortClosed: null,
  },
  error: null,
};

function npmGlobalBin(prefix) {
  return process.platform === "win32" ? prefix : join(prefix, "bin");
}

function forgeBin(prefix) {
  return process.platform === "win32" ? join(prefix, "forge.cmd") : join(prefix, "bin", "forge");
}

function run(command, args, options = {}) {
  const stepName = options.step ?? `${command} ${args.slice(0, 3).join(" ")}`.trim();
  const startedAt = Date.now();
  console.log(`[release:smoke] start ${stepName}`);
  const argv =
    process.platform === "win32" && command === npmCommand
      ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/c", command, ...args]]
      : [command, args];
  const result = spawnSync(argv[0], argv[1], {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs ?? commandTimeoutMs,
  });
  const durationMs = Date.now() - startedAt;
  const allowedFailure = result.status !== 0 && options.allowFailure === true;
  evidence.steps.push({
    name: stepName,
    command: [command, ...args].join(" "),
    cwd: options.cwd ?? repoRoot,
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    durationMs,
    ok: result.status === 0 || allowedFailure,
    allowedFailure,
    timedOut: result.error && result.error.message.includes("ETIMEDOUT"),
  });
  console.log(`[release:smoke] ${result.status === 0 ? "ok" : allowedFailure ? "allowed-fail" : "fail"} ${stepName} (${durationMs}ms)`);
  if (result.status !== 0 && options.check !== false) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
  if (options.capture && result.stderr && options.echoStderr !== false) {
    process.stderr.write(result.stderr);
  }
  return result;
}

function runJson(command, args, options = {}) {
  const result = run(command, args, { ...options, capture: true });
  const stdout = result.stdout ?? "";
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`failed to parse JSON from ${command} ${args.join(" ")}: ${error instanceof Error ? error.message : String(error)}\n${stdout}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function portReachable(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = (reachable) => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePort(reachable);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitForPortClosed(port, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await portReachable(port))) {
      return true;
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 200));
  }
  return false;
}

function stopPreview(pid) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return;
  }
  try {
    if (process.platform !== "win32") {
      process.kill(-pid, "SIGTERM");
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Best-effort cleanup; the post-check below catches leaked previews.
    }
  }
}

function writeEvidence() {
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`[release:smoke] wrote evidence ${reportPath}`);
}

const plannedCommands = [
  "npm pack --json",
  "npm install --global <tarball>",
  "forge --version",
  "forge new smoke-app --template minimal-web --package-manager npm --forge-spec <tarball> --install --no-git",
  "forge generate --json",
  "forge check --json",
  "forge dev --once --json",
  "forge verify --smoke --json --script-timeout-ms 120000",
  "forge agent install codex --force --json",
  "forge agent hooks status --target codex --json",
  "forge agent hooks smoke --target codex --json",
  "forge studio open . --preview-port 5174 --target codex --no-bridge --json",
  "create-forge-app create-smoke-app --template minimal-web --package-manager npm --forge-spec <tarball> --no-install --no-git",
];

try {
  if (dryRun) {
    evidence.ok = true;
    evidence.artifacts.plannedCommands = plannedCommands;
    writeEvidence();
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(0);
  }

  assert(!(await portReachable(previewPort)), `port ${previewPort} is already in use before public smoke`);

  const packOutput = run(npmCommand, ["pack", "--json"], { capture: true, step: "pack tarball" }).stdout ?? "";
  const packed = JSON.parse(packOutput);
  const filename = packed?.[0]?.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("npm pack --json did not report a tarball filename");
  }
  tarballPath = join(repoRoot, filename);
  evidence.artifacts.tarball = tarballPath;

  const globalPrefix = join(tempRoot, "npm-global");
  const globalBin = npmGlobalBin(globalPrefix);
  const smokeEnv = {
    ...process.env,
    NPM_CONFIG_PREFIX: globalPrefix,
    PATH: `${globalBin}${delimiter}${process.env.PATH ?? ""}`,
  };
  run(npmCommand, ["install", "--global", tarballPath], { env: smokeEnv, step: "install global tarball" });
  const globalForge = forgeBin(globalPrefix);
  assert(existsSync(globalForge), `global forge binary was not installed at ${globalForge}`);
  evidence.artifacts.globalForge = globalForge;

  const version = run(globalForge, ["--version"], { capture: true, env: smokeEnv, step: "forge version" }).stdout?.trim();
  assert(version && /^0\.\d+\.\d+/.test(version), `unexpected forge --version output: ${version ?? ""}`);
  evidence.version = version;

  run(globalForge, [
    "new",
    "smoke-app",
    "--template",
    "minimal-web",
    "--package-manager",
    "npm",
    "--forge-spec",
    pathToFileURL(tarballPath).href,
    "--install",
    "--no-git",
  ], { cwd: tempRoot, env: smokeEnv, step: "forge new smoke app" });

  const appRoot = join(tempRoot, "smoke-app");
  evidence.artifacts.appRoot = appRoot;
  runJson(globalForge, ["generate", "--json"], { cwd: appRoot, env: smokeEnv, step: "app generate" });
  runJson(globalForge, ["check", "--json"], { cwd: appRoot, env: smokeEnv, step: "app check" });
  runJson(globalForge, ["dev", "--once", "--json"], { cwd: appRoot, env: smokeEnv, step: "app dev once" });
  runJson(globalForge, ["verify", "--smoke", "--json", "--script-timeout-ms", "120000"], { cwd: appRoot, env: smokeEnv, step: "app verify smoke" });

  runJson(globalForge, ["agent", "install", "codex", "--force", "--json"], { cwd: appRoot, env: smokeEnv, step: "agent install codex" });
  const hookStatusResult = run(globalForge, ["agent", "hooks", "status", "--target", "codex", "--json"], {
    cwd: appRoot,
    env: smokeEnv,
    capture: true,
    allowFailure: true,
    check: false,
    step: "agent hooks status",
  });
  const hookStatus = JSON.parse(hookStatusResult.stdout ?? "{}");
  evidence.artifacts.hookStatus = {
    exitCode: hookStatusResult.status,
    installed: hookStatus.installed === true,
    approvalStatus: hookStatus.approvalStatus ?? null,
  };
  assert(hookStatus.installed === true, "hook status did not report installed hooks");
  assert(
    JSON.stringify(hookStatus.checks ?? []).includes("usesLightweightRunner") ||
      JSON.stringify(hookStatus.checks ?? []).includes("lightweight workspace runner"),
    "hook status did not prove the lightweight runner mode",
  );

  const hookSmoke = runJson(globalForge, ["agent", "hooks", "smoke", "--target", "codex", "--json"], {
    cwd: appRoot,
    env: smokeEnv,
    step: "agent hooks smoke",
  });
  evidence.artifacts.hookSmoke = {
    ok: hookSmoke.ok === true,
    smokeReady: hookSmoke.smokeReady === true,
    trustedNativeReady: hookSmoke.trustedNativeReady === true,
    readinessLevel: hookSmoke.readinessLevel ?? null,
    stdinHangSafe: hookSmoke.hookRunnerProbe?.stdinHangSafe === true,
    approvalRequired: hookSmoke.approvalRequired === true,
    approvalStatus: hookSmoke.approvalStatus ?? null,
    nativeTrustStatus: hookSmoke.nativeTrustStatus ?? null,
  };
  assert(hookSmoke.ok === true && hookSmoke.smokeReady === true, "hook smoke did not pass the canary contract");
  assert(hookSmoke.trustedNativeReady === false, "hook smoke should not claim trusted native readiness from a canary alone");
  assert(hookSmoke.hookRunnerProbe?.stdinHangSafe === true, "hook smoke did not prove stdin hang safety");
  assert(hookSmoke.approvalRequired === false, "hook smoke should accept a visible canary for local editing");
  assert(hookSmoke.approvalStatus === "accepted", "hook smoke should report accepted approval after a visible canary");
  assert(
    hookSmoke.nativeTrustStatus === "waiting-for-native-signal",
    "hook smoke should keep native Codex provenance separate from canary readiness",
  );

  let studioPid;
  try {
    const studio = runJson(globalForge, [
      "studio",
      "open",
      ".",
      "--preview-port",
      String(previewPort),
      "--target",
      "codex",
      "--no-bridge",
      "--json",
    ], { cwd: appRoot, env: smokeEnv, step: "studio open" });
    studioPid = studio.previewAutomation?.pid;
    evidence.artifacts.studio = {
      ok: studio.ok === true,
      previewUrl: studio.preview?.url ?? null,
      previewState: studio.preview?.status?.state ?? null,
      ownerKind: studio.previewAutomation?.owner?.kind ?? null,
      pid: studioPid ?? null,
    };
    assert(studio.ok === true, "studio open did not report ok");
    assert(studio.preview?.url === `http://127.0.0.1:${previewPort}`, "studio open used the wrong preview URL");
    assert(studio.preview?.status?.state === "reachable", "studio preview was not reachable");
    assert(studio.previewAutomation?.owner?.kind === "forge-managed", "studio open did not report managed preview ownership");
    assert(!JSON.stringify(studio).includes("http://127.0.0.1:3765/preview"), "studio open appears to preview Studio itself");
  } finally {
    stopPreview(studioPid);
    assert(await waitForPortClosed(previewPort), `preview port ${previewPort} was still open after cleanup`);
  }

  const agentsMd = readFileSync(join(appRoot, "AGENTS.md"), "utf8");
  assert(agentsMd.includes("forge generate"), "generated app AGENTS.md did not include installed forge commands");
  assert(!agentsMd.includes("node bin/forge.mjs"), "generated app AGENTS.md used framework-local CLI commands");

  run("node", [
    join(repoRoot, "packages", "create-forge-app", "bin", "create-forge-app.mjs"),
    "create-smoke-app",
    "--template",
    "minimal-web",
    "--package-manager",
    "npm",
    "--forge-spec",
    pathToFileURL(tarballPath).href,
    "--no-install",
    "--no-git",
  ], { cwd: tempRoot, env: smokeEnv, step: "create-forge-app no-install smoke" });
  evidence.ok = true;
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  if (tarballPath) {
    rmSync(tarballPath, { force: true });
  }
  evidence.cleanup.previewPortClosed = !(await portReachable(previewPort));
  rmSync(tempRoot, { recursive: true, force: true });
  writeEvidence();
}
