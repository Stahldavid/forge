import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { CAIR_SCHEMA_VERSION, type CairCommandOptions, type CairCommandResult, type CairSnapshot } from "../cair/types.ts";
import type { RepositoryNode, RepositorySnapshot } from "./types.ts";
import { containedRepositoryPath, readRepositoryManifest, validateRepositoryManifest } from "../repository-manifest/index.ts";
import { isSensitiveRepositoryPath } from "./scanner.ts";
import type { RepositoryManifest } from "../repository-manifest/types.ts";
import { repositoryManifestHash, validateRepositorySnapshot } from "./analyze.ts";
import { repositoryScenarioHash, repositorySnapshotId, sameRepositoryPath } from "./identity.ts";
import { groupRepositoryJavaCalls, rankRepositoryCandidates } from "./retrieval.ts";
import { readStoredRepositorySnapshot, repositoryNodeLookup } from "./storage.ts";

export interface RepositoryQueryOptions {
  snapshotId?: string;
  limit?: number;
  maxChars?: number;
  cursor?: string;
  includeSource?: boolean;
  manifest?: RepositoryManifest;
}

export interface RepositoryQueryResult {
  ok: boolean;
  provider: "repository";
  snapshotId: string;
  query: string;
  items: Array<Record<string, unknown>>;
  total: number;
  truncated: number;
  nextCursor?: string;
  summary: Record<string, unknown>;
  diagnostics: string[];
  capabilities: { queries: string[]; actions: false };
}

const QUERIES = ["overview", "locate", "symbol", "references", "calls", "routes", "dependencies", "impact", "tests", "infrastructure", "coverage"];
const INFRASTRUCTURE = new Set(["container-service", "build-stage", "image", "volume", "network"]);
const ALIASES: Record<string, string> = {
  st: "overview", status: "overview", s: "symbol", d: "symbol", def: "symbol", definition: "symbol",
  r: "references", refs: "references", i: "impact", t: "tests", m: "dependencies", module: "dependencies",
  deps: "dependencies", infra: "infrastructure", help: "help",
};

function digest(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value!))) : fallback;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, maximum = 4096): value is string => typeof value === "string" && value.length <= maximum;
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function sourcePath(value: unknown): value is string {
  return string(value) && value.length > 0 && !isAbsolute(value) && !/[\\:\u0000-\u001f]/.test(value)
    && !value.split("/").some(part => part === ".." || part === "." || !part) && !isSensitiveRepositoryPath(value);
}

/** The disk cache is data, not a trusted graph. Validate before resolving handles or slicing sources. */
export function validateRepositorySnapshotData(value: unknown): string[] {
  const invalid = () => ["Repository snapshot has invalid structure; run repository analyze again."];
  if (!record(value) || value.schemaVersion !== 1 || value.provider !== "repository" || !string(value.root, 32768)
    || !isAbsolute(value.root) || !string(value.snapshotId, 80) || !/^repo:[a-f0-9]{64}$/.test(value.snapshotId)
    || !hash(value.manifestHash) || !hash(value.scenarioHash) || !string(value.createdAt, 64)
    || !record(value.files) || !Array.isArray(value.nodes) || value.nodes.length > 500_000
    || !Array.isArray(value.edges) || value.edges.length > 1_000_000 || !record(value.coverage)) return invalid();
  const manifest = validateRepositoryManifest(value.manifest).manifest;
  if (!manifest || repositoryManifestHash(manifest) !== value.manifestHash || repositoryScenarioHash(manifest) !== value.scenarioHash) return invalid();
  const components = new Set(manifest.components.map(component => component.id));
  const fileEntries = Object.entries(value.files);
  if (fileEntries.length > 20_000) return invalid();
  const sourceHashes = new Set<string>();
  for (const [file, input] of fileEntries) {
    if (!sourcePath(file) || !record(input) || !hash(input.hash) || !integer(input.size) || input.size > 2 * 1024 * 1024
      || !string(input.component, 80) || !components.has(input.component) || !string(input.adapter, 80)
      || !["analyzed", "unsupported", "error"].includes(input.status as string)) return invalid();
    sourceHashes.add(input.hash);
  }
  const location = (input: unknown, file?: string): boolean => {
    if (input === undefined) return true;
    if (!record(input) || !integer(input.start) || !integer(input.end) || input.end < input.start
      || !integer(input.line, 1) || !integer(input.column, 1) || !integer(input.endLine, 1) || !integer(input.endColumn, 1)
      || input.endLine < input.line || (input.endLine === input.line && input.endColumn < input.column)) return false;
    return !file || input.end <= (value.files as Record<string, { size: number }>)[file]!.size;
  };
  const evidence = (input: unknown, file?: string): boolean => record(input)
    && ["declared", "syntactic", "resolved", "inferred"].includes(input.assurance as string)
    && ["complete", "partial", "unresolved"].includes(input.resolution as string)
    && string(input.adapter, 80) && string(input.version, 80)
    && (input.sourceHash === undefined || (hash(input.sourceHash) && sourceHashes.has(input.sourceHash)
      && (!file || (value.files as Record<string, { hash: string }>)[file]!.hash === input.sourceHash)));
  const ids = new Set<string>();
  // Validate one item at a time rather than materializing partition-backed arrays.
  let visited = 0;
  const boundedMetadata = (input: unknown): boolean => {
    const queue: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }];
    while (queue.length) {
      const item = queue.pop()!;
      if (++visited > 5_000_000 || item.depth > 32) return false;
      if (item.value && typeof item.value === "object") for (const child of Object.values(item.value)) queue.push({ value: child, depth: item.depth + 1 });
    }
    return true;
  };
  const { nodes: _nodes, edges: _edges, ...header } = value;
  if (!boundedMetadata(header)) return invalid();
  for (const node of value.nodes) {
    if (!record(node) || !string(node.id, 256) || !node.id || ids.has(node.id) || !string(node.kind, 80)
      || !string(node.name, 32768) || !string(node.component, 80) || !components.has(node.component) || !record(node.metadata)
      || (node.file !== undefined && (!sourcePath(node.file) || !Object.hasOwn(value.files, node.file)))
      || !location(node.location, node.file as string | undefined) || !evidence(node.evidence, node.file as string | undefined)
      || !boundedMetadata(node)) return invalid();
    ids.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of value.edges) {
    if (!record(edge) || !string(edge.id, 256) || !edge.id || edgeIds.has(edge.id) || !string(edge.from, 256)
      || !ids.has(edge.from) || !string(edge.to, 256) || !ids.has(edge.to) || !string(edge.kind, 80)
      || !record(edge.metadata) || !location(edge.location) || !evidence(edge.evidence) || !boundedMetadata(edge)) return invalid();
    edgeIds.add(edge.id);
  }
  const coverage = value.coverage;
  if (!["found", "analyzed", "ignored", "unsupported", "errors", "reused"].every(key => integer(coverage[key]))
    || coverage.found !== fileEntries.length || Number(coverage.analyzed) + Number(coverage.unsupported) + Number(coverage.errors) !== coverage.found
    || !Array.isArray(coverage.limitations) || !Array.isArray(coverage.diagnostics) || !Array.isArray(coverage.ignoredPaths)
    || coverage.limitations.length > 20_000 || coverage.diagnostics.length > 100_000 || coverage.ignoredPaths.length > 20_000) return invalid();
  if (!coverage.limitations.every(item => string(item, 32768)) || !coverage.diagnostics.every(item => record(item)
    && string(item.code, 256) && string(item.message, 32768) && ["info", "warning", "error"].includes(item.severity as string)
    && (item.file === undefined || sourcePath(item.file))) || !coverage.ignoredPaths.every(item => record(item)
      && string(item.path) && string(item.reason, 256))) return invalid();
  if (repositorySnapshotId(value as unknown as RepositorySnapshot) !== value.snapshotId) return ["Repository snapshot fingerprint mismatch; run repository analyze again."];
  return [];
}

/** Never load a cache belonging to a different registered workspace. */
export function readRepositorySnapshot(root: string, options: { cacheRoot?: string } = {}): RepositorySnapshot | null {
  const cache = join(options.cacheRoot ?? join(root, ".forge", "repository"), "snapshot.json");
  for (let current = resolve(cache); ; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("Repository cache cannot traverse symbolic links");
    if (dirname(current) === current) break;
  }
  if (!existsSync(cache)) return null;
  const stat = lstatSync(cache);
  if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error("Repository snapshot exceeds read limit or is not a regular file.");
  let value: unknown;
  try { value = readStoredRepositorySnapshot(cache, { lazy: true }); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error("Repository snapshot is not valid JSON");
    throw new Error(error instanceof Error ? error.message.slice(0, 512) : "Repository snapshot cannot be read safely");
  }
  if (!record(value) || !string(value.root, 32768) || !sameRepositoryPath(realpathSync(value.root), realpathSync(root))) {
    throw new Error("Repository snapshot is invalid or belongs to a different root; run repository analyze.");
  }
  const invalid = validateRepositorySnapshotData(value);
  if (invalid.length) throw new Error(invalid[0]);
  return value as unknown as RepositorySnapshot;
}

function compactNode(node: RepositoryNode, handle?: string): Record<string, unknown> {
  return {
    id: node.id, ...(handle ? { handle } : {}), kind: node.kind, name: node.name,
    component: node.component, ...(node.file ? { file: node.file } : {}),
    ...(node.location ? { location: node.location } : {}), evidence: node.evidence, metadata: node.metadata,
  };
}

function parseQuery(query: string): { verb: string; arg: string; expectedSnapshot?: string } {
  let text = query.trim().replace(/^Q\s+/i, "");
  const expectedSnapshot = /(?:^|\s)snapshot(?:Id)?=([^\s]+)/i.exec(text)?.[1];
  text = text.replace(/(?:^|\s)snapshot(?:Id)?=[^\s]+/ig, "").trim();
  const first = text.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  const verb = ALIASES[first] ?? first;
  if (!QUERIES.includes(verb) && verb !== "help") return { verb: "locate", arg: text, expectedSnapshot };
  return { verb, arg: text.slice(first.length).trim().replace(/^name=/, ""), expectedSnapshot };
}

function baseResult(snapshot: RepositorySnapshot, query: string): RepositoryQueryResult {
  return {
    ok: true, provider: "repository", snapshotId: snapshot.snapshotId, query: query.slice(0, 512), items: [], total: 0,
    truncated: 0, summary: { nodes: snapshot.nodes.length, edges: snapshot.edges.length,
      ...(query.length > 512 ? { queryEchoTruncated: true } : {}) }, diagnostics: [],
    capabilities: { queries: QUERIES, actions: false },
  };
}

function failure(snapshot: RepositorySnapshot, query: string, message: string): RepositoryQueryResult {
  return { ...baseResult(snapshot, query), ok: false, diagnostics: [message.slice(0, 512)] };
}

/** Queries graph facts only: never substitutes textual occurrences for resolved references. */
export function queryRepository(snapshot: RepositorySnapshot, query: string, options: RepositoryQueryOptions = {}): RepositoryQueryResult {
  const parsed = parseQuery(query);
  const expected = options.snapshotId ?? parsed.expectedSnapshot;
  if (expected && expected !== snapshot.snapshotId) return failure(snapshot, query, "Snapshot mismatch; refresh context before resolving a reference.");
  const sortedSymbols = snapshot.nodes.filter((node) => node.kind === "symbol").sort((a, b) => a.id.localeCompare(b.id));
  const handles = new Map(sortedSymbols.map((node, i) => [node.id, `S#${i + 1}`]));
  let arg = parsed.arg;
  if (/^[SM]#\d+$/.test(arg)) {
    if (!expected) return failure(snapshot, query, "Snapshot-bound handles require snapshotId (or snapshot=<id> in the query).");
    const candidates = arg.startsWith("S#") ? sortedSymbols : snapshot.nodes.filter(node => node.kind === "file").sort((a, b) => a.id.localeCompare(b.id));
    const symbol = candidates[Number(arg.slice(2)) - 1];
    if (!symbol) return failure(snapshot, query, "Symbol handle does not exist in this snapshot.");
    arg = symbol.id;
  }
  const exact = snapshot.nodes.filter((node) => node.id === arg || node.name === arg || node.file === arg);
  const exactIds = new Set(exact.map((node) => node.id));
  const matches = (node: RepositoryNode): boolean => !arg || exactIds.has(node.id)
    || `${node.name} ${node.file ?? ""} ${node.component}`.toLocaleLowerCase().includes(arg.toLocaleLowerCase());
  const result = baseResult(snapshot, query);
  let items: Array<Record<string, unknown>> = [];
  const nodes = snapshot.nodes;
  const nodeById = repositoryNodeLookup(snapshot);
  const edgeItem = (edge: RepositorySnapshot["edges"][number]): Record<string, unknown> => ({
    ...edge, fromNode: nodeById.has(edge.from) ? compactNode(nodeById.get(edge.from)!) : undefined,
    toNode: nodeById.has(edge.to) ? compactNode(nodeById.get(edge.to)!) : undefined,
  });
  const selecting = ["references", "impact", "dependencies"].includes(parsed.verb) && arg;
  if (selecting && exact.length > 1 && !exact.every((node) => node.file === arg)) {
    return failure(snapshot, query, `Ambiguous target '${arg}'; use a node ID or snapshot-bound symbol handle.`);
  }
  if (parsed.verb === "overview" || parsed.verb === "help") {
    result.summary = {
      ...result.summary, coverage: snapshot.coverage, manifestHash: snapshot.manifestHash,
      scenarioHash: snapshot.scenarioHash, capabilities: result.capabilities,
    };
    items = nodes.filter((node) => node.kind === "component" || node.kind === "package").map((node) => compactNode(node));
  } else if (parsed.verb === "coverage") {
    result.summary = { ...result.summary, coverage: snapshot.coverage };
    items = Object.entries(snapshot.files).map(([file, value]) => ({ file, ...value })).filter((item) => !arg || item.file.includes(arg));
  } else if (parsed.verb === "locate") {
    const exactNode = nodes.find(node => node.id === arg);
    const selected = exactNode ? [{ node: exactNode, score: 1000, selectionReasons: ["exact-node-id"], inWriteScope: false }] : rankRepositoryCandidates(snapshot, arg);
    const callGroups = groupRepositoryJavaCalls(nodes);
    const grouped = exactNode ? [] : rankRepositoryCandidates({ ...snapshot, nodes: callGroups }, arg);
    items = [...selected, ...grouped].sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
      .map(candidate => ({ ...compactNode(candidate.node, handles.get(candidate.node.id)),
        score: candidate.score, selectionReasons: candidate.selectionReasons,
        ...(candidate.node.kind === "java-call-group" ? { expandQuery: `Q calls ${candidate.node.id} snapshot=${snapshot.snapshotId}` } : {}) }));
    result.summary = { ...result.summary, retrieval: "deterministic lexical ranking; no model or dispatch inference",
      javaCallSitesGrouped: nodes.filter(node => node.kind === "java-call").length, javaCallGroups: callGroups.length,
      unresolvedMatches: selected.filter(candidate => candidate.node.evidence.resolution !== "complete").length };
  } else if (parsed.verb === "symbol") {
    const found = sortedSymbols.filter((node) => !arg || (exactIds.size ? exactIds.has(node.id) : matches(node)));
    if (arg && found.length > 1) return failure(snapshot, query, `Ambiguous symbol '${arg}'; choose a node ID or snapshot-bound handle.`);
    items = found.map((node) => compactNode(node, handles.get(node.id)));
  } else if (parsed.verb === "routes") {
    items = nodes.filter((node) => ["endpoint", "page", "http-call"].includes(node.kind) && matches(node)).map((node) => compactNode(node));
  } else if (parsed.verb === "infrastructure") {
    items = nodes.filter((node) => INFRASTRUCTURE.has(node.kind) && matches(node)).map((node) => compactNode(node));
  } else if (parsed.verb === "tests") {
    const tests = nodes.filter((node) => node.kind === "test" && node.metadata.suite !== true);
    const associated = new Set(snapshot.edges.filter((edge) => ["tests", "test-references", "test-exercises", "test-file-depends-on"].includes(edge.kind)
      && (exactIds.has(edge.from) || exactIds.has(edge.to))).flatMap((edge) => [edge.from, edge.to]));
    items = tests.filter((node) => !arg || (exactIds.size ? exactIds.has(node.id) || associated.has(node.id) : matches(node))).map((node) => compactNode(node));
    result.summary = { ...result.summary, observedCoverage: false, association: "static graph evidence only" };
  } else if (parsed.verb === "calls") {
    const callGroups = groupRepositoryJavaCalls(nodes);
    const group = callGroups.find(node => node.id === arg);
    if (group && !expected) return failure(snapshot, query, "Call group expansion requires snapshotId (or snapshot=<id>).");
    items = group ? nodes.filter(node => node.kind === "java-call" && node.file === group.file
      && node.metadata.owner === group.metadata.owner && node.metadata.qualifier === group.metadata.qualifier && node.name === group.name).map(node => compactNode(node))
      : arg ? nodes.filter(node => node.kind === "java-call" && (node.id === arg || node.metadata.owner === arg)).map(node => compactNode(node))
        : callGroups.map(node => ({ ...compactNode(node), expandQuery: `Q calls ${node.id} snapshot=${snapshot.snapshotId}` }));
    result.summary = { ...result.summary, callSites: "syntactic only; dispatch remains unresolved" };
  } else if (parsed.verb === "impact") {
    if (!arg || exactIds.size === 0) return failure(snapshot, query, "Impact requires an exact node ID, symbol name or file.");
    const affected = new Set(exactIds);
    let frontier = [...exactIds];
    for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
      const next: string[] = [];
      const frontierIds = new Set(frontier);
      for (const edge of snapshot.edges) {
        if (["references", "imports", "calls", "renders", "tests", "test-references", "test-exercises", "test-file-depends-on", "depends-on"].includes(edge.kind)
          && frontierIds.has(edge.to) && !affected.has(edge.from)) {
          affected.add(edge.from); next.push(edge.from);
        }
      }
      frontier = next;
    }
    items = nodes.filter((node) => affected.has(node.id)).map((node) => compactNode(node));
    result.summary = { ...result.summary, potentialImpact: true, traversalDepthLimit: 8, complete: false };
  } else {
    if (arg && exactIds.size === 0) return failure(snapshot, query, "References/dependencies require an exact node ID, symbol name or file.");
    items = snapshot.edges.filter((edge) => parsed.verb === "references"
      ? ["references", "calls", "renders", "imports"].includes(edge.kind) && (!arg || exactIds.has(edge.to))
      : ["imports", "depends-on", "builds", "runs", "connects-to"].includes(edge.kind) && (!arg || exactIds.has(edge.from) || exactIds.has(edge.to)))
      .map(edgeItem);
  }
  const limit = bounded(options.limit, 30, 1, 100);
  const maxChars = bounded(options.maxChars, 16_000, 2048, 50_000);
  const binding = digest(`${snapshot.snapshotId}\n${query}`).slice(0, 20);
  let offset = 0;
  if (options.cursor) {
    const cursor = /^(\d+):([a-f0-9]{20})$/.exec(options.cursor);
    if (!cursor || cursor[2] !== binding) return failure(snapshot, query, "Cursor is invalid or belongs to a different query/snapshot.");
    offset = Number(cursor[1]);
    if (!Number.isSafeInteger(offset) || offset > items.length) return failure(snapshot, query, "Cursor offset is invalid.");
  }
  result.total = items.length;
  let used = JSON.stringify(result).length;
  // Large aggregate diagnostics are available through paged coverage; keep every response bounded.
  if (used > maxChars / 2) {
    result.summary = { nodes: nodes.length, edges: snapshot.edges.length, detailsOmitted: "Request coverage with pagination for full diagnostics." };
    used = JSON.stringify(result).length;
  }
  let consumed = 0;
  for (const original of items.slice(offset, offset + limit)) {
    let item = original;
    if (JSON.stringify(item).length > maxChars / 2) {
      const file = typeof original.file === "string" ? original.file : undefined;
      const proof = record(original.evidence) ? original.evidence : undefined;
      item = { id: original.id, kind: original.kind, name: String(original.name ?? "").slice(0, 128),
        ...(file ? file.length <= 256 ? { file } : { filePreview: file.slice(0, 256), fileOmitted: true } : {}),
        ...(typeof original.from === "string" ? { from: original.from } : {}),
        ...(typeof original.to === "string" ? { to: original.to } : {}),
        component: original.component, evidence: proof ? { assurance: proof.assurance, resolution: proof.resolution } : undefined,
        location: original.location, detailOmitted: true };
    }
    const cost = JSON.stringify(item).length + 2;
    if (used + cost + 256 > maxChars) break;
    result.items.push(item); used += cost; consumed++;
  }
  result.truncated = Math.max(0, items.length - offset - consumed);
  if (result.truncated && consumed > 0) result.nextCursor = `${offset + consumed}:${binding}`;
  return result;
}

/** Reject stale or redirected sources before returning any graph context or source slices. */
export function repositoryContext(root: string, snapshot: RepositorySnapshot, query: string, options: RepositoryQueryOptions = {}): RepositoryQueryResult {
  let canonical: string;
  try {
    canonical = realpathSync(root);
    if (!sameRepositoryPath(canonical, realpathSync(snapshot.root))) return failure(snapshot, query, "Snapshot root mismatch.");
  } catch { return failure(snapshot, query, "Repository or snapshot root is unavailable."); }
  const expectedManifest = options.manifest ?? readRepositoryManifest(root).manifest;
  if (!expectedManifest) return failure(snapshot, query, "Repository manifest missing or invalid; provide the current external manifest explicitly or reanalyze.");
  if (expectedManifest && repositoryManifestHash(expectedManifest) !== snapshot.manifestHash) {
    return failure(snapshot, query, "Snapshot manifest changed; run repository analyze again.");
  }
  const result = queryRepository(snapshot, query, options);
  if (!result.ok) return result;
  const sourceFiles = new Set(options.includeSource && parseQuery(query).verb === "symbol"
    ? result.items.map(item => typeof item.file === "string" ? item.file : "") : []);
  const verifiedSources = new Map<string, string>();
  for (const [file, input] of Object.entries(snapshot.files)) {
    if (!input.hash) continue;
    try {
      if (isSensitiveRepositoryPath(file)) return failure(snapshot, query, `Snapshot contains prohibited sensitive source: ${file}`);
      const absolute = realpathSync(containedRepositoryPath(root, file));
      const delta = relative(canonical, absolute);
      if (delta === ".." || delta.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(delta)) {
        return failure(snapshot, query, `Source escapes repository root: ${file}`);
      }
      const source = readFileSync(absolute);
      if (digest(source) !== input.hash) return failure(snapshot, query, `Snapshot source changed: ${file}; run repository analyze again.`);
      if (sourceFiles.has(file)) verifiedSources.set(file, source.toString("utf8"));
    } catch {
      return failure(snapshot, query, `Snapshot source is unavailable: ${file}; run repository analyze again.`);
    }
  }
  const stale = validateRepositorySnapshot(root, snapshot);
  if (stale.length) return failure(snapshot, query, `Snapshot is stale: ${stale.slice(0, 3).join("; ")}; run repository analyze again.`);
  if (result.ok && options.includeSource && parseQuery(query).verb === "symbol") {
    for (const item of result.items) {
      const node = snapshot.nodes.find((candidate) => candidate.id === item.id);
      if (!node?.file || !node.location || !snapshot.files[node.file]?.hash) continue;
      const source = verifiedSources.get(node.file);
      if (source === undefined) return failure(snapshot, query, `Snapshot source is unavailable: ${node.file}`);
      item.source = source.slice(node.location.start, Math.min(node.location.end, node.location.start + 1500));
    }
    const budget = bounded(options.maxChars, 16_000, 2048, 50_000);
    if (JSON.stringify(result).length > budget) for (const item of result.items) delete item.source;
  }
  return result;
}

export function repositoryCairSnapshot(snapshot: RepositorySnapshot): CairSnapshot {
  const files = snapshot.nodes.filter((node) => node.kind === "file").sort((a, b) => a.id.localeCompare(b.id));
  const symbols = snapshot.nodes.filter((node) => node.kind === "symbol").sort((a, b) => a.id.localeCompare(b.id));
  const packages = snapshot.nodes.filter((node) => node.kind === "package");
  const apis = snapshot.nodes.filter((node) => node.kind === "endpoint");
  const tests = snapshot.nodes.filter((node) => node.kind === "test");
  const display = (value: unknown, fallback = "", limit = 256): string => typeof value === "string" ? value.slice(0, limit) : fallback;
  const view: CairSnapshot = {
    schemaVersion: CAIR_SCHEMA_VERSION, kind: "cair.snapshot", provider: "repository", snapshotId: snapshot.snapshotId,
    project: { name: display(snapshot.root.split(/[\\/]/).pop(), "repository", 128), version: "", type: "repository" },
    summary: { modules: files.length, symbols: symbols.length, edges: snapshot.edges.length,
      packages: snapshot.nodes.filter((node) => node.kind === "package").length,
      apis: snapshot.nodes.filter((node) => node.kind === "endpoint").length,
      tests: snapshot.nodes.filter((node) => node.kind === "test").length, diagnostics: snapshot.coverage.diagnostics.length },
    limits: { modules: 30, symbols: 30, packages: 30, apis: 30, tests: 30 },
    truncated: { modules: Math.max(0, files.length - 30), symbols: Math.max(0, symbols.length - 30),
      packages: Math.max(0, packages.length - 30), apis: Math.max(0, apis.length - 30), tests: Math.max(0, tests.length - 30) },
    lexicon: {
      modules: files.slice(0, 30).map((node, i) => ({ id: `M#${i + 1}`, file: node.file ?? node.name, packageImports: [], localImportCount: 0, localImports: [], contexts: [] })),
      symbols: symbols.slice(0, 30).map((node, i) => ({ id: `S#${i + 1}`, sourceId: node.id,
        kind: /class|record/i.test(display(node.metadata.symbolKind)) ? "code.class" : /interface/i.test(display(node.metadata.symbolKind)) ? "code.interface"
          : /enum/i.test(display(node.metadata.symbolKind)) ? "code.enum" : /type/i.test(display(node.metadata.symbolKind)) ? "code.type"
            : /variable|const/i.test(display(node.metadata.symbolKind)) ? "code.const" : "code.function", name: display(node.name),
        qualifiedName: `${node.component}:${display(node.name)}`, moduleId: null, file: node.file ?? "", span: node.location ?? { start: 0, end: 0 }, hash: node.evidence.sourceHash ?? "" })),
      packages: packages.slice(0, 30).map(node => ({ id: node.id, name: display(node.name), version: display(node.metadata.version, "unknown"), entrypoints: 0, exports: 0, runtime: null })),
      apis: apis.slice(0, 30).map(node => ({ id: node.id, packageId: node.component, packageName: node.component, entrypoint: node.file ?? "",
        name: display(node.name), kind: "endpoint", signature: `${display(node.metadata.method, "UNKNOWN")} ${display(node.metadata.path, display(node.name))}` })),
      tests: tests.slice(0, 30).map(node => ({ id: node.id, file: node.file ?? "", kind: "unknown", cost: "standard", confidence: "weak",
        covers: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [], tables: [], policies: [], components: [], packages: [] } })),
    },
    diagnostics: [], rules: [{ id: "REPOSITORY", name: "repository.read-only", description: "Static repository provider; snapshot-bound queries; CAIR mutations unavailable." }],
    nextActions: [`forge cair query "Q coverage snapshot=${snapshot.snapshotId}"`, "forge repository analyze --write --json"],
  };
  // Keep full paths/IDs truthful; omit tail entries rather than presenting shortened paths as real references.
  const sections = ["modules", "symbols", "packages", "apis", "tests"] as const;
  while (JSON.stringify(view).length > 16_000) {
    const section = [...sections].sort((a, b) => JSON.stringify(view.lexicon[b]).length - JSON.stringify(view.lexicon[a]).length)[0]!;
    if (!view.lexicon[section].length) break;
    view.lexicon[section].pop(); view.truncated[section]++;
  }
  return view;
}

export function unavailableRepositoryCairCommand(options: CairCommandOptions, message: string): CairCommandResult {
  const diagnostic = createDiagnostic({ severity: "error", code: "FORGE_REPOSITORY_CONTEXT", message });
  const snapshot: CairSnapshot = {
    schemaVersion: CAIR_SCHEMA_VERSION, kind: "cair.snapshot", provider: "repository", snapshotId: "unavailable",
    project: { name: "repository", version: "", type: "repository" },
    summary: { modules: 0, symbols: 0, edges: 0, packages: 0, apis: 0, tests: 0, diagnostics: 1 },
    limits: { modules: 0, symbols: 0, packages: 0, apis: 0, tests: 0 },
    truncated: { modules: 0, symbols: 0, packages: 0, apis: 0, tests: 0 },
    lexicon: { modules: [], symbols: [], packages: [], apis: [], tests: [] }, rules: [], diagnostics: [diagnostic],
    nextActions: ["forge repository analyze --write --json"],
  };
  return { ok: false, subcommand: options.subcommand, snapshot, observations: [], diagnostics: [diagnostic],
    query: { ok: false, query: options.query ?? "overview", observations: [], diagnostics: [diagnostic] },
    nextActions: snapshot.nextActions, exitCode: 1 };
}

export function runRepositoryCairCommand(options: CairCommandOptions, snapshot: RepositorySnapshot): CairCommandResult {
  const view = repositoryCairSnapshot(snapshot);
  const context = options.subcommand === "action"
    ? failure(snapshot, options.action ?? "", "CAIR mutations are unavailable for repository provider. Use the native project editing workflow.")
    : repositoryContext(options.workspaceRoot, snapshot, options.query ?? "overview", {
      snapshotId: options.snapshotId,
      manifest: readRepositoryManifest(options.workspaceRoot, { manifestPath: options.manifestPath }).manifest ?? undefined,
      includeSource: true,
    });
  const diagnostics = context.diagnostics.map((message) => createDiagnostic({ severity: "error", code: "FORGE_REPOSITORY_CONTEXT", message }));
  const observations = [{ code: "O REPOSITORY", text: `snapshot=${snapshot.snapshotId} matches=${context.total} truncated=${context.truncated}`,
    data: context as unknown as Record<string, unknown> }];
  return { ok: context.ok, subcommand: options.subcommand, snapshot: view,
    ...(options.subcommand === "query" ? { query: { ok: context.ok, query: options.query ?? "overview", observations, diagnostics } } : {}),
    ...(options.subcommand === "action" ? { action: { ok: false, dryRun: options.dryRun ?? false, plan: options.plan ?? false,
      actionCount: 0, steps: [], observations, diagnostics, journalPaths: [], planPaths: [] } } : {}),
    observations, diagnostics, nextActions: view.nextActions, exitCode: context.ok ? 0 : 1 };
}
