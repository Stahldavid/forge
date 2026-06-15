import { join, relative } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import type { PackageApi } from "../types/package-graph.ts";
import { readTextFile } from "./read-file.ts";

export function hashPackageJson(installPath: string): string {
  const packageJsonPath = join(installPath, "package.json");
  return hashStable(readTextFile(packageJsonPath));
}

/** Fast cache-key fingerprint: one stat per package.json instead of reading contents. */
export function hashPackageJsonForCache(installPath: string): string {
  const packageJsonPath = join(installPath, "package.json");
  const stat = nodeFileSystem.stat(packageJsonPath);
  if (stat !== null) {
    return hashStable(`stat:${stat.size}:${stat.mtimeMs}`);
  }
  return hashPackageJson(installPath);
}

export function hashDtsFiles(installPath: string): string {
  const files = collectDtsFiles(installPath).sort((a, b) => a.localeCompare(b));
  const parts: string[] = [];
  for (const file of files) {
    const rel = relative(installPath, file).replace(/\\/g, "/");
    parts.push(rel);
    parts.push(hashStable(readTextFile(file)));
  }
  return hashStable(parts.join("\0"));
}

/** Fast cache-key fingerprint using file stat metadata instead of reading every .d.ts body. */
export function hashDtsFilesForCache(installPath: string): string {
  const files = collectDtsFiles(installPath).sort((a, b) => a.localeCompare(b));
  const parts: string[] = [];
  for (const file of files) {
    const rel = relative(installPath, file).replace(/\\/g, "/");
    const stat = nodeFileSystem.stat(file);
    parts.push(rel);
    parts.push(`${stat?.size ?? 0}:${stat?.mtimeMs ?? 0}`);
  }
  return hashStable(parts.join("\0"));
}

function collectDtsFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of nodeFileSystem.readDir(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory) {
      if (entry.name === "node_modules") {
        continue;
      }
      files.push(...collectDtsFiles(full));
    } else if (entry.name.endsWith(".d.ts")) {
      files.push(full);
    }
  }

  return files;
}

export function computeContentChecksum(
  packageJsonHash: string,
  dtsFilesHash: string,
  api: Pick<
    PackageApi,
    | "entrypoints"
    | "resolutionMode"
    | "source"
    | "runtimeShape"
    | "runtimeTypeMismatches"
    | "runtimeCompatibility"
    | "metadata"
  >,
): string {
  const payload = {
    packageJsonHash,
    dtsFilesHash,
    resolutionMode: api.resolutionMode,
    source: api.source,
    runtimeShape: api.runtimeShape ?? null,
    runtimeTypeMismatches: api.runtimeTypeMismatches,
    runtimeCompatibility: api.runtimeCompatibility,
    metadata: api.metadata,
    entrypoints: api.entrypoints.map((ep) => ({
      subpath: ep.subpath,
      conditions: ep.conditions,
      patternBacked: ep.patternBacked,
      dtsPath: ep.dtsPath,
      resolutionTrace: ep.resolutionTrace,
      exports: ep.exports.map((ex) => ({
        name: ex.name,
        kind: ex.kind,
        signature: ex.signature,
        overloads: ex.overloads,
        declarations: ex.declarations,
        jsdoc: ex.jsdoc,
        examples: ex.examples,
      })),
    })),
  };

  return hashStable(canonicalJson(payload));
}
