import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const createPkg = JSON.parse(readFileSync(join(root, "packages", "create-forge-app", "package.json"), "utf8"));
const expectedForgeVersion =
  args.find((arg) => arg.startsWith("--expect-forgeos="))?.slice("--expect-forgeos=".length) ??
  pkg.version;
const expectedCreateVersion =
  args.find((arg) => arg.startsWith("--expect-create="))?.slice("--expect-create=".length) ??
  createPkg.version;
const skipCreate = args.includes("--skip-create");
const keep = args.includes("--keep");
const versionAttempts = Number(
  args.find((arg) => arg.startsWith("--version-attempts="))?.slice("--version-attempts=".length) ?? "24",
);
const versionDelayMs = Number(
  args.find((arg) => arg.startsWith("--version-delay-ms="))?.slice("--version-delay-ms=".length) ?? "5000",
);
const publicProofEnv = {
  AI_GATEWAY_API_KEY: "forge-public-smoke-redacted-ai-gateway-key",
  ANTHROPIC_API_KEY: "forge-public-smoke-redacted-anthropic-key",
  OPENAI_API_KEY: "forge-public-smoke-redacted-openai-key",
};

function resolveExecutable(command) {
  if (process.platform !== "win32" || command !== "npm") {
    return command;
  }
  return "npm.cmd";
}

function quoteCmdArg(value) {
  if (/^[A-Za-z0-9_./:@=+-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

function resolveSpawn(command, commandArgs) {
  if (process.platform === "win32" && command === "npm") {
    const commandLine = `call ${[resolveExecutable(command), ...commandArgs].map(quoteCmdArg).join(" ")}`;
    return {
      executable: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/c", commandLine],
    };
  }
  return { executable: resolveExecutable(command), args: commandArgs };
}

function run(command, commandArgs, options = {}) {
  const { executable, args: spawnArgs } = resolveSpawn(command, commandArgs);
  const result = spawnSync(executable, spawnArgs, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      npm_config_yes: "true",
      FORGE_MOCK_AI: "1",
      ...options.env,
    },
  });
  if (result.status !== 0 && options.check !== false) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${commandArgs.join(" ")} failed${details ? `\n${details}` : ""}`);
  }
  return result;
}

function read(command, commandArgs, options = {}) {
  return run(command, commandArgs, { ...options, capture: true }).stdout.trim();
}

function parseJson(text) {
  return JSON.parse(text.trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertVersion(packageSpec, expected) {
  let lastActual = "unresolved";
  for (let attempt = 1; attempt <= versionAttempts; attempt += 1) {
    const result = run("npm", ["view", packageSpec, "version", "--json"], {
      capture: true,
      check: false,
    });
    if (result.status === 0) {
      lastActual = parseJson(result.stdout.trim());
      if (lastActual === expected) {
        console.log(`${packageSpec} => ${lastActual}`);
        return;
      }
    } else {
      lastActual = (result.stderr || result.stdout || "unresolved").trim();
    }

    if (attempt < versionAttempts) {
      console.log(
        `${packageSpec} resolved to ${lastActual}; expected ${expected}. Retrying registry lookup ${attempt}/${versionAttempts}...`,
      );
      await sleep(versionDelayMs);
    }
  }

  throw new Error(`${packageSpec} resolved to ${lastActual}; expected ${expected}`);
}

const tempRoot = mkdtempSync(join(tmpdir(), "forgeos-public-alpha-"));
try {
  await assertVersion("forgeos@alpha", expectedForgeVersion);

  const redteam = parseJson(read("npm", [
    "exec",
    "--yes",
    "--package",
    "forgeos@alpha",
    "--",
    "forge",
    "ai",
    "redteam",
    "--model-level",
    "--json",
  ]));
  if (redteam.exitCode !== 0 || redteam.data?.assurance !== "model-level-mock") {
    throw new Error(`forgeos@alpha model-level redteam failed: ${JSON.stringify(redteam, null, 2)}`);
  }

  const proof = parseJson(read("npm", [
    "exec",
    "--yes",
    "--package",
    "forgeos@alpha",
    "--",
    "forge",
    "security",
    "prove",
    "--full",
    "--json",
  ], { env: publicProofEnv }));
  if (proof.exitCode !== 0 && proof.ok !== true) {
    throw new Error(`forgeos@alpha security prove --full failed: ${JSON.stringify(proof, null, 2)}`);
  }

  if (!skipCreate) {
    await assertVersion("create-forgeos-app@alpha", expectedCreateVersion);
    run("npm", [
      "create",
      "forgeos-app@alpha",
      "smoke-app",
      "--",
      "--template",
      "minimal-web",
      "--no-install",
      "--no-git",
    ], { cwd: tempRoot });
    const appPkg = JSON.parse(readFileSync(join(tempRoot, "smoke-app", "package.json"), "utf8"));
    if (appPkg.dependencies?.forge !== "npm:forgeos@alpha") {
      throw new Error(`created app dependency mismatch: ${JSON.stringify(appPkg.dependencies ?? {})}`);
    }
  }

  console.log("public alpha smoke passed");
} finally {
  if (!keep) {
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`kept ${tempRoot}`);
  }
}
