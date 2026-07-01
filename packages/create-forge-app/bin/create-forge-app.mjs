#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const DEFAULT_FORGE_SPEC = "npm:forgeos@alpha";

function readCreateVersion() {
  try {
    const binDir = dirname(fileURLToPath(import.meta.url));
    const parsed = JSON.parse(readFileSync(join(binDir, "..", "package.json"), "utf8"));
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const CREATE_VERSION = readCreateVersion();

function usage() {
  return `create-forge-app ${CREATE_VERSION}

Usage:
  npm create forgeos-app@alpha <app-name> -- --template minimal-web
  npm create forgeos-app@alpha . -- --template minimal-web
  npm create forgeos-app@alpha <app-name> -- --template nuxt-web
  npm create forgeos-app@alpha <app-name> -- --template agent-workroom
  npm create forgeos-app@alpha <app-name> -- --template b2b-support-web
  npm create forgeos-app@alpha <app-name> -- --template vendor-access

Options passed through to ForgeOS:
  --template <name>          minimal-web | nuxt-web | agent-workroom | b2b-support-web | vendor-access
  --package-manager <name>   npm | pnpm | yarn | bun
  --install                  install dependencies after scaffolding
  --no-install               scaffold only
  --git                      initialize git (default; accepted for explicit scripts)
  --no-git                   skip git init
  --forge-spec <spec>        dependency spec written as the generated app's forge alias
  --local-forge              use a local ForgeOS checkout when running from the monorepo

Defaults:
  --template minimal-web
  --package-manager npm
  --forge-spec ${DEFAULT_FORGE_SPEC}
`;
}

function hasOption(args, name) {
  return args.includes(name) || args.some((arg) => arg.startsWith(`${name}=`));
}

function firstPositional(args) {
  return args.find((arg) => !arg.startsWith("-"));
}

function packageNameAt(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

function findLocalForgeBin() {
  if (process.env.CREATE_FORGE_APP_FORGE_BIN) {
    return process.env.CREATE_FORGE_APP_FORGE_BIN;
  }

  let current = dirname(fileURLToPath(import.meta.url));
  const root = parse(current).root;
  while (true) {
    const dependencyBin = join(current, "node_modules", "forgeos", "bin", "forge.mjs");
    if (existsSync(dependencyBin)) {
      return dependencyBin;
    }

    const monorepoBin = join(current, "bin", "forge.mjs");
    if (existsSync(monorepoBin) && packageNameAt(current) === "forgeos") {
      return monorepoBin;
    }

    const parent = dirname(current);
    if (parent === current || current === root) {
      return null;
    }
    current = parent;
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32" && command.endsWith(".cmd"),
  });
  if (result.error) {
    console.error(`create-forge-app: failed to run ${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function buildForgeNewArgs(inputArgs) {
  const args = [...inputArgs];

  if (!hasOption(args, "--template")) {
    args.push("--template", "minimal-web");
  }
  if (!hasOption(args, "--package-manager")) {
    args.push("--package-manager", "npm");
  }
  if (!hasOption(args, "--forge-spec") && !hasOption(args, "--local-forge")) {
    args.push("--forge-spec", DEFAULT_FORGE_SPEC);
  }

  return ["new", ...args];
}

const inputArgs = process.argv.slice(2);
if (inputArgs.length === 0 || hasOption(inputArgs, "--help") || hasOption(inputArgs, "-h")) {
  console.log(usage());
  process.exit(inputArgs.length === 0 ? 1 : 0);
}

if (!firstPositional(inputArgs)) {
  console.error("create-forge-app: missing app name\n");
  console.error(usage());
  process.exit(1);
}

const forgeArgs = buildForgeNewArgs(inputArgs);
const forgeBin = findLocalForgeBin();

if (forgeBin) {
  process.exit(run(process.execPath, [forgeBin, ...forgeArgs]));
}

process.exit(
  run(npmCommand(), [
    "exec",
    "--yes",
    "--package",
    "forgeos@alpha",
    "--",
    "forge",
    ...forgeArgs,
  ]),
);
