import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const yes = process.argv.includes("--yes");

if (!dryRun && !yes) {
  console.error("Refusing to publish without --yes. Use --dry-run to validate the tarball.");
  process.exit(1);
}

const sourcePackageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const stagingRoot = mkdtempSync(join(tmpdir(), "forgeos-publish-"));
const staging = join(stagingRoot, "package");

function copyIntoStaging(relativePath) {
  const from = join(root, relativePath);
  const to = join(staging, relativePath);
  if (!existsSync(from)) {
    throw new Error(`Package file entry does not exist: ${relativePath}`);
  }
  cpSync(from, to, {
    recursive: true,
    force: true,
    errorOnExist: false,
    dereference: false,
    verbatimSymlinks: true,
  });
}

try {
  cpSync(join(root, "package.json"), join(staging, "package.json"), {
    recursive: false,
    force: true,
  });

  for (const entry of sourcePackageJson.files ?? []) {
    copyIntoStaging(entry.replace(/\/$/, ""));
  }

  writeFileSync(
    join(staging, ".npmignore"),
    "# Staged publish copy. Package contents are controlled by package.json files.\n",
  );

  const publishArgs = [
    "publish",
    "--access",
    "public",
    "--tag",
    "alpha",
    "--provenance=false",
  ];
  if (dryRun) {
    publishArgs.push("--dry-run");
  }

  const result = spawnSync("cmd.exe", ["/d", "/c", "npm", ...publishArgs], {
    cwd: staging,
    stdio: "inherit",
    env: process.env,
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
  rmSync(stagingRoot, { recursive: true, force: true });
}
