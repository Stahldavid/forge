import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { assertPublishChannel, assertVersioningPreMode } from "./release-channel-guard.mjs";

const require = createRequire(import.meta.url);

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function syncVersionSource() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (typeof pkg.version !== "string") {
    throw new Error("package.json version must be a string");
  }

  writeFileSync(
    "src/forge/version.ts",
    [
      `export const FORGEOS_VERSION = ${JSON.stringify(pkg.version)};`,
      "export const GENERATOR_VERSION = FORGEOS_VERSION;",
      "export const CLI_VERSION = FORGEOS_VERSION;",
      "",
    ].join("\n"),
    "utf8",
  );
}

assertVersioningPreMode(".");
runNode(require.resolve("@changesets/cli/bin.js"), ["version"]);
assertPublishChannel(".");
syncVersionSource();
runNode("bin/forge.mjs", ["generate"]);
