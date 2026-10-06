import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { analyzeRepository } from "../../src/forge/repository-analysis/analyze.ts";
import { readRepositorySnapshot, validateRepositorySnapshotData, repositoryContext } from "../../src/forge/repository-analysis/context.ts";
import { repositorySnapshotId } from "../../src/forge/repository-analysis/identity.ts";
import { repositoryEdgeLookup, repositoryNodeLookup, repositoryStorageMetrics, writeStoredRepositorySnapshot } from "../../src/forge/repository-analysis/storage.ts";
import { selectRepositoryContext } from "../../src/forge/repository-analysis/retrieval.ts";
import type { RepositoryManifest } from "../../src/forge/repository-manifest/types.ts";

const roots: string[] = [];
const manifest: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["typescript"] }] };
async function fixture(large = false) {
  const root = mkdtempSync(join(tmpdir(), "forge-partition-reader-")); roots.push(root);
  mkdirSync(join(root, "web")); writeFileSync(join(root, "web/main.ts"), "export function anchor() { return true; }");
  writeFileSync(join(root, "forge.manifest.json"), JSON.stringify(manifest));
  const snapshot = await analyzeRepository(root, manifest, { write: true, partitionCache: true });
  if (large) {
    const anchor = snapshot.nodes.find(node => node.name === "anchor")!;
    for (let index = 0; index < 2400; index++) {
      const node = { ...anchor, id: `filler:${String(index).padStart(5, "0")}`, name: `irrelevant${index}`, metadata: { padding: "x".repeat(4096) } };
      snapshot.nodes.push(node);
      snapshot.edges.push({ id: `relation:${createHash("sha256").update(String(index)).digest("hex")}`, kind: "references", from: node.id, to: anchor.id, evidence: anchor.evidence, metadata: {} });
    }
    snapshot.nodes.sort((a, b) => a.id.localeCompare(b.id)); snapshot.edges.sort((a, b) => a.id.localeCompare(b.id));
    snapshot.snapshotId = repositorySnapshotId(snapshot);
    const cache = join(root, ".forge/repository"), temporary = join(cache, "reader-test.tmp");
    writeStoredRepositorySnapshot(snapshot, cache, temporary, { partition: true }); renameSync(temporary, join(cache, "snapshot.json"));
  }
  return { root, snapshot, cache: join(root, ".forge/repository") };
}
afterEach(() => { for (const root of roots.splice(0)) { if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("forge-partition-reader-")) throw new Error("Unsafe fixture cleanup"); rmSync(root, { recursive: true, force: true }); } });

test("partition-backed graph retains canonical identity and bounded decoded cache through validation, lookup and task selection", async () => {
  const { root, snapshot } = await fixture(true), loaded = readRepositorySnapshot(root)!;
  expect(loaded.snapshotId).toBe(snapshot.snapshotId);
  expect(validateRepositorySnapshotData(loaded)).toEqual([]);
  expect(Array.isArray(loaded.nodes)).toBe(true);
  expect(Object.keys(loaded.nodes).length).toBe(snapshot.nodes.length);
  expect(loaded.nodes.slice(0, 2)).toEqual(snapshot.nodes.slice(0, 2));
  const target = snapshot.nodes.find(node => node.name === "anchor")!;
  expect(repositoryNodeLookup(loaded).get(target.id)).toEqual(target);
  expect(repositoryNodeLookup(loaded).has("missing")).toBe(false);
  expect(repositoryEdgeLookup(loaded).get(target.id)?.length).toBe(2400);
  expect(selectRepositoryContext(loaded, "anchor", { maxChars: 3000 })).toEqual(selectRepositoryContext(snapshot, "anchor", { maxChars: 3000 }));
  expect(repositoryContext(root, loaded, "symbol anchor").ok).toBe(true);
  const metrics = repositoryStorageMetrics(loaded)!;
  expect(metrics.partitions).toBeGreaterThan(4);
  expect(metrics.peakResidentPartitions).toBeLessThanOrEqual(2);
  expect(metrics.peakResidentPayloadBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
  expect(() => loaded.nodes.push(target)).toThrow("read-only");
  expect(() => Object.preventExtensions(loaded.nodes)).toThrow("read-only");
  expect(() => Object.setPrototypeOf(loaded.nodes, null)).toThrow("read-only");
  expect(Object.keys(loaded.nodes).length).toBe(snapshot.nodes.length);
});

test("streamed fingerprint is byte-compatible with original canonical JSON including optional fields", async () => {
  const { snapshot } = await fixture();
  snapshot.nodes[0]!.metadata = { numeric: { "1": "one", "2": "two", "10": "ten", "4294967294": "last-index", "4294967295": "ordinary-key", "01": "leading-zero", "-1": "negative" }, optional: undefined };
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  const value = { version: "1.2.1", root: snapshot.root, manifestHash: snapshot.manifestHash, scenarioHash: snapshot.scenarioHash, files: snapshot.files, nodes: snapshot.nodes, edges: snapshot.edges };
  expect(repositorySnapshotId(snapshot)).toBe(`repo:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`);
});

test("legacy component-partition indexes remain compatible and corrupt unread chunks fail before returning graph", async () => {
  const { root, cache, snapshot } = await fixture(true), path = join(cache, "snapshot.json"), header = JSON.parse(readFileSync(path, "utf8"));
  header.storageVersion = 1; writeFileSync(path, JSON.stringify(header));
  expect(readRepositorySnapshot(root)?.snapshotId).toBe(snapshot.snapshotId);
  expect(repositoryStorageMetrics(readRepositorySnapshot(root)!)).toBeUndefined();
  header.storageVersion = 2; writeFileSync(path, JSON.stringify(header));
  writeFileSync(join(cache, header.parts.at(-1).path), "[]");
  expect(() => readRepositorySnapshot(root)).toThrow("partition");
});
