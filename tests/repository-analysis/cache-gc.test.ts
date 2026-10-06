import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { analyzeRepository } from "../../src/forge/repository-analysis/analyze.ts";
import { collectRepositoryCache } from "../../src/forge/repository-analysis/cache-gc.ts";
import { readRepositorySnapshot } from "../../src/forge/repository-analysis/context.ts";
import type { RepositoryManifest } from "../../src/forge/repository-manifest/types.ts";

const roots: string[] = [], HOUR = 3_600_000;
const manifest: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["typescript"] }] };
function fixture() { const root = mkdtempSync(join(tmpdir(), "forge-cache-gc-")); roots.push(root); mkdirSync(join(root, "web")); writeFileSync(join(root, "web/main.ts"), "export function meaningful() { return true; }"); return root; }
function orphan(cache: string) { mkdirSync(join(cache, "chunks"), { recursive: true }); const text = '{"unused":true}', name = `${createHash("sha256").update(text).digest("hex")}.json`; writeFileSync(join(cache, "chunks", name), text); return { name, text, path: join(cache, "chunks", name) }; }
afterEach(() => { for (const root of roots.splice(0)) { if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("forge-cache-gc-")) throw new Error("Unsafe fixture cleanup"); rmSync(root, { recursive: true, force: true }); } });

test("cleanup defaults to a dry-run; observed grace protects retired old chunks and preserves all live graph/fact chunks", async () => {
  const root = fixture(), snapshot = await analyzeRepository(root, manifest, { write: true, partitionCache: true, cacheCleanup: false });
  const cache = join(root, ".forge/repository"), unused = orphan(cache), now = Date.now();
  const dry = collectRepositoryCache(root, { graceMs: HOUR });
  expect(dry.mode).toBe("dry-run"); expect(dry.newlyObservedOrphans).toBe(1); expect(dry.eligibleChunks).toBe(0);
  expect(existsSync(join(cache, "cache-gc.json"))).toBe(false); expect(existsSync(join(cache, "analysis.lock"))).toBe(false);
  const first = collectRepositoryCache(root, { apply: true, graceMs: HOUR });
  expect(first.deletedChunks).toBe(0); expect(existsSync(unused.path)).toBe(true);
  const time = spyOn(Date, "now").mockReturnValue(now + HOUR + 5000);
  try {
    const eligible = collectRepositoryCache(root, { graceMs: HOUR });
    expect(eligible.eligibleChunks).toBe(1); expect(eligible.deletedChunks).toBe(0); expect(existsSync(unused.path)).toBe(true);
    const applied = collectRepositoryCache(root, { apply: true, graceMs: HOUR });
    expect(applied.deletedChunks).toBe(1); expect(applied.deletedBytes).toBe(Buffer.byteLength(unused.text));
    expect(applied.referencedChunks).toBeGreaterThan(0); expect(existsSync(unused.path)).toBe(false);
    expect(readRepositorySnapshot(root)?.snapshotId).toBe(snapshot.snapshotId);
  } finally { time.mockRestore(); }
});

test("re-referencing a quarantined chunk resets its orphan window on later retirement", async () => {
  const root = fixture(); await analyzeRepository(root, manifest, { write: true, partitionCache: true, cacheCleanup: false });
  const cache = join(root, ".forge/repository"), unused = orphan(cache), factsPath = join(cache, "facts.json"), initial = readFileSync(factsPath, "utf8"), now = Date.now();
  collectRepositoryCache(root, { apply: true, graceMs: HOUR });
  const facts = JSON.parse(initial); facts.files["retired.ts"] = { path: `chunks/${unused.name}`, hash: unused.name.slice(0, -5), bytes: Buffer.byteLength(unused.text) };
  writeFileSync(factsPath, JSON.stringify(facts));
  const time = spyOn(Date, "now").mockReturnValue(now + HOUR + 5000);
  try {
    expect(collectRepositoryCache(root, { apply: true, graceMs: HOUR }).deletedChunks).toBe(0);
    writeFileSync(factsPath, initial);
    const retired = collectRepositoryCache(root, { apply: true, graceMs: HOUR });
    expect(retired.newlyObservedOrphans).toBe(1); expect(retired.deletedChunks).toBe(0); expect(existsSync(unused.path)).toBe(true);
  } finally { time.mockRestore(); }
});

test("a changed header restarts orphan grace even when transient live references occurred between collections", async () => {
  const root = fixture(); await analyzeRepository(root, manifest, { write: true, partitionCache: true, cacheCleanup: false });
  const cache = join(root, ".forge/repository"), unused = orphan(cache), now = Date.now();
  collectRepositoryCache(root, { apply: true, graceMs: HOUR });
  // A fresh analysis retires an old graph. Its old chunks can still be held by readers.
  writeFileSync(join(root, "web/main.ts"), "export function different() { return false; }");
  await analyzeRepository(root, manifest, { write: true, partitionCache: true, cacheCleanup: false });
  const time = spyOn(Date, "now").mockReturnValue(now + HOUR + 5000);
  try {
    const restarted = collectRepositoryCache(root, { apply: true, graceMs: HOUR });
    expect(restarted.newlyObservedOrphans).toBeGreaterThan(0); expect(restarted.deletedChunks).toBe(0); expect(existsSync(unused.path)).toBe(true);
    time.mockReturnValue(now + 2 * HOUR + 10_000);
    expect(collectRepositoryCache(root, { apply: true, graceMs: HOUR }).deletedChunks).toBeGreaterThan(0);
  } finally { time.mockRestore(); }
});

test("corrupt graph header, corrupt current facts and unsupported indexes fail closed before deleting or changing journal", async () => {
  const root = fixture(); await analyzeRepository(root, manifest, { write: true, partitionCache: true, cacheCleanup: false });
  const cache = join(root, ".forge/repository"), unused = orphan(cache), headerPath = join(cache, "snapshot.json"), header = readFileSync(headerPath, "utf8");
  collectRepositoryCache(root, { apply: true, graceMs: HOUR });
  const journal = readFileSync(join(cache, "cache-gc.json"), "utf8"), now = Date.now(), time = spyOn(Date, "now").mockReturnValue(now + HOUR + 5000);
  try {
    writeFileSync(headerPath, "{broken"); expect(() => collectRepositoryCache(root, { apply: true, graceMs: HOUR })).toThrow();
    expect(existsSync(unused.path)).toBe(true); expect(readFileSync(join(cache, "cache-gc.json"), "utf8")).toBe(journal);
    const unsupported = JSON.parse(header); unsupported.storageVersion = 999; writeFileSync(headerPath, JSON.stringify(unsupported));
    expect(() => collectRepositoryCache(root, { apply: true, graceMs: HOUR })).toThrow();
    writeFileSync(headerPath, header);
    const facts = JSON.parse(readFileSync(join(cache, "facts.json"), "utf8")), part = Object.values(facts.files)[0] as any;
    writeFileSync(join(cache, part.path), "{}"); expect(() => collectRepositoryCache(root, { apply: true, graceMs: HOUR })).toThrow();
    expect(existsSync(unused.path)).toBe(true); expect(readFileSync(join(cache, "cache-gc.json"), "utf8")).toBe(journal);
  } finally { time.mockRestore(); }
});

test("foreign locks, symlinked inventories and invalid journals are retained without reclamation", async () => {
  const root = fixture(); await analyzeRepository(root, manifest, { write: true, partitionCache: true, cacheCleanup: false });
  const cache = join(root, ".forge/repository"), unused = orphan(cache), lock = join(cache, "analysis.lock");
  writeFileSync(lock, '{"pid":999999999,"token":"foreign"}'); expect(() => collectRepositoryCache(root, { apply: true })).toThrow();
  expect(readFileSync(lock, "utf8")).toContain("foreign"); rmSync(lock);
  const outside = fixture(), link = join(cache, "chunks", "outside"); symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  expect(() => collectRepositoryCache(root, { apply: true })).toThrow("symlinks"); expect(existsSync(unused.path)).toBe(true);
  if (process.platform === "win32") rmdirSync(link); else unlinkSync(link);
  writeFileSync(join(cache, "cache-gc.json"), JSON.stringify({ kind: "repository-cache-gc", version: 1, orphans: { "../outside.json": { firstOrphanedAt: 1, identity: "a".repeat(64) } } }));
  expect(() => collectRepositoryCache(root, { apply: true })).toThrow("journal"); expect(existsSync(unused.path)).toBe(true);
});

test("legacy inline caches, absent caches, and grace bounds remain supported", async () => {
  const root = fixture(); expect(collectRepositoryCache(root).cacheExists).toBe(false);
  const snapshot = await analyzeRepository(root, manifest, { write: true, cacheCleanup: false }), cache = join(root, ".forge/repository"), unused = orphan(cache), now = Date.now();
  expect(JSON.parse(readFileSync(join(cache, "snapshot.json"), "utf8")).kind).toBeUndefined();
  expect(() => collectRepositoryCache(root, { graceMs: HOUR - 1 })).toThrow("grace");
  collectRepositoryCache(root, { apply: true, graceMs: HOUR });
  const time = spyOn(Date, "now").mockReturnValue(now + HOUR + 5000);
  try { expect(collectRepositoryCache(root, { apply: true, graceMs: HOUR }).deletedChunks).toBe(1); expect(existsSync(unused.path)).toBe(false); expect(readRepositorySnapshot(root)?.snapshotId).toBe(snapshot.snapshotId); }
  finally { time.mockRestore(); }
});
