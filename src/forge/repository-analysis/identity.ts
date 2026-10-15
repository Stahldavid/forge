import { createHash } from "node:crypto";
import { REPOSITORY_ANALYZER_VERSION, type RepositorySnapshot } from "./types.ts";
import type { RepositoryManifest } from "../repository-manifest/types.ts";

function hash(value: unknown): string {
  // Stream canonical JSON so a partition-backed graph is never copied into one
  // canonical object tree or a hundreds-of-megabytes serialization buffer.
  const digest = createHash("sha256");
  let buffer = "";
  const emit = (text: string) => { buffer += text; if (buffer.length >= 65536) { digest.update(buffer); buffer = ""; } };
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      emit("[");
      for (let index = 0; index < item.length; index++) { if (index) emit(","); visit(item[index] === undefined ? null : item[index]); }
      emit("]");
    } else if (item && typeof item === "object") {
      emit("{"); let first = true;
      // JSON.stringify enumerates integer-index object keys numerically, even
      // after the old canonical Object.fromEntries inserted them lexically.
      const indexKey = (key: string) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < 4294967295;
      for (const key of Object.keys(item).sort((a, b) => indexKey(a) && indexKey(b) ? Number(a) - Number(b) : indexKey(a) ? -1 : indexKey(b) ? 1 : a.localeCompare(b))) {
        const child = (item as Record<string, unknown>)[key];
        if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
        if (!first) emit(","); first = false; emit(JSON.stringify(key)); emit(":"); visit(child);
      }
      emit("}");
    } else emit(JSON.stringify(item) ?? "null");
  };
  visit(value); if (buffer) digest.update(buffer);
  return digest.digest("hex");
}

export function repositoryScenarioHash(manifest: RepositoryManifest): string {
  return hash(manifest.scenario ?? {});
}

/** Shared between cache publication and validation; excludes volatile creation/reuse statistics. */
export function repositorySnapshotId(snapshot: Pick<RepositorySnapshot, "root" | "manifestHash" | "scenarioHash" | "files" | "nodes" | "edges">): string {
  return `repo:${hash({ version: REPOSITORY_ANALYZER_VERSION, root: snapshot.root, manifestHash: snapshot.manifestHash,
    scenarioHash: snapshot.scenarioHash, files: snapshot.files, nodes: snapshot.nodes, edges: snapshot.edges })}`;
}

export function sameRepositoryPath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
