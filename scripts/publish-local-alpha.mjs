import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { assertPublishChannel } from "./release-channel-guard.mjs";

/** Copy positive entries; npm applies the preserved negative files patterns at pack time. */
export function stageLocalPackage(root, staging) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  cpSync(join(root, "package.json"), join(staging, "package.json"));
  for (const entry of pkg.files ?? []) {
    if (typeof entry !== "string" || !entry) throw new Error("Invalid package file entry");
    if (entry.startsWith("!")) continue;
    const path = entry.replace(/\/$/, "");
    const from = resolve(root, path);
    const within = relative(resolve(root), from);
    if (isAbsolute(path) || within === ".." || within.startsWith("../") || within.startsWith("..\\") || /[*?]/.test(path)) {
      throw new Error(`Unsupported positive package file entry: ${entry}`);
    }
    if (!existsSync(from)) throw new Error(`Package file entry does not exist: ${entry}`);
    cpSync(from, join(staging, path), { recursive: true, force: true, dereference: false, verbatimSymlinks: true });
  }
  writeFileSync(join(staging, ".npmignore"), "# Staged publish copy. Package contents are controlled by package.json files.\n");
  return pkg;
}

function main() {
const root = resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const yes = process.argv.includes("--yes");

if (!dryRun && !yes) {
  console.error("Refusing to publish without --yes. Use --dry-run to validate the tarball.");
  process.exit(1);
}

const sourcePackageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const releaseChannel = assertPublishChannel(root).publishTag;
const stagingRoot = mkdtempSync(join(tmpdir(), "forgeos-publish-"));
const staging = join(stagingRoot, "package");

try {
  stageLocalPackage(root, staging);

  const publishArgs = [
    "publish",
    "--access",
    "public",
    "--tag",
    releaseChannel,
    "--provenance=false",
  ];
  if (dryRun) {
    publishArgs.push("--dry-run");
  }

  const result = spawnSync(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/c", "npm", ...publishArgs] : publishArgs, {
    cwd: staging,
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });

  if (result.status !== 0) {
    if (!dryRun) {
      console.error(
        "Local npm publish failed. For ForgeOS releases, prefer `npm run release:publish-alpha` so npm Trusted Publisher/OIDC handles authentication.",
      );
    }
    process.exit(result.status ?? 1);
  }

  console.log(`${dryRun ? "Validated" : "Published"} ${sourcePackageJson.name}@${sourcePackageJson.version} from hardlink-free staging copy ${basename(stagingRoot)}.`);
} finally {
  if (dirname(resolve(stagingRoot)) !== resolve(tmpdir()) || !basename(stagingRoot).startsWith("forgeos-publish-")) throw new Error("Invalid publish staging cleanup path");
  rmSync(stagingRoot, { recursive: true, force: true });
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
