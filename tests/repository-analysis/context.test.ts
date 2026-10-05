import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queryRepository, readRepositorySnapshot, repositoryCairSnapshot, repositoryContext, runRepositoryCairCommand, validateRepositorySnapshotData } from "../../src/forge/repository-analysis/context.ts";
import { repositoryScenarioHash, repositorySnapshotId } from "../../src/forge/repository-analysis/identity.ts";
import type { RepositoryNode, RepositorySnapshot } from "../../src/forge/repository-analysis/types.ts";
import { runCairCommand } from "../../src/forge/cair/index.ts";
import { repositoryManifestHash } from "../../src/forge/repository-analysis/analyze.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const evidence = { assurance: "syntactic" as const, resolution: "partial" as const, adapter: "typescript", version: "1" };
function fixture(): RepositorySnapshot {
  const root = mkdtempSync(join(tmpdir(), "forge-context-")); roots.push(root);
  const source = "export function save() { return 1; }\n";
  writeFileSync(join(root, "a.ts"), source);
  writeFileSync(join(root, "other.ts"), source);
  writeFileSync(join(root, "a.test.ts"), source);
  const hash = createHash("sha256").update(source).digest("hex");
  const nodes: RepositoryNode[] = [
    { id: "a", kind: "symbol", name: "save", file: "a.ts", component: "api", evidence: { ...evidence, sourceHash: hash }, metadata: {},
      location: { start: 0, end: source.length, line: 1, column: 1, endLine: 2, endColumn: 1 } },
    { id: "b", kind: "symbol", name: "save", file: "other.ts", component: "api", evidence, metadata: {} },
    { id: "c", kind: "symbol", name: "caller", file: "a.ts", component: "api", evidence, metadata: {} },
    { id: "test", kind: "test", name: "save test", file: "a.test.ts", component: "api", evidence, metadata: {} },
  ];
  const manifest = { forgeProtocol: "2.0" as const, kind: "repository" as const, components: [{ id: "api", root: ".", adapters: ["typescript"] }] };
  return { schemaVersion: 1, provider: "repository", snapshotId: "snapshot-1", root, createdAt: "", manifestHash: repositoryManifestHash(manifest), scenarioHash: "s",
    manifest: { forgeProtocol: "2.0", kind: "repository", components: [{ id: "api", root: ".", adapters: ["typescript"] }] },
    files: Object.fromEntries(["a.ts", "other.ts", "a.test.ts"].map(file => [file, { hash, size: source.length, component: "api", adapter: "typescript", status: "analyzed" as const }])), nodes,
    edges: [{ id: "e1", from: "c", to: "a", kind: "references", evidence, metadata: {} },
      { id: "e2", from: "test", to: "a", kind: "tests", evidence, metadata: {} }],
    coverage: { found: 3, analyzed: 3, ignored: 0, unsupported: 0, errors: 0, reused: 0, limitations: [], diagnostics: [], ignoredPaths: [] } };
}

function seal(snapshot: RepositorySnapshot): RepositorySnapshot {
  snapshot.scenarioHash = repositoryScenarioHash(snapshot.manifest);
  snapshot.snapshotId = repositorySnapshotId(snapshot);
  return snapshot;
}

describe("repository context queries", () => {
  test("removed or invalid analysis manifest invalidates direct context", () => {
    const snapshot = fixture();
    const path = join(snapshot.root, "forge.manifest.json");
    writeFileSync(path, JSON.stringify(snapshot.manifest));
    unlinkSync(path);
    expect(repositoryContext(snapshot.root, snapshot, "overview").diagnostics[0]).toContain("missing or invalid");
    writeFileSync(path, "{invalid}");
    expect(repositoryContext(snapshot.root, snapshot, "overview").ok).toBe(false);
  });
  test("homonymous symbols require disambiguation; references use graph edges rather than source text", () => {
    const snapshot = fixture();
    expect(queryRepository(snapshot, "Q S name=save").ok).toBe(false);
    expect(queryRepository(snapshot, "Q REFS save").ok).toBe(false);
    const refs = queryRepository(snapshot, "Q REFS a");
    expect(refs.ok).toBe(true);
    expect(refs.items.map(item => item.id)).toEqual(["e1"]);
    expect(queryRepository(snapshot, "Q REFS b").items).toEqual([]);
  });
  test("handles are bound to an explicitly supplied snapshot", () => {
    const snapshot = fixture();
    expect(queryRepository(snapshot, "Q D S#1").ok).toBe(false);
    expect(queryRepository(snapshot, "Q D S#1", { snapshotId: "old" }).ok).toBe(false);
    expect(queryRepository(snapshot, "Q D S#1 snapshot=snapshot-1").items[0]?.id).toBe("a");
  });
  test("source slices reject changed sources before returning stale offsets", () => {
    const snapshot = fixture();
    expect(repositoryContext(snapshot.root, snapshot, "symbol a", { includeSource: true, manifest: snapshot.manifest }).items[0]?.source).toContain("function save");
    writeFileSync(join(snapshot.root, "a.ts"), "// shifted\nexport const save = 2;");
    const result = repositoryContext(snapshot.root, snapshot, "symbol a", { includeSource: true, manifest: snapshot.manifest });
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.diagnostics[0]).toContain("changed");
  });
  test("context refuses a sensitive source injected into a cached snapshot", () => {
    const snapshot = fixture();
    snapshot.files[".env"] = { ...snapshot.files["a.ts"]! };
    const result = repositoryContext(snapshot.root, snapshot, "overview", { manifest: snapshot.manifest });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toContain("sensitive");
  });
  test("new files and changed external manifest configuration invalidate context", () => {
    const snapshot = fixture();
    writeFileSync(join(snapshot.root, "new.ts"), "export const added = 1;");
    expect(repositoryContext(snapshot.root, snapshot, "overview", { manifest: snapshot.manifest }).diagnostics[0]).toContain("New source");
    const other = fixture();
    const changed = { ...other.manifest, exclude: ["a.ts"] };
    expect(repositoryContext(other.root, other, "overview", { manifest: changed }).diagnostics[0]).toContain("manifest changed");
  });
  test("pagination binds cursor to query and snapshot and limits serialized context", () => {
    const snapshot = fixture();
    for (let i = 0; i < 100; i++) snapshot.nodes.push({ ...snapshot.nodes[2]!, id: `x${i}`, name: `caller${i}`, metadata: { large: "x".repeat(1000) } });
    const result = queryRepository(snapshot, "locate", { limit: 10, maxChars: 4096 });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(4096);
    expect(result.nextCursor).toBeTruthy();
    const page = queryRepository(snapshot, "locate", { cursor: result.nextCursor, limit: 10, maxChars: 4096 });
    expect(page.items[0]?.id).not.toBe(result.items[0]?.id);
    expect(queryRepository(snapshot, "symbol", { cursor: result.nextCursor }).ok).toBe(false);
    expect(queryRepository({ ...snapshot, snapshotId: "new" }, "locate", { cursor: result.nextCursor }).ok).toBe(false);
  });
  test("minimum context budgets retain usable pagination for oversized facts and long query echoes", () => {
    const snapshot = fixture();
    snapshot.nodes[0]!.metadata = { huge: "x".repeat(100_000) };
    snapshot.nodes[0]!.name = "a".repeat(20_000);
    snapshot.nodes[0]!.file = "x".repeat(3000);
    const result = queryRepository(snapshot, "locate", { maxChars: 2048, limit: 1 });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2048);
    expect(result.items[0]?.id).toBe("a");
    expect(result.items[0]?.fileOmitted).toBe(true);
    expect(result.nextCursor).toBeTruthy();
    expect(JSON.stringify(queryRepository(snapshot, "q".repeat(20_000), { maxChars: 2048 })).length).toBeLessThanOrEqual(2048);
  });
  test("static tests and impact report limits, free-text locates files, and mutations are unavailable", () => {
    const snapshot = fixture();
    expect(queryRepository(snapshot, "caller").items[0]?.id).toBe("c");
    expect(queryRepository(snapshot, "tests a").summary.observedCoverage).toBe(false);
    expect(queryRepository(snapshot, "impact a").items.map(item => item.id)).toEqual(["a", "c", "test"]);
    const result = runRepositoryCairCommand({ workspaceRoot: snapshot.root, subcommand: "action", json: true, format: "json", action: "A PATCH" }, snapshot);
    expect(result.ok).toBe(false);
    expect(result.action?.actionCount).toBe(0);
    expect(result.snapshot.provider).toBe("repository");
  });
  test("snapshot loading cannot route another repository's cache", () => {
    const snapshot = fixture();
    const other = fixture();
    mkdirSync(join(snapshot.root, ".forge", "repository"), { recursive: true });
    writeFileSync(join(snapshot.root, ".forge", "repository", "snapshot.json"), JSON.stringify(other));
    expect(() => readRepositorySnapshot(snapshot.root)).toThrow("different root");
  });
  test("cache rejects malformed graphs, source paths, evidence and tampered fingerprints", () => {
    const snapshot = seal(fixture());
    expect(validateRepositorySnapshotData(snapshot)).toEqual([]);
    for (const mutate of [
      (value: RepositorySnapshot) => { value.nodes[0]!.evidence = null as any; },
      (value: RepositorySnapshot) => { value.nodes.push({ ...value.nodes[0]! }); },
      (value: RepositorySnapshot) => { value.edges[0]!.to = "not-a-node"; },
      (value: RepositorySnapshot) => { value.nodes[0]!.location!.end = 100_000; },
      (value: RepositorySnapshot) => { value.files["../outside"] = value.files["a.ts"]!; },
      (value: RepositorySnapshot) => { value.files[".env"] = value.files["a.ts"]!; },
      (value: RepositorySnapshot) => { value.nodes[0]!.name = "cache-tampering"; },
      (value: RepositorySnapshot) => { value.scenarioHash = "a".repeat(64); },
    ]) {
      const changed = structuredClone(snapshot); mutate(changed);
      expect(validateRepositorySnapshotData(changed).length).toBeGreaterThan(0);
    }
    mkdirSync(join(snapshot.root, ".forge", "repository"), { recursive: true });
    writeFileSync(join(snapshot.root, ".forge", "repository", "snapshot.json"), "null");
    expect(() => readRepositorySnapshot(snapshot.root)).toThrow("invalid");
    writeFileSync(join(snapshot.root, ".forge", "repository", "snapshot.json"), JSON.stringify(snapshot));
    expect(readRepositorySnapshot(snapshot.root)?.snapshotId).toBe(snapshot.snapshotId);
  });
  test("missing roots produce structured context errors", () => {
    const snapshot = fixture();
    const result = repositoryContext(join(snapshot.root, "missing"), snapshot, "routes", { manifest: snapshot.manifest });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toContain("unavailable");
  });
  test("cache directory links are refused and CAIR snapshot projections remain bounded", () => {
    const snapshot = fixture();
    const target = fixture();
    symlinkSync(target.root, join(snapshot.root, ".forge"), process.platform === "win32" ? "junction" : "dir");
    expect(() => readRepositorySnapshot(snapshot.root)).toThrow("symbolic links");
    for (let index = 0; index < 100; index++) snapshot.nodes.push({ ...snapshot.nodes[0]!, id: `z${index}`,
      name: "n".repeat(20_000), file: "nested/" + "p".repeat(3000) });
    const view = repositoryCairSnapshot(snapshot);
    expect(JSON.stringify(view).length).toBeLessThanOrEqual(16_000);
    expect(view.truncated.symbols).toBeGreaterThan(70);
    expect(view.lexicon.symbols.every(item => item.file.length <= 1 || item.file === "a.ts" || item.file === "other.ts" || item.file.startsWith("nested/"))).toBe(true);
  });
  test("CAIR routes repository manifests without requiring Forge generated artifacts", () => {
    const snapshot = fixture();
    const manifestText = JSON.stringify(snapshot.manifest);
    writeFileSync(join(snapshot.root, "forge.manifest.json"), manifestText);
    snapshot.files["forge.manifest.json"] = { hash: createHash("sha256").update(manifestText).digest("hex"), size: manifestText.length,
      component: "api", adapter: "unsupported", status: "unsupported" };
    snapshot.coverage.found++; snapshot.coverage.unsupported++;
    seal(snapshot);
    const options = { workspaceRoot: snapshot.root, subcommand: "query" as const, json: true, format: "json" as const, query: "routes" };
    const missing = runCairCommand(options);
    expect(missing.ok).toBe(false);
    expect(missing.snapshot.provider).toBe("repository");
    expect(missing.diagnostics[0]?.message).toContain("analyze");
    mkdirSync(join(snapshot.root, ".forge", "repository"), { recursive: true });
    writeFileSync(join(snapshot.root, ".forge", "repository", "snapshot.json"), JSON.stringify(snapshot));
    const loaded = runCairCommand(options);
    expect(loaded.ok).toBe(true);
    expect(loaded.snapshot.provider).toBe("repository");
    const action = runCairCommand({ ...options, subcommand: "action", action: "A CREATE.FILE path=new.ts body=x" });
    expect(action.ok).toBe(false);
    expect(action.action?.actionCount).toBe(0);
  });
});
