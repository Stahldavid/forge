import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = mkdtempSync(join(tmpdir(), "forgeos-pack-smoke-"));
const npmCommand = "npm";
let tarballPath = "";

function run(command, args, options = {}) {
  const argv =
    process.platform === "win32" && command === npmCommand
      ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/c", command, ...args]]
      : [command, args];
  const result = spawnSync(argv[0], argv[1], {
    cwd: options.cwd ?? repoRoot,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
  if (options.capture && result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result.stdout ?? "";
}

try {
  const packOutput = run(npmCommand, ["pack", "--json"], { capture: true });
  const packed = JSON.parse(packOutput);
  const filename = packed?.[0]?.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error("npm pack --json did not report a tarball filename");
  }
  tarballPath = join(repoRoot, filename);

  run("node", [
    join(repoRoot, "bin", "forge.mjs"),
    "new",
    "smoke-app",
    "--template",
    "minimal-web",
    "--package-manager",
    "npm",
    "--forge-spec",
    pathToFileURL(tarballPath).href,
    "--install",
    "--no-git",
  ], { cwd: tempRoot });

  const appRoot = join(tempRoot, "smoke-app");
  run(npmCommand, ["run", "generate"], { cwd: appRoot });
  run(npmCommand, ["run", "forge", "--", "dev", "--once", "--json"], { cwd: appRoot });
  run(npmCommand, [
    "run",
    "forge",
    "--",
    "verify",
    "--smoke",
    "--json",
    "--script-timeout-ms",
    "120000",
  ], { cwd: appRoot });
} finally {
  if (tarballPath) {
    rmSync(tarballPath, { force: true });
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
