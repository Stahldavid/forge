#!/usr/bin/env node
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const version = typeof pkg.version === "string" ? pkg.version : "unknown";
  if (args.includes("--json")) {
    console.log(JSON.stringify({
      version,
      cliVersion: version,
      forgeosVersion: version,
    }, null, 2));
  } else {
    console.log(version);
  }
  process.exit(0);
}

const entrypoint = join(root, "src", "forge", "cli", "main.ts");

let register;
try {
  ({ register } = await import("tsx/esm/api"));
} catch {
  console.error("error: Forge requires the 'tsx' package to run under Node.");
  console.error("Install dependencies with your package manager, then retry.");
  process.exit(1);
}

register();
const module = await import(pathToFileURL(entrypoint).href);
const exitCode = await module.main(process.argv.slice(2));
process.exit(exitCode);
