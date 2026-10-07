import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

async function stopSmokeBroker(root) {
  const { register } = await import("tsx/esm/api");
  register();
  const { shutdownDeltaBroker } = await import("../src/forge/delta/broker.ts");
  await shutdownDeltaBroker(root); // Verified existing endpoint only; never starts an owner.
}

export async function cleanupOwnedSmokeTemp(root, {
  shutdown = stopSmokeBroker, remove = rmSync,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
} = {}) {
  const target = resolve(root);
  if (!isAbsolute(root) || dirname(target) !== resolve(tmpdir()) || !/^forgeos-pack-smoke-[A-Za-z0-9]+$/.test(basename(target))) {
    throw new Error("packed smoke cleanup path is not an owned temporary directory");
  }
  if (!existsSync(target)) return;
  if (lstatSync(target).isSymbolicLink() || dirname(realpathSync(target)) !== realpathSync(tmpdir())) {
    throw new Error("packed smoke cleanup path escaped the temp directory");
  }
  // CLI scaffolding can open a broker at its cwd before creating the app.
  // Stop every workspace used by this smoke, including the temporary parent.
  await shutdown(target);
  for (const name of ["smoke-app", "create-smoke-app"]) {
    const app = join(target, name);
    if (existsSync(app)) {
      if (lstatSync(app).isSymbolicLink() || !realpathSync(app).startsWith(`${realpathSync(target)}${sep}`)) {
        throw new Error("packed smoke broker path escaped its owned temporary directory");
      }
      await shutdown(app);
    }
  }
  for (let attempt = 0; ; attempt += 1) {
    try { remove(target, { recursive: true, force: true, maxRetries: 0 }); return; }
    catch (error) {
      if (attempt >= 5 || !["EPERM", "EBUSY", "ENOTEMPTY", "EACCES"].includes(error?.code)) throw error;
      await sleep(200 * (attempt + 1));
    }
  }
}

async function main() {
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
let smokeFailure;
let cleanupFailure;
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
  return process.platform === "win32"
    ? join(prefix, "node_modules", "forgeos", "bin", "forge.mjs")
    : join(prefix, "bin", "forge");
}

function run(command, args, options = {}) {
  const stepName = options.step ?? `${command} ${args.slice(0, 3).join(" ")}`.trim();
  const startedAt = Date.now();
  console.log(`[release:smoke] start ${stepName}`);
  const argv =
    process.platform === "win32" && command === npmCommand
      ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/c", command, ...args]]
      : process.platform === "win32" && command.endsWith("forge.mjs")
        ? [process.execPath, [command, ...args]]
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
      spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore", windowsHide: true, timeout: 5000,
      });
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
    await cleanupOwnedSmokeTemp(tempRoot);
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

  const programProbe = join(tempRoot, "program-workflow-probe.mjs");
  writeFileSync(programProbe, [
    'import {createRequire} from "node:module";',
    'import {readFileSync} from "node:fs";',
    'import {join} from "node:path";',
    'import {pathToFileURL} from "node:url";',
    'const root = process.argv[2], require = createRequire(join(root,"package.json"));',
    'const {register} = await import(pathToFileURL(require.resolve("tsx/esm/api")).href); register();',
    'const pkg = JSON.parse(readFileSync(join(root,"package.json"),"utf8"));',
    'const dsl = await import(pathToFileURL(join(root,pkg.exports["./agent-fabric/workflows"])).href);',
    'const {validateWorkflowProgram} = await import(pathToFileURL(join(root,"src/forge/agent-fabric/program-contract.ts")).href);',
    'const source = readFileSync(join(root,"examples/agent-fabric-v2/migrate.workflow.ts"),"utf8");',
    'const registry = JSON.parse(readFileSync(join(root,"examples/agent-fabric-v2/registry.example.json"),"utf8"));',
    'const program = dsl.lowerWorkflowSource(source); validateWorkflowProgram(program,registry);',
    'console.log(JSON.stringify({ok:true,version:pkg.version,steps:program.steps.length}));',
  ].join("\n"));
  evidence.artifacts.programWorkflow = JSON.parse(run(process.execPath, [programProbe, join(globalPrefix, "node_modules", "forgeos")], { capture: true, env: smokeEnv, step: "packed program DSL and example" }).stdout);

  const version = run(globalForge, ["--version"], { capture: true, env: smokeEnv, step: "forge version" }).stdout?.trim();
  assert(version && /^0\.\d+\.\d+/.test(version), `unexpected forge --version output: ${version ?? ""}`);
  evidence.version = version;

  // Exercise maps from the installed tarball in an external repository with no Forge runtime.
  const repositoryRoot = join(tempRoot, "repository-pilot");
  mkdirSync(join(repositoryRoot, "web"), { recursive: true });
  mkdirSync(join(repositoryRoot, "api"), { recursive: true });
  writeFileSync(join(repositoryRoot, "web", "package.json"), JSON.stringify({ name: "map-web", dependencies: { vue: "3" } }));
  writeFileSync(join(repositoryRoot, "web", "App.vue"), '<script setup lang="tsx">const view = () => <div>Items</div>; async function load() { return fetch("/api/items"); }</script><template><button @click="load">Load</button></template>');
  writeFileSync(join(repositoryRoot, "api", "pom.xml"), '<project><artifactId>map-api</artifactId></project>');
  writeFileSync(join(repositoryRoot, "api", "Api.java"), '@RestController @RequestMapping("/api") class Api { @GetMapping("/items") public String items() { return "ok"; } }');
  writeFileSync(join(repositoryRoot, "api", "Dockerfile"), 'FROM eclipse-temurin:21-jre\nCOPY target/api.jar /app.jar\n');
  writeFileSync(join(repositoryRoot, "compose.yaml"), 'services:\n  api:\n    build: ./api\n');
  const discovered = runJson(globalForge, ["manifest", "discover", "--write", "--json"], { cwd: repositoryRoot, env: smokeEnv, step: "repository manifest discovery" });
  assert(discovered.manifest?.kind === "repository", "installed tarball did not discover repository manifest");
  runJson(globalForge, ["manifest", "validate", "forge.manifest.json", "--json"], { cwd: repositoryRoot, env: smokeEnv, step: "repository manifest validation" });
  const mapped = runJson(globalForge, ["repository", "analyze", "--write", "--json"], { cwd: repositoryRoot, env: smokeEnv, step: "repository analysis" });
  const routes = runJson(globalForge, ["repository", "context", "--query", "routes", "--json"], { cwd: repositoryRoot, env: smokeEnv, step: "repository route context" });
  assert(mapped.ok && routes.ok && routes.items.some(item => item.kind === "endpoint"), "installed package repository map failed");
  assert(mapped.snapshot.nodes.some(node => node.kind === "build-stage"), "Java component Dockerfile missing from installed map");
  assert(!existsSync(join(repositoryRoot, ".forge", "delta")) && !existsSync(join(repositoryRoot, ".gitignore")), "map commands wrote recorder or gitignore side effects");
  evidence.artifacts.repository = { ok: true, snapshotId: mapped.snapshotId, nodes: mapped.snapshot.nodes.length, edges: mapped.snapshot.edges.length, routeItems: routes.total };

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
  assert(hookSmoke.approvalRequired === true, "hook smoke must not treat a canary as Codex hook approval");
  assert(hookSmoke.approvalStatus === "unverified", "hook smoke must report native approval as unverified after a canary");
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
  smokeFailure = error;
  evidence.error = error instanceof Error ? error.message : String(error);
} finally {
  evidence.cleanup.previewPortClosed = !(await portReachable(previewPort));
  try {
    await cleanupOwnedSmokeTemp(tempRoot);
    if (tarballPath) {
      rmSync(tarballPath, { force: true });
    }
  } catch (cleanupError) {
    cleanupFailure = cleanupError;
    evidence.ok = false;
    evidence.cleanup.error = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    evidence.error ??= cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  }
  writeEvidence();
}
if (smokeFailure) throw smokeFailure;
if (cleanupFailure) throw cleanupFailure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
