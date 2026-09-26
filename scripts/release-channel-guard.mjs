import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${label} at ${path}: ${detail}`);
  }
}

function packageMetadata(packageDir) {
  const packagePath = resolve(packageDir, "package.json");
  const pkg = readJson(packagePath, "package metadata");
  if (typeof pkg.name !== "string" || pkg.name.length === 0) {
    throw new Error(`${packagePath} must declare a package name`);
  }
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error(`${packagePath} must declare a package version`);
  }
  return { pkg, packagePath };
}

export function prereleaseTag(version) {
  const withoutBuild = String(version).split("+", 1)[0];
  const separator = withoutBuild.indexOf("-");
  if (separator === -1) {
    return null;
  }
  const [tag] = withoutBuild.slice(separator + 1).split(".");
  return tag || null;
}

export function assertPublishChannel(packageDir = ".") {
  const { pkg, packagePath } = packageMetadata(packageDir);
  const publishTag = pkg.publishConfig?.tag;
  if (typeof publishTag !== "string" || publishTag.length === 0) {
    throw new Error(`${packagePath} must declare publishConfig.tag`);
  }

  const versionTag = prereleaseTag(pkg.version);
  if (publishTag === "latest") {
    if (versionTag !== null) {
      throw new Error(
        `${pkg.name}@${pkg.version} is a prerelease and cannot be published through the stable latest channel`,
      );
    }
  } else if (versionTag !== publishTag) {
    throw new Error(
      `${pkg.name}@${pkg.version} does not match publishConfig.tag=${publishTag}; ` +
      `expected a -${publishTag}.* prerelease before publication`,
    );
  }

  return { name: pkg.name, version: pkg.version, publishTag };
}

export function assertVersioningPreMode(rootDir = ".") {
  const { pkg } = packageMetadata(rootDir);
  const versionTag = prereleaseTag(pkg.version);
  if (versionTag === null) {
    return { name: pkg.name, version: pkg.version, prerelease: null };
  }

  const preStatePath = resolve(rootDir, ".changeset", "pre.json");
  const preState = readJson(preStatePath, "Changesets prerelease state");
  if (preState.mode !== "pre" || preState.tag !== versionTag) {
    throw new Error(
      `${pkg.name}@${pkg.version} is on the ${versionTag} prerelease line, but ${preStatePath} ` +
      `must have mode=pre and tag=${versionTag} before running changeset version`,
    );
  }
  if (!Array.isArray(preState.changesets)) {
    throw new Error(`${preStatePath} must contain a changesets array`);
  }
  if (
    preState.initialVersions === null ||
    typeof preState.initialVersions !== "object" ||
    typeof preState.initialVersions[pkg.name] !== "string"
  ) {
    throw new Error(`${preStatePath} must record an initial version for ${pkg.name}`);
  }

  return { name: pkg.name, version: pkg.version, prerelease: versionTag };
}

function main() {
  const mode = process.argv[2] ?? "publish";
  const packageDir = process.argv[3] ?? ".";
  if (mode === "publish") {
    const result = assertPublishChannel(packageDir);
    console.log(`Release channel OK: ${result.name}@${result.version} -> ${result.publishTag}`);
    return;
  }
  if (mode === "version") {
    const result = assertVersioningPreMode(packageDir);
    console.log(
      result.prerelease === null
        ? `Versioning state OK: ${result.name}@${result.version} is stable`
        : `Versioning state OK: ${result.name}@${result.version} remains on ${result.prerelease}`,
    );
    return;
  }
  throw new Error(`Unknown release-channel guard mode: ${mode}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
