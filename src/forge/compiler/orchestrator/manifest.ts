import { join } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
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
  nodeFileSystem.mkdirp(cacheDir);
  const path = manifestPath(cacheDir);

  const raw = nodeFileSystem.readText(path);
  if (raw !== null) {
    try {
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
      // fall through to the default manifest below
    }
  }
  return {
    schemaVersion: ORCHESTRATOR_MANIFEST_VERSION,
    fileHashes: {},
  };
}

export function saveManifest(
  cacheDir: string,
  manifest: OrchestratorManifest,
): void {
  const path = manifestPath(cacheDir);

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

  nodeFileSystem.writeText(path, `${canonicalJson(payload)}\n`);
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
