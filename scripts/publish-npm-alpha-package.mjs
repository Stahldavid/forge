import { appendFileSync, readFileSync } from "node:fs";
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
    shell: process.platform === "win32",
  });
  return result;
}

function output(values) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n",
    "utf8",
  );
}

const view = run("npm", ["view", packageSpec, "version", "--json"], { capture: true });
if (view.status === 0) {
  console.log(`${packageSpec} already exists on npm; skipping publish.`);
  output({ exists: "true", published: "false", skipped: "true" });
  process.exit(0);
}

const packageView = run("npm", ["view", packageJson.name, "name", "--json"], { capture: true });
if (packageView.status !== 0 && !allowFirstPublish) {
  console.log(
    `${packageJson.name} does not exist on npm yet; skipping first publish. Run this script with --allow-first-publish after npm CLI auth is configured.`,
  );
  output({ exists: "false", published: "false", skipped: "true" });
  process.exit(0);
}

const publish = run("npm", [
  "publish",
  "--access",
  packageJson.publishConfig?.access ?? "public",
  "--tag",
  packageJson.publishConfig?.tag ?? "alpha",
]);

output({
  exists: "false",
  published: publish.status === 0 ? "true" : "false",
  skipped: "false",
});
process.exit(publish.status ?? 1);
