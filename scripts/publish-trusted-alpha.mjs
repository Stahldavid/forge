import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const noWatch = args.includes("--no-watch");
const refArg = args.find((arg) => arg.startsWith("--ref="));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });
}

function read(command, commandArgs) {
  const result = run(command, commandArgs);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  }
  return result.stdout.trim();
}

function commandExists(command) {
  const result = run(command, ["--version"]);
  return result.status === 0;
}

if (!commandExists("gh")) {
  console.error("GitHub CLI (`gh`) is required for trusted publishing.");
  process.exit(1);
}

const packageSpec = `${packageJson.name}@${packageJson.version}`;
const npmView = run("npm", ["view", packageSpec, "version", "--json"]);
if (npmView.status === 0) {
  console.log(`${packageSpec} already exists on npm. Nothing to publish.`);
  process.exit(0);
}

const ref = refArg?.slice("--ref=".length) || read("git", ["branch", "--show-current"]);
if (!ref) {
  console.error("Could not determine the current git branch. Pass --ref=<branch-or-tag>.");
  process.exit(1);
}

const dirty = run("git", ["diff", "--quiet"]).status !== 0;
const staged = run("git", ["diff", "--cached", "--quiet"]).status !== 0;
if (dirty || staged) {
  console.error("Refusing to publish from a dirty working tree. Commit and push first.");
  process.exit(1);
}

run("git", ["fetch", "origin", ref], { stdio: "ignore" });
const localHead = read("git", ["rev-parse", "HEAD"]);
const remoteHeadResult = run("git", ["rev-parse", `origin/${ref}`]);
if (remoteHeadResult.status === 0 && remoteHeadResult.stdout.trim() !== localHead) {
  console.error(`Refusing to publish: HEAD is not pushed to origin/${ref}.`);
  process.exit(1);
}

console.log(`Dispatching trusted npm publish for ${packageSpec} from ${ref}...`);
const dispatch = run("gh", ["workflow", "run", "publish.yml", "--ref", ref], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.stdout.write(dispatch.stdout || "");
if (dispatch.status !== 0) {
  process.exit(dispatch.status ?? 1);
}

const runId = dispatch.stdout.match(/actions\/runs\/(\d+)/)?.[1];
if (!noWatch && runId) {
  const watch = run("gh", ["run", "watch", runId, "--exit-status"], {
    stdio: "inherit",
  });
  process.exit(watch.status ?? 1);
}

if (!runId) {
  console.log("Workflow dispatched. Use `gh run list --workflow publish.yml --limit 1` to follow it.");
}
