import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = "https://npm.pkg.github.com";
const packages = [
  {
    sourceDir: repoRoot,
    githubName: "@stahldavid/forgeos",
  },
  {
    sourceDir: join(repoRoot, "packages", "create-forge-app"),
    githubName: "@stahldavid/create-forge-app",
  },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      npm_config_registry: options.registry ?? process.env.npm_config_registry,
    },
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    if (options.allowFailure) {
      return result;
    }
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
  return result;
}

async function scopedPack(sourceDir, githubName, tempRoot) {
  const packResult = run("npm", ["pack", "--json", "--pack-destination", tempRoot], {
    cwd: sourceDir,
    capture: true,
  });
  const packed = JSON.parse(packResult.stdout);
  const filename = packed?.[0]?.filename;
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error(`npm pack did not report a tarball filename for ${sourceDir}`);
  }

  const tarballPath = join(tempRoot, filename);
  const extractDir = join(tempRoot, githubName.replace(/[^\w.-]+/g, "_"));
  run("tar", ["-xzf", tarballPath, "-C", tempRoot]);
  renameSync(join(tempRoot, "package"), extractDir);

  const packageJsonPath = join(extractDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.name = githubName;
  packageJson.repository = {
    type: "git",
    url: "git+https://github.com/Stahldavid/forge.git",
  };
  packageJson.publishConfig = {
    ...(packageJson.publishConfig ?? {}),
    registry,
    access: "public",
  };
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  return {
    dir: extractDir,
    version: packageJson.version,
  };
}

function npmViewExists(packageName, version) {
  const result = run("npm", ["view", `${packageName}@${version}`, "version", "--json", "--registry", registry], {
    capture: true,
    allowFailure: true,
    registry,
  });
  return result.status === 0;
}

const tempRoot = mkdtempSync(join(tmpdir(), "forge-github-package-"));
try {
  for (const pkg of packages) {
    const packed = await scopedPack(pkg.sourceDir, pkg.githubName, tempRoot);
    if (npmViewExists(pkg.githubName, packed.version)) {
      console.log(`${pkg.githubName}@${packed.version} already exists on GitHub Packages; skipping.`);
      continue;
    }

    console.log(`Publishing ${pkg.githubName}@${packed.version} to GitHub Packages...`);
    run("npm", [
      "publish",
      packed.dir,
      "--registry",
      registry,
      "--access",
      "public",
    ], {
      registry,
    });
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
