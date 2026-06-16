import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageDir = resolve(process.argv[2] ?? ".");
const packageJson = JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf8"));
const packageSpec = `${packageJson.name}@${packageJson.version}`;
const allowFirstPublish =
  process.argv.includes("--allow-first-publish") ||
  process.env.FORGE_ALLOW_FIRST_NPM_PUBLISH === "1";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageDir,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });
  return result;
}

const view = run("npm", ["view", packageSpec, "version", "--json"], { capture: true });
if (view.status === 0) {
  console.log(`${packageSpec} already exists on npm; skipping publish.`);
  process.exit(0);
}

const packageView = run("npm", ["view", packageJson.name, "name", "--json"], { capture: true });
if (packageView.status !== 0 && !allowFirstPublish) {
  console.log(
    `${packageJson.name} does not exist on npm yet; skipping first publish. Run this script with --allow-first-publish after npm CLI auth is configured.`,
  );
  process.exit(0);
}

const publish = run("npm", [
  "publish",
  "--access",
  packageJson.publishConfig?.access ?? "public",
  "--tag",
  packageJson.publishConfig?.tag ?? "alpha",
]);

process.exit(publish.status ?? 1);
