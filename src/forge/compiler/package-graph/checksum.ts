import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import type { PackageApi } from "../types/package-graph.ts";
import { readTextFile } from "./read-file.ts";

export function hashPackageJson(installPath: string): string {
  const packageJsonPath = join(installPath, "package.json");
  return hashStable(readTextFile(packageJsonPath));
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

function collectDtsFiles(dir: string): string[] {
  const files: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === "node_modules") {
        continue;
      }
      files.push(...collectDtsFiles(full));
    } else if (entry.endsWith(".d.ts")) {
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
    "entrypoints" | "resolutionMode" | "source" | "runtimeShape"
  >,
): string {
  const payload = {
    packageJsonHash,
    dtsFilesHash,
    resolutionMode: api.resolutionMode,
    source: api.source,
    runtimeShape: api.runtimeShape ?? null,
    entrypoints: api.entrypoints.map((ep) => ({
      subpath: ep.subpath,
      conditions: ep.conditions,
      patternBacked: ep.patternBacked,
      dtsPath: ep.dtsPath,
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
