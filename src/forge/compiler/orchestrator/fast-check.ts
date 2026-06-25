import { join, relative } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import { forgeDrift, forgeOrphanedGeneratedFile } from "../diagnostics/create.ts";
import { BARREL_INDEX_PATH, FORGE_LOCK_PATH, GENERATED_DIR } from "../emitter/constants.ts";
import { hashStable } from "../primitives/hash.ts";
import { stripDeterministicHeader } from "../primitives/header.ts";
import type { GenerateResult } from "../types/cli.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import { discover } from "./discover.ts";
import { loadManifest } from "./manifest.ts";
import { ORCHESTRATOR_MANIFEST_VERSION } from "./types.ts";

export type FastGenerateCheckResult =
  | {
      kind: "hit";
      result: GenerateResult;
    }
  | {
      kind: "miss";
      reason: string;
    };

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function readBodyHash(workspaceRoot: string, relativePath: string): string | null {
  const absolute = join(workspaceRoot, relativePath);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  return hashStable(stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? "")));
}

function walkGeneratedFiles(workspaceRoot: string, dir = GENERATED_DIR): string[] {
  const absolute = join(workspaceRoot, dir);
  if (!nodeFileSystem.exists(absolute)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of nodeFileSystem.readDir(absolute)) {
    const child = join(absolute, entry.name);
    const rel = normalizePath(relative(workspaceRoot, child));
    if (entry.isDirectory) {
      files.push(...walkGeneratedFiles(workspaceRoot, rel));
    } else {
      files.push(rel);
    }
  }
  return files.sort();
}

export function runFastGenerateCheck(workspaceRootInput: string): FastGenerateCheckResult {
  const workspaceRoot = workspaceRootInput.replace(/\\/g, "/");
  const cacheDir = join(workspaceRoot, ".forge", "cache");
  const manifest = loadManifest(cacheDir);
  const trackedFiles = Object.keys(manifest.fileHashes).sort();

  if (manifest.schemaVersion !== ORCHESTRATOR_MANIFEST_VERSION) {
    return { kind: "miss", reason: "manifest schema version changed" };
  }
  if (!manifest.inputFingerprint || trackedFiles.length === 0) {
    return { kind: "miss", reason: "manifest missing input fingerprint or file hashes" };
  }
  if (!manifest.fileHashes[BARREL_INDEX_PATH] || !manifest.fileHashes[FORGE_LOCK_PATH]) {
    return { kind: "miss", reason: "manifest missing critical generated file hashes" };
  }

  const priorSourcesByPath = new Map(
    (manifest.sourceSnapshot ?? []).map((source) => [source.path, source]),
  );
  const ctx = discover({
    workspaceRoot,
    priorSourceIndex: manifest.sourceFileIndex,
    priorSourcesByPath,
  });

  if (manifest.inputFingerprint !== ctx.inputFingerprint) {
    return { kind: "miss", reason: "workspace input fingerprint changed" };
  }

  const changed: string[] = [];
  const unchanged: string[] = [];
  const warnings: Diagnostic[] = [];
  const errors: Diagnostic[] = [];

  for (const file of trackedFiles) {
    const actualHash = readBodyHash(workspaceRoot, file);
    if (actualHash === manifest.fileHashes[file]) {
      unchanged.push(file);
    } else {
      changed.push(file);
      warnings.push(forgeDrift(file));
    }
  }

  const trackedGenerated = new Set(
    trackedFiles.filter((file) => file.startsWith(`${GENERATED_DIR}/`)),
  );
  for (const generatedFile of walkGeneratedFiles(workspaceRoot)) {
    if (!trackedGenerated.has(generatedFile)) {
      errors.push(forgeOrphanedGeneratedFile(generatedFile));
    }
  }

  return {
    kind: "hit",
    result: {
      changed,
      unchanged,
      warnings,
      errors,
      cache: {
        strategy: "generated-check",
        result: "hit",
      },
      exitCode: changed.length > 0 || errors.length > 0 ? 1 : 0,
      ...(changed.length > 0 || errors.length > 0 ? { failureKind: "generated_drift" } : {}),
    },
  };
}
