#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entrypoint = join(root, "src", "forge", "cli", "main.ts");

let tsImport;
try {
  ({ tsImport } = await import("tsx/esm/api"));
} catch {
  console.error("error: Forge requires the 'tsx' package to run under Node.");
  console.error("Install dependencies with your package manager, then retry.");
  process.exit(1);
}

const module = await tsImport(pathToFileURL(entrypoint).href, import.meta.url);
const exitCode = await module.main(process.argv.slice(2));
process.exit(exitCode);
