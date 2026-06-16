import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(command, args) {
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
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

run("changeset", ["version"]);
syncVersionSource();
