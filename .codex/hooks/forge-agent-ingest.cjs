#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const event = process.argv[2];
if (!event) {
  process.stderr.write("usage: forge-agent-ingest.cjs <CodexHookEvent>\n");
  process.exit(2);
}

const gitRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
const root = gitRoot.status === 0 ? gitRoot.stdout.trim() : process.cwd();
const stdin = require("node:fs").readFileSync(0, "utf8");
const result = spawnSync(process.execPath, [join(root, "bin", "forge.mjs"), "agent", "ingest", "codex", "--event", event, "--json"], {
  cwd: root,
  input: stdin,
  stdio: ["pipe", "inherit", "inherit"],
});

process.exit(result.status ?? 1);
