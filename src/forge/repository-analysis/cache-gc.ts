import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, opendirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readRepositorySnapshot } from "./context.ts";
import { readStoredRepositoryFacts } from "./storage.ts";

const HOUR = 3_600_000, MAX_ENTRIES = 50_000, MAX_BYTES = 2 * 1024 * 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const chunkName = /^[a-f0-9]{64}\.json$/;
const safeParents = (path: string) => {
  for (let cursor = resolve(path); ; cursor = dirname(cursor)) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error("Repository cache cleanup cannot traverse symlinks");
    if (cursor === dirname(cursor)) break;
  }
};
function json(path: string, maximum: number): any {
  safeParents(path); const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > maximum) throw new Error("Repository cache cleanup encountered an invalid file");
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("Repository cache cleanup encountered invalid JSON"); }
}

export interface RepositoryCacheCleanupOptions {
  cacheRoot?: string;
  /** Default is dry-run. Apply first records orphans; subsequent applies can reclaim them. */
  apply?: boolean;
  /** At least one hour; defaults to 24 hours. */
  graceMs?: number;
}
export interface RepositoryCacheCleanupReport {
  mode: "dry-run" | "apply";
  cacheExists: boolean;
  graceMs: number;
  scannedChunks: number;
  referencedChunks: number;
  retainedChunks: number;
  newlyObservedOrphans: number;
  eligibleChunks: number;
  eligibleBytes: number;
  deletedChunks: number;
  deletedBytes: number;
  ignoredEntries: number;
  readerGrace: "orphan-observation-window";
}

/**
 * Reclaim only content-addressed chunks unreferenced for a full observed grace window.
 * File age alone is unsafe: a newly retired snapshot may reference very old chunks.
 * Cooperates with the analyzer's exclusive lock; never reclaims a supposedly stale lock.
 * Readers that can outlive the grace window need external coordination or a longer grace.
 */
export function collectRepositoryCache(root: string, options: RepositoryCacheCleanupOptions = {}): RepositoryCacheCleanupReport {
  if (options.apply !== undefined && typeof options.apply !== "boolean") throw new Error("Invalid cache cleanup apply option");
  const graceMs = options.graceMs ?? 24 * HOUR;
  if (!Number.isSafeInteger(graceMs) || graceMs < HOUR || graceMs > 30 * 24 * HOUR) throw new Error("Cache cleanup grace must be between one hour and 30 days");
  const directory = resolve(options.cacheRoot ?? join(root, ".forge", "repository")); safeParents(directory);
  const report: RepositoryCacheCleanupReport = { mode: options.apply === true ? "apply" : "dry-run", cacheExists: existsSync(directory), graceMs,
    scannedChunks: 0, referencedChunks: 0, retainedChunks: 0, newlyObservedOrphans: 0, eligibleChunks: 0, eligibleBytes: 0,
    deletedChunks: 0, deletedBytes: 0, ignoredEntries: 0, readerGrace: "orphan-observation-window" };
  if (!report.cacheExists) return report;
  if (!lstatSync(directory).isDirectory()) throw new Error("Repository cache cleanup directory is invalid");
  const lock = join(directory, "analysis.lock"); safeParents(lock);
  const descriptor = openSync(lock, "wx"), token = randomUUID(), statePath = join(directory, "cache-gc.json"), temporary = `${statePath}.${token}.tmp`;
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, operation: "cache-gc" }));
    const snapshotPath = join(directory, "snapshot.json"), factsPath = join(directory, "facts.json");
    if (existsSync(snapshotPath) !== existsSync(factsPath)) throw new Error("Repository cache cleanup requires both cache headers");
    const references = new Set<string>();
    let headersFingerprint = hash("absent");
    const addPart = (part: unknown) => {
      if (!record(part) || typeof part.hash !== "string" || !/^[a-f0-9]{64}$/.test(part.hash)
        || part.path !== `chunks/${part.hash}.json` || !Number.isSafeInteger(part.bytes) || part.bytes < 0 || part.bytes > 16 * 1024 * 1024) throw new Error("Repository cache cleanup encountered an invalid partition reference");
      references.add(`${part.hash}.json`);
    };
    if (existsSync(snapshotPath)) {
      // Includes graph structure, identity, root ownership and all current graph chunk digests.
      readRepositorySnapshot(root, { cacheRoot: directory });
      const snapshot = json(snapshotPath, 128 * 1024 * 1024), facts = json(factsPath, 128 * 1024 * 1024);
      headersFingerprint = hash(`${hash(readFileSync(snapshotPath, "utf8"))}:${hash(readFileSync(factsPath, "utf8"))}`);
      if (snapshot.kind === "repository-snapshot-index") {
        if (![1, 2].includes(snapshot.storageVersion) || !Array.isArray(snapshot.parts)) throw new Error("Repository cache cleanup encountered an unsupported snapshot index");
        snapshot.parts.forEach(addPart);
      }
      if (!record(facts) || facts.schemaVersion !== 1 || typeof facts.version !== "string" || facts.version.length > 80
        || typeof facts.manifestHash !== "string" || !/^[a-f0-9]{64}$/.test(facts.manifestHash) || !record(facts.files)
        || Object.keys(facts.files).length > 20_000) throw new Error("Repository cache cleanup encountered an invalid facts header");
      if (facts.kind === "repository-facts-index") {
        if (facts.storageVersion !== 1) throw new Error("Repository cache cleanup encountered an unsupported facts index");
        Object.values(facts.files).forEach(addPart);
      } else if (facts.kind !== undefined) throw new Error("Repository cache cleanup encountered an unsupported facts header");
      const loadedFacts = readStoredRepositoryFacts(factsPath);
      // Force each lazy fact getter to verify content and digest before any removal.
      for (const file of Object.keys(loadedFacts.files)) if (!record(loadedFacts.files[file])) throw new Error("Repository cache cleanup encountered an invalid fact");
    }
    const now = Date.now(), previous: Record<string, { firstOrphanedAt: number; identity: string }> = Object.create(null);
    if (existsSync(statePath)) {
      const state = json(statePath, 12 * 1024 * 1024);
      if (!record(state) || state.kind !== "repository-cache-gc" || state.version !== 1 || !record(state.orphans)
        || typeof state.headersFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(state.headersFingerprint)
        || Object.keys(state.orphans).length > MAX_ENTRIES) throw new Error("Repository cache cleanup journal is invalid");
      for (const [name, observation] of Object.entries(state.orphans)) {
        if (!chunkName.test(name) || !record(observation) || !Number.isSafeInteger(observation.firstOrphanedAt)
          || observation.firstOrphanedAt < 0 || observation.firstOrphanedAt > now || typeof observation.identity !== "string"
          || !/^[a-f0-9]{64}$/.test(observation.identity)) throw new Error("Repository cache cleanup journal is invalid");
        // A chunk may have been re-referenced and retired between GC invocations. Any
        // header replacement restarts the window conservatively, even for older orphans.
        if (state.headersFingerprint === headersFingerprint) previous[name] = { firstOrphanedAt: observation.firstOrphanedAt, identity: observation.identity };
      }
    }
    const chunks = join(directory, "chunks"); safeParents(chunks);
    const names: string[] = [];
    if (existsSync(chunks)) {
      if (!lstatSync(chunks).isDirectory()) throw new Error("Repository cache cleanup inventory is invalid");
      const inventory = opendirSync(chunks);
      try { for (let entry = inventory.readSync(); entry; entry = inventory.readSync()) {
        if (names.length >= MAX_ENTRIES) throw new Error("Repository cache cleanup inventory exceeds bound");
        names.push(entry.name);
      } } finally { inventory.closeSync(); }
    }
    const orphans: typeof previous = Object.create(null), candidates: Array<{ path: string; name: string; bytes: number; identity: string }> = [];
    let bytes = 0;
    const identity = (path: string) => { safeParents(path); const stat = lstatSync(path); if (!stat.isFile()) throw new Error("Repository cache cleanup chunk is not a regular file"); return { stat, id: hash(`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.birthtimeMs}`) }; };
    // Complete validation and inventory before the first persistent mutation.
    for (const name of names.sort()) {
      const path = join(chunks, name), entry = identity(path);
      if (!chunkName.test(name)) { report.ignoredEntries++; continue; }
      if ((bytes += entry.stat.size) > MAX_BYTES || entry.stat.size > 16 * 1024 * 1024) throw new Error("Repository cache cleanup inventory exceeds byte bound");
      report.scannedChunks++;
      if (references.has(name)) { report.referencedChunks++; report.retainedChunks++; continue; }
      const observation = previous[name]?.identity === entry.id ? previous[name]! : { firstOrphanedAt: now, identity: entry.id };
      if (observation !== previous[name]) report.newlyObservedOrphans++;
      orphans[name] = observation;
      if (now - observation.firstOrphanedAt < graceMs) { report.retainedChunks++; continue; }
      report.eligibleChunks++; report.eligibleBytes += entry.stat.size;
      candidates.push({ path, name, bytes: entry.stat.size, identity: entry.id });
    }
    if (report.referencedChunks !== references.size) throw new Error("Repository cache cleanup cannot find all referenced chunks");
    if (options.apply === true) {
      // Publish the observation journal before deleting. A crash can only delay reclamation.
      writeFileSync(temporary, JSON.stringify({ kind: "repository-cache-gc", version: 1, headersFingerprint, orphans }), { flag: "wx" });
      safeParents(statePath); renameSync(temporary, statePath);
      for (const candidate of candidates) {
        if (identity(candidate.path).id !== candidate.identity) throw new Error("Repository cache cleanup chunk changed during collection");
        unlinkSync(candidate.path); report.deletedChunks++; report.deletedBytes += candidate.bytes;
      }
    }
    return report;
  } finally {
    closeSync(descriptor);
    if (existsSync(temporary)) { safeParents(temporary); if (lstatSync(temporary).isFile()) unlinkSync(temporary); }
    // Do not remove a foreign replacement lock even if a non-cooperating process changed it.
    if (existsSync(lock)) { const value = json(lock, 4096); if (record(value) && value.token === token) unlinkSync(lock); }
  }
}
