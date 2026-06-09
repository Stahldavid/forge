import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppGraph } from "../types/app-graph.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import {
  ORCHESTRATOR_MANIFEST_VERSION,
  type OrchestratorManifest,
} from "./types.ts";

const MANIFEST_FILENAME = "manifest.json";

export function manifestPath(cacheDir: string): string {
  return join(cacheDir, MANIFEST_FILENAME);
}

export function loadManifest(cacheDir: string): OrchestratorManifest {
  mkdirSync(cacheDir, { recursive: true });
  const path = manifestPath(cacheDir);

  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as OrchestratorManifest;
    return {
      schemaVersion: parsed.schemaVersion ?? ORCHESTRATOR_MANIFEST_VERSION,
      fileHashes: parsed.fileHashes ?? {},
      ...(parsed.priorAppGraph !== undefined
        ? { priorAppGraph: parsed.priorAppGraph }
        : {}),
      ...(parsed.inputFingerprint !== undefined
        ? { inputFingerprint: parsed.inputFingerprint }
        : {}),
    };
  } catch {
    return {
      schemaVersion: ORCHESTRATOR_MANIFEST_VERSION,
      fileHashes: {},
    };
  }
}

export function saveManifest(
  cacheDir: string,
  manifest: OrchestratorManifest,
): void {
  mkdirSync(cacheDir, { recursive: true });
  const path = manifestPath(cacheDir);
  const tempPath = `${path}.tmp`;

  const payload: OrchestratorManifest = {
    schemaVersion: ORCHESTRATOR_MANIFEST_VERSION,
    fileHashes: manifest.fileHashes,
    ...(manifest.priorAppGraph !== undefined
      ? { priorAppGraph: manifest.priorAppGraph }
      : {}),
    ...(manifest.inputFingerprint !== undefined
      ? { inputFingerprint: manifest.inputFingerprint }
      : {}),
  };

  writeFileSync(tempPath, `${canonicalJson(payload)}\n`, "utf8");
  try {
    renameSync(tempPath, path);
  } catch {
    writeFileSync(path, `${canonicalJson(payload)}\n`, "utf8");
  }
}

export function updateManifestAfterWrite(
  manifest: OrchestratorManifest,
  fileHashes: Record<string, string>,
  priorAppGraph: AppGraph,
  inputFingerprint: string,
): OrchestratorManifest {
  return {
    ...manifest,
    fileHashes: { ...manifest.fileHashes, ...fileHashes },
    priorAppGraph,
    inputFingerprint,
  };
}
