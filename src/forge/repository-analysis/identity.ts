import { createHash } from "node:crypto";
import { REPOSITORY_ANALYZER_VERSION, type RepositorySnapshot } from "./types.ts";
import type { RepositoryManifest } from "../repository-manifest/types.ts";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
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
