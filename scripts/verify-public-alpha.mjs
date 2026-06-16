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

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    shell: process.platform === "win32",
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

function read(command, commandArgs) {
  return run(command, commandArgs, { capture: true }).stdout.trim();
}

function parseJson(text) {
  return JSON.parse(text.trim());
}

function assertVersion(packageSpec, expected) {
  const actual = parseJson(read("npm", ["view", packageSpec, "version", "--json"]));
  if (actual !== expected) {
    throw new Error(`${packageSpec} resolved to ${actual}; expected ${expected}`);
  }
  console.log(`${packageSpec} => ${actual}`);
}

const tempRoot = mkdtempSync(join(tmpdir(), "forgeos-public-alpha-"));
try {
  assertVersion("forgeos@alpha", expectedForgeVersion);

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
  ]));
  if (proof.exitCode !== 0 && proof.ok !== true) {
    throw new Error(`forgeos@alpha security prove --full failed: ${JSON.stringify(proof, null, 2)}`);
  }

  if (!skipCreate) {
    assertVersion("create-forgeos-app@alpha", expectedCreateVersion);
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
