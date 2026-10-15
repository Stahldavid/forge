import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { RepositorySnapshot, RepositoryNode, RepositoryEdge } from "./types.ts";
import { compactRepositoryContextNode } from "./context-node.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const CHUNK_BYTES = 2 * 1024 * 1024, MAX_PART_BYTES = 16 * 1024 * 1024, MAX_TOTAL_BYTES = 512 * 1024 * 1024;
interface Part { path: string; hash: string; bytes: number; count?: number; section?: "nodes" | "edges"; component?: string }
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function safeParents(path: string) {
  for (let cursor = resolve(path); ; cursor = dirname(cursor)) { if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error("Repository storage cannot traverse symlinks"); if (cursor === dirname(cursor)) break; }
}
function readJson(path: string, limit = 128 * 1024 * 1024): unknown {
  safeParents(path); const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > limit) throw new Error("Repository storage file exceeds bound or is not regular");
  return JSON.parse(readFileSync(path, "utf8"));
}
function partText(directory: string, part: Part): string {
  if (!object(part) || !/^chunks\/[a-f0-9]{64}\.json$/.test(part.path) || !/^[a-f0-9]{64}$/.test(part.hash)
    || part.path !== `chunks/${part.hash}.json` || !Number.isSafeInteger(part.bytes) || part.bytes < 0 || part.bytes > MAX_PART_BYTES) throw new Error("Invalid repository partition reference");
  const path = join(directory, part.path); safeParents(path); const stat = lstatSync(path);
  if (!stat.isFile() || stat.size !== part.bytes) throw new Error("Repository partition size mismatch");
  const text = readFileSync(path, "utf8"); if (sha(text) !== part.hash) throw new Error("Repository partition digest mismatch"); return text;
}
function writePart(directory: string, text: string): Part {
  const bytes = Buffer.byteLength(text); if (bytes > MAX_PART_BYTES) throw new Error("Repository partition exceeds bound");
  const hash = sha(text), path = `chunks/${hash}.json`, absolute = join(directory, path); safeParents(absolute);
  mkdirSync(dirname(absolute), { recursive: true });
  if (existsSync(absolute)) { partText(directory, { path, hash, bytes }); return { path, hash, bytes }; }
  const temporary = `${absolute}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, text, { flag: "wx" }); renameSync(temporary, absolute); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return { path, hash, bytes };
}

/** Legacy JSON remains readable. Large graphs use canonical-order partitions. */
export function writeStoredRepositorySnapshot(snapshot: RepositorySnapshot, directory: string, temporary: string, options: { partition?: boolean } = {}): void {
  const small = options.partition !== true && snapshot.nodes.length < 10_000 && snapshot.edges.length < 20_000 ? JSON.stringify(snapshot) : undefined;
  if (small && Buffer.byteLength(small) <= 8 * 1024 * 1024) { writeFileSync(temporary, small); return; }
  const { nodes, edges, ...header } = snapshot, parts: Part[] = [];
  const groups = new Map<string, { section: "nodes" | "edges"; component: string; items: unknown[] }>();
  for (const [section, items] of [["nodes", nodes], ["edges", edges]] as const) for (const item of items) {
    // Canonical ID order keeps scans sequential. V1 component partitions remain readable.
    const component = "mixed";
    const key = `${section}:${component}`, group = groups.get(key) ?? { section, component, items: [] }; group.items.push(item); groups.set(key, group);
  }
  let total = 0;
  for (const group of [...groups.values()].sort((a, b) => `${a.section}:${a.component}`.localeCompare(`${b.section}:${b.component}`))) {
    let strings: string[] = [], bytes = 2;
    const flush = () => { if (!strings.length) return; const part = writePart(directory, `[${strings.join(",")}]`); total += part.bytes; parts.push({ ...part, section: group.section, component: group.component, count: strings.length }); strings = []; bytes = 2; };
    for (const item of group.items) { const text = JSON.stringify(item), size = Buffer.byteLength(text) + 1; if (bytes + size > CHUNK_BYTES) flush(); strings.push(text); bytes += size; }
    flush();
  }
  if (parts.length > 4096 || total > MAX_TOTAL_BYTES) throw new Error("Repository partition inventory exceeds bound");
  writeFileSync(temporary, JSON.stringify({ kind: "repository-snapshot-index", storageVersion: 2, header, counts: { nodes: nodes.length, edges: edges.length }, parts }));
}

export interface RepositoryStorageMetrics {
  mode: "partition-backed";
  partitions: number;
  partitionReads: number;
  bytesRead: number;
  residentPartitions: number;
  peakResidentPartitions: number;
  /** Serialized payload size of resident partitions, not decoded heap usage. */
  peakResidentPayloadBytes: number;
}
interface Row { id: string; part: number; offset: number; from?: string; to?: string; kind?: string; file?: string; suite?: boolean; minimumContextChars?: number }
interface LazyCollection { rows: Row[]; byId: Map<string, number>; at(index: number): any }
const collections = new WeakMap<object, LazyCollection>();
const metricsByArray = new WeakMap<object, RepositoryStorageMetrics>();

/** Lookups retain only ID-to-position indexes for partition-backed arrays. */
export function repositoryNodeLookup(snapshot: RepositorySnapshot): Pick<Map<string, RepositoryNode>, "get" | "has"> {
  const collection = collections.get(snapshot.nodes);
  if (!collection) return new Map(snapshot.nodes.map(node => [node.id, node]));
  return { has: id => collection.byId.has(id), get: id => { const index = collection.byId.get(id); return index === undefined ? undefined : collection.at(index); } };
}
/** Small query-planning facts avoid hydrating large nodes while sorting relations. */
export function repositoryNodeSummaryLookup(snapshot: RepositorySnapshot): Pick<Map<string, { kind: string; file?: string; suite?: boolean; minimumContextChars?: number }>, "get"> {
  const collection = collections.get(snapshot.nodes);
  if (!collection) {
    const lookup = repositoryNodeLookup(snapshot);
    return { get: id => { const node = lookup.get(id); return node ? { kind: node.kind, file: node.file, suite: node.metadata.suite === true, minimumContextChars: JSON.stringify(compactRepositoryContextNode(node, "read-only", [])).length } : undefined; } };
  }
  return { get: id => { const index = collection.byId.get(id); return index === undefined ? undefined : collection.rows[index] as { kind: string; file?: string; suite?: boolean; minimumContextChars?: number }; } };
}
export function repositoryEdgeLookup(snapshot: RepositorySnapshot): Pick<Map<string, RepositoryEdge[]>, "get"> {
  const collection = collections.get(snapshot.edges);
  const positions = new Map<string, number[]>();
  if (collection) {
    for (let index = 0; index < collection.rows.length; index++) {
      const row = collection.rows[index]!;
      for (const id of new Set([row.from!, row.to!])) { const list = positions.get(id) ?? []; list.push(index); positions.set(id, list); }
    }
    return { get: id => positions.get(id)?.map(index => collection.at(index)) };
  }
  const edges = new Map<string, RepositoryEdge[]>();
  for (const edge of snapshot.edges) for (const id of new Set([edge.from, edge.to])) { const list = edges.get(id) ?? []; list.push(edge); edges.set(id, list); }
  return edges;
}
export function repositoryStorageMetrics(snapshot: RepositorySnapshot): RepositoryStorageMetrics | undefined {
  const metrics = metricsByArray.get(snapshot.nodes); return metrics ? { ...metrics } : undefined;
}

export function readStoredRepositorySnapshot(path: string, options: { lazy?: boolean } = {}): unknown {
  const value = readJson(path);
  if (!object(value) || value.kind !== "repository-snapshot-index") return value;
  if (![1, 2].includes(value.storageVersion) || !object(value.header) || !object(value.counts) || !Array.isArray(value.parts) || value.parts.length > 4096) throw new Error("Invalid repository partition index");
  if (value.storageVersion === 1) options = { ...options, lazy: false };
  const nodes: unknown[] = [], edges: unknown[] = []; let total = 0;
  const nodeRows: Row[] = [], edgeRows: Row[] = [];
  const metrics: RepositoryStorageMetrics = { mode: "partition-backed", partitions: value.parts.length, partitionReads: 0, bytesRead: 0, residentPartitions: 0, peakResidentPartitions: 0, peakResidentPayloadBytes: 0 };
  const parts = value.parts as Part[], resident = new Map<number, unknown[]>();
  const load = (index: number): unknown[] => {
    const cached = resident.get(index);
    if (cached) { resident.delete(index); resident.set(index, cached); return cached; }
    // Evict before reading; never retain more than two decoded partitions.
    if (resident.size >= 2) resident.delete(resident.keys().next().value!);
    const part = parts[index]!, items = JSON.parse(partText(dirname(path), part));
    if (!Array.isArray(items) || items.length !== part.count) throw new Error("Repository partition count mismatch");
    metrics.partitionReads++; metrics.bytesRead += part.bytes; resident.set(index, items);
    metrics.residentPartitions = resident.size;
    metrics.peakResidentPartitions = Math.max(metrics.peakResidentPartitions, resident.size);
    metrics.peakResidentPayloadBytes = Math.max(metrics.peakResidentPayloadBytes, [...resident.keys()].reduce((sum, key) => sum + parts[key]!.bytes, 0));
    return items;
  };
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex]!;
    if (!Number.isSafeInteger(part.count) || part.count! < 0 || !["nodes", "edges"].includes(part.section!)) throw new Error("Invalid repository partition section");
    total += part.bytes; if (total > MAX_TOTAL_BYTES) throw new Error("Repository partitions exceed total bound");
    const items = load(partIndex);
    const target = part.section === "nodes" ? nodes : edges;
    const rows = part.section === "nodes" ? nodeRows : edgeRows;
    for (let offset = 0; offset < items.length; offset++) {
      const item = items[offset];
      if (options.lazy) {
        if (!object(item) || typeof item.id !== "string" || !item.id || item.id.length > 256
          || part.section === "edges" && (typeof item.from !== "string" || item.from.length > 256 || typeof item.to !== "string" || item.to.length > 256)) throw new Error("Invalid repository partition item");
        if (part.section === "nodes" && (typeof item.name !== "string" || !object(item.metadata))) throw new Error("Invalid repository partition node");
        rows.push({ id: item.id, part: partIndex, offset, ...(part.section === "edges" ? { from: item.from, to: item.to } : { kind: item.kind, file: item.file, suite: item.metadata?.suite === true, minimumContextChars: JSON.stringify(compactRepositoryContextNode(item as RepositoryNode, "read-only", [])).length }) });
      } else target.push(item);
    }
    if ((options.lazy ? nodeRows.length : nodes.length) > 500_000 || (options.lazy ? edgeRows.length : edges.length) > 1_000_000) throw new Error("Repository partition graph exceeds bound");
  }
  if (value.counts.nodes !== (options.lazy ? nodeRows.length : nodes.length) || value.counts.edges !== (options.lazy ? edgeRows.length : edges.length)) throw new Error("Repository partition inventory mismatch");
  if (options.lazy) {
    const array = (rows: Row[]) => {
      rows.sort((a, b) => a.id.localeCompare(b.id));
      const byId = new Map(rows.map((row, index) => [row.id, index]));
      const at = (index: number) => { const row = rows[index]; return row ? load(row.part)[row.offset] : undefined; };
      const target: unknown[] = []; target.length = rows.length;
      const numeric = (key: PropertyKey): number | undefined => typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) && Number(key) < rows.length ? Number(key) : undefined;
      const proxy = new Proxy(target, {
        get: (target, key, receiver) => { const index = numeric(key); return index === undefined ? Reflect.get(target, key, receiver) : at(index); },
        has: (target, key) => numeric(key) !== undefined || Reflect.has(target, key),
        ownKeys: () => [...rows.map((_row, index) => String(index)), "length"],
        getOwnPropertyDescriptor: (target, key) => { const index = numeric(key); return index === undefined ? Reflect.getOwnPropertyDescriptor(target, key) : { configurable: true, enumerable: true, get: () => at(index) }; },
        set: () => { throw new Error("Partition-backed repository arrays are read-only"); },
        deleteProperty: () => { throw new Error("Partition-backed repository arrays are read-only"); },
        defineProperty: () => { throw new Error("Partition-backed repository arrays are read-only"); },
        preventExtensions: () => { throw new Error("Partition-backed repository arrays are read-only"); },
        setPrototypeOf: () => { throw new Error("Partition-backed repository arrays are read-only"); },
      });
      collections.set(proxy, { rows, byId, at }); metricsByArray.set(proxy, metrics);
      return proxy;
    };
    return { ...value.header, nodes: array(nodeRows), edges: array(edgeRows) };
  }
  // Partitions group by component; graph identity remains the canonical global ID order.
  nodes.sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))); edges.sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
  return { ...value.header, nodes, edges };
}

/** Source facts contain no absolute root. Read only the requested file's partition. */
export function readStoredRepositoryFacts(path: string): any {
  const value = readJson(path);
  if (!object(value) || value.kind !== "repository-facts-index") return value;
  if (value.storageVersion !== 1 || !object(value.files) || Object.keys(value.files).length > 20_000) throw new Error("Invalid repository facts index");
  let total = 0;
  for (const part of Object.values(value.files) as Part[]) { if (!object(part) || !Number.isSafeInteger(part.bytes) || part.bytes < 0 || (total += part.bytes) > MAX_TOTAL_BYTES) throw new Error("Repository facts inventory exceeds total bound"); }
  const files = Object.create(null);
  for (const [file, part] of Object.entries(value.files)) Object.defineProperty(files, file, { enumerable: true, get() { return JSON.parse(partText(dirname(path), part as Part)); } });
  return { ...value, files };
}
export function writeStoredRepositoryFacts(cache: { schemaVersion: number; version: string; manifestHash: string; files: Record<string, unknown> }, directory: string, temporary: string, options: { partition?: boolean } = {}): void {
  const small = options.partition !== true && Object.keys(cache.files).length < 200 ? JSON.stringify(cache) : undefined;
  if (small && Buffer.byteLength(small) <= 8 * 1024 * 1024) { writeFileSync(temporary, small); return; }
  const files: Record<string, Part> = Object.create(null); let total = 0;
  for (const [file, result] of Object.entries(cache.files)) { const part = writePart(directory, JSON.stringify(result)); total += part.bytes; if (total > MAX_TOTAL_BYTES) throw new Error("Repository facts exceed total bound"); files[file] = part; }
  writeFileSync(temporary, JSON.stringify({ kind: "repository-facts-index", storageVersion: 1, schemaVersion: cache.schemaVersion, version: cache.version, manifestHash: cache.manifestHash, files }));
}
