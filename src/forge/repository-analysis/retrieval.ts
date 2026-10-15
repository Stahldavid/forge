import { createHash } from "node:crypto";
import type { RepositoryEdge, RepositoryNode, RepositorySnapshot } from "./types.ts";
import { repositoryNodeLookup, repositoryNodeSummaryLookup, repositoryEdgeLookup } from "./storage.ts";
import { compactRepositoryContextNode, compactRepositoryMetadata } from "./context-node.ts";

const STOP = new Set("a as ao aos o os de da das do dos e em no na nos nas um uma para por com que se este esta nesse nessa neste nesta eu voce quero favor adicione adicionar implemente implementar corrija corrigir ajuste alterar melhore melhorar fazer faca precisa projeto repositorio arquivo arquivos the and or of to for with in on at an this that please implement add fix update change improve repository project file files should must using use".split(" "));
const ALIASES: Record<string, string[]> = {
  autenticacao: ["auth", "authentication", "login"], autenticar: ["auth", "authenticate", "login"],
  autorizacao: ["authorization", "permission", "policy"], permissoes: ["permission", "permissions"],
  usuario: ["user", "users"], usuarios: ["user", "users"], pedidos: ["order", "orders"], pedido: ["order", "orders"],
  cliente: ["customer", "customers", "client", "clients"], clientes: ["customer", "customers", "client", "clients"],
  pagamento: ["payment", "payments"], pagamentos: ["payment", "payments"], fatura: ["invoice", "invoices"],
  excluir: ["delete", "remove"], exclusao: ["delete", "remove"], criar: ["create"], criacao: ["create"],
  consultar: ["query", "get", "list"], busca: ["search", "find"], teste: ["test", "tests"], testes: ["test", "tests"],
  agendamento: ["schedule", "scheduling", "booking"], agendamentos: ["schedule", "scheduling", "booking"],
  validacao: ["validate", "validation"], validar: ["validate", "validation"],
  homologacao: ["homologation", "staging"], categoria: ["category"], categorias: ["category", "categories"],
};
const SUPPORT_EDGES = new Set(["references", "calls", "imports", "renders", "routes-to", "tests", "test-references", "test-exercises", "test-file-depends-on", "implements", "depends-on", "connects-to", "builds", "runs"]);
const PRIORITY: Record<string, number> = { symbol: 20, endpoint: 20, "ui-component": 18, page: 18, test: 16, "container-service": 12, package: 10, component: 8, file: 5 };
const GENERIC_ACTION_TERMS = new Set("validate validation validar validacao check get set query consultar list search find busca create criar criacao update delete remove excluir exclusao test tests teste testes".split(" "));

export function normalizeRepositoryTerms(value: string): string[] {
  return value.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function repositoryQueryTerms(query: string): string[] {
  const result = new Set<string>();
  for (const term of normalizeRepositoryTerms(query.slice(0, 4000))) {
    if (term.length < 2 || STOP.has(term)) continue;
    result.add(term);
    for (const alias of ALIASES[term] ?? []) result.add(alias);
    for (const [portuguese, aliases] of Object.entries(ALIASES)) if (aliases.includes(term)) {
      result.add(portuguese); for (const alias of aliases) result.add(alias);
    }
  }
  return [...result].slice(0, 80);
}

function scopeMatch(file: string | undefined, scope: string[]): boolean {
  if (!file) return false;
  const normalize = (value: string) => value.replace(/\\/g, "/").split("/").filter(part => part && part !== ".").join("/");
  const actual = normalize(file);
  return scope.some(path => {
    const normalizedInput = path.replace(/\\/g, "/");
    if (!normalizedInput || normalizedInput.startsWith("/") || /^[a-zA-Z]:/.test(normalizedInput) || normalizedInput.split("/").includes("..")) return false;
    const prefix = normalize(path); return !prefix || actual === prefix || actual.startsWith(`${prefix}/`);
  });
}

export interface RepositoryCandidate {
  node: RepositoryNode;
  score: number;
  selectionReasons: string[];
  inWriteScope: boolean;
}

export function rankRepositoryCandidates(snapshot: RepositorySnapshot, query: string, options: { writeScope?: string[]; includeCallSites?: boolean } = {}): RepositoryCandidate[] {
  const text = query.trim();
  const terms = repositoryQueryTerms(text);
  const explicit = new Set(text.split(/[\s`"',;]+/).map(value => value.replace(/^name=/, "").replace(/^\.\//, "")).filter(Boolean));
  const scope = options.writeScope ?? [];
  const exactTargets = snapshot.nodes.filter(node => explicit.has(node.id) || explicit.has(node.name)
    || typeof node.metadata.qualifiedName === "string" && explicit.has(node.metadata.qualifiedName) || !!node.file && explicit.has(node.file));
  const anchorWords = new Set(exactTargets.flatMap(node => [node.id, node.name, node.metadata.qualifiedName, node.file]).filter((value): value is string => typeof value === "string"));
  // A standalone symbol/path, optionally surrounded by instruction words, defines a focused target.
  // Additional domain words (e.g. "agendamento ScheduleApi") intentionally retain cross-file discovery.
  const meaningfulWords = [...explicit].filter(word => !normalizeRepositoryTerms(word).every(term => STOP.has(term)));
  const focused = exactTargets.length > 0 && meaningfulWords.length === 1 && [...explicit].every(word => anchorWords.has(word)
    || normalizeRepositoryTerms(word).every(term => STOP.has(term)));
  const anchoredFiles = new Set(exactTargets.map(node => node.file).filter(Boolean));
  const domainTerms = terms.filter(term => !GENERIC_ACTION_TERMS.has(term));
  const termFrequency = new Map<string, number>();
  for (const node of snapshot.nodes) {
    const observed = new Set(normalizeRepositoryTerms(`${node.name} ${node.file ?? ""} ${node.metadata.qualifiedName ?? ""}`));
    for (const term of terms) if (observed.has(term)) termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
  }
  const candidates: RepositoryCandidate[] = [];
  for (const node of snapshot.nodes) {
    if (node.metadata.suite === true || node.kind === "test-suite") continue;
    const exactId = explicit.has(node.id);
    const exactName = explicit.has(node.name) || (typeof node.metadata.qualifiedName === "string" && explicit.has(node.metadata.qualifiedName));
    const exactPath = !!node.file && explicit.has(node.file);
    if (node.kind === "java-call" && !options.includeCallSites && !exactId) continue;
    const nameTerms = new Set(normalizeRepositoryTerms(node.name));
    const fileTerms = new Set(normalizeRepositoryTerms(`${node.file ?? ""} ${node.component}`));
    const descriptive = new Set(normalizeRepositoryTerms(["qualifiedName", "path", "method", "javaClass", "signature"]
      .map(key => typeof node.metadata[key] === "string" ? node.metadata[key] : "").join(" ")));
    const matched = terms.filter(term => nameTerms.has(term) || fileTerms.has(term) || descriptive.has(term));
    const inWriteScope = scopeMatch(node.file, scope);
    if (focused && !exactId && !exactName && !exactPath && !inWriteScope && !anchoredFiles.has(node.file)) continue;
    // Generic actions such as "validate" cannot independently attach another feature to a domain-specific instruction.
    if (!focused && domainTerms.length && matched.length && !exactId && !exactName && !exactPath && !inWriteScope
      && !matched.some(term => domainTerms.includes(term))) continue;
    // Sharing a test filename is not evidence that every sibling case exercises the requested feature.
    if (node.kind === "test" && terms.length && !exactId && !exactName && !exactPath && !inWriteScope
      && !terms.some(term => nameTerms.has(term) || descriptive.has(term))) continue;
    const reasons: string[] = [];
    let score = 0;
    if (exactId) { score += 1000; reasons.push("exact-node-id"); }
    if (exactName) { score += 250; reasons.push("exact-symbol-or-name"); }
    if (exactPath) { score += 220; reasons.push("exact-file-path"); }
    if (matched.length) {
      const rarity = (term: string) => 1 + Math.log(1 + snapshot.nodes.length / (1 + (termFrequency.get(term) ?? 0)));
      const proportion = matched.length / Math.max(1, terms.length);
      score += matched.reduce((total, term) => total + (nameTerms.has(term) ? 25 : descriptive.has(term) ? 15 : 8)
        * rarity(term) * (GENERIC_ACTION_TERMS.has(term) ? 0.5 : 1), 0) * (0.5 + 0.5 * proportion);
      reasons.push(`matched-terms:${matched.slice(0, 8).join(",")}`);
      if (focused) reasons.push("focused-exact-target");
    }
    if (!score && terms.length && !inWriteScope) continue;
    if (inWriteScope) { score += score ? 80 : 10; reasons.push("within-declared-write-scope"); }
    if (!score && !["component", "package", "endpoint", "page", "symbol", "ui-component", "test"].includes(node.kind)) continue;
    score += PRIORITY[node.kind] ?? 0;
    if (node.kind === "symbol") {
      const declaration = typeof node.metadata.symbolKind === "string" ? node.metadata.symbolKind : "";
      if (node.metadata.exported === true) { score += 40; reasons.push("exported-declaration"); }
      else if (/function|method|class|interface|record/i.test(declaration)) { score += 15; reasons.push("callable-or-type-declaration"); }
      else if (/variable|const/i.test(declaration)) score -= 10;
    }
    score += node.evidence.assurance === "resolved" ? 8 : node.evidence.assurance === "syntactic" ? 5 : node.evidence.assurance === "declared" ? 3 : 0;
    score += node.evidence.resolution === "complete" ? 3 : 0;
    if (!reasons.length) reasons.push("representative-context");
    candidates.push({ node, score, selectionReasons: reasons, inWriteScope });
  }
  return candidates.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
}

/** Aggregate syntactic Java call sites; this never claims dispatch/type resolution. */
export function groupRepositoryJavaCalls(nodes: RepositoryNode[]): RepositoryNode[] {
  const groups = new Map<string, { first: RepositoryNode; count: number; samples: string[] }>();
  for (const node of nodes) {
    if (node.kind !== "java-call") continue;
    const key = JSON.stringify([node.file, node.metadata.owner, node.metadata.qualifier, node.name]);
    const group = groups.get(key) ?? { first: node, count: 0, samples: [] };
    group.count++; if (group.samples.length < 3) group.samples.push(node.id); groups.set(key, group);
  }
  return [...groups].map(([key, group]) => {
    const first = group.first;
    return { ...first, id: `java-call-group:${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
      kind: "java-call-group", metadata: { owner: first.metadata.owner, qualifier: first.metadata.qualifier,
        callSiteCount: group.count, callSiteSampleIds: group.samples, resolution: "syntactic-call-sites-only" } };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export interface RepositoryContextSelectionOptions { writeScope?: string[]; maxChars?: number; maxNodes?: number; maxEdges?: number }
export interface RepositoryContextPacket {
  provider: "repository";
  snapshotId: string;
  writeScope: string[];
  writeScopeOmitted?: true;
  queryTerms: string[];
  limitations: string[];
  nodes: Array<{ id: string; kind: string; name: string; file?: string; component: string; location?: RepositoryNode["location"]; evidence: RepositoryNode["evidence"]; metadata: Record<string, unknown>; access: "write-scope" | "read-only"; selectionReasons: string[] }>;
  edges: Array<Pick<RepositoryEdge, "id" | "from" | "to" | "kind" | "evidence" | "metadata">>;
  groups: Array<{ subject: string; consumers: string[]; tests: string[]; related: string[] }>;
  metrics: { candidates: number; selected: number; readOnlyExpansion: number; unresolvedCandidates: number; javaCallSitesOmitted: number; unsupportedFiles: number; analysisErrors: number; omittedRelations: number };
  truncated: boolean;
}

/** Deterministic context planning only. Scope is copied verbatim and never widened by graph expansion. */
export function selectRepositoryContext(snapshot: RepositorySnapshot, query: string, options: RepositoryContextSelectionOptions = {}): RepositoryContextPacket {
  const bounded = (value: number | undefined, fallback: number, maximum: number) => Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value!))) : fallback;
  const maxChars = Math.max(2048, bounded(options.maxChars, 12000, 50000));
  const maxNodes = bounded(options.maxNodes, 30, 100);
  const maxEdges = bounded(options.maxEdges, 30, 100);
  const scope = [...(options.writeScope ?? [])];
  const allRanked = rankRepositoryCandidates(snapshot, query, { writeScope: scope });
  // A declared scope supplies the task's anchors; lexical matches elsewhere are discovered only
  // through graph evidence, rather than unrelated repositories/features sharing a domain word.
  const scoped = allRanked.filter(candidate => candidate.inWriteScope);
  const ranked = scope.length ? scoped : allRanked;
  const packet: RepositoryContextPacket = { provider: "repository", snapshotId: snapshot.snapshotId, writeScope: scope, queryTerms: repositoryQueryTerms(query),
    limitations: snapshot.coverage.limitations.slice(0, 5).map(item => item.slice(0, 256)),
    nodes: [], edges: [], groups: [], metrics: { candidates: ranked.length, selected: 0, readOnlyExpansion: 0,
      unresolvedCandidates: ranked.filter(candidate => candidate.node.evidence.resolution !== "complete").length,
      javaCallSitesOmitted: snapshot.nodes.filter(node => node.kind === "java-call").length,
      unsupportedFiles: snapshot.coverage.unsupported, analysisErrors: snapshot.coverage.errors, omittedRelations: 0 }, truncated: false };
  const byId = repositoryNodeLookup(snapshot);
  const summaries = repositoryNodeSummaryLookup(snapshot);
  const adjacency = repositoryEdgeLookup(snapshot);
  const httpByFile = new Map<string, RepositoryNode[]>();
  for (const node of snapshot.nodes) if (node.kind === "http-call" && node.file) {
    const calls = httpByFile.get(node.file) ?? []; calls.push(node); httpByFile.set(node.file, calls);
  }
  const pickMetadata = compactRepositoryMetadata;
  const selected = new Set<string>();
  const addNode = (node: RepositoryNode, reasons: string[]): boolean => {
    if (selected.has(node.id)) return true;
    if (packet.nodes.length >= maxNodes) return false;
    const inScope = scopeMatch(node.file, scope);
    const entry = compactRepositoryContextNode(node, inScope ? "write-scope" : "read-only", reasons);
    packet.nodes.push(entry);
    if (JSON.stringify(packet).length + 300 > maxChars) { packet.nodes.pop(); return false; }
    selected.add(node.id); return true;
  };
  // Reserve most node capacity for consumers/tests, rather than filling it with local declarations.
  const seedCapacity = Math.max(1, Math.min(4, Math.floor(maxNodes / 3)));
  const exactCandidates = ranked.filter(candidate => candidate.selectionReasons.some(reason => ["exact-node-id", "exact-symbol-or-name"].includes(reason)));
  const declarations = ranked.filter(candidate => candidate.node.kind !== "file" && candidate.node.kind !== "import-reference"
    && (candidate.node.metadata.exported === true || /function|method|class|interface|record/i.test(String(candidate.node.metadata.symbolKind))));
  const seedPool = exactCandidates.length ? exactCandidates : declarations.length ? declarations : ranked;
  const capacity = scoped.length && scope.length === 1 && /\.[^/\\]+$/.test(scope[0]!) ? 1 : seedCapacity;
  const distinctFiles = new Set<string>();
  const diverse = scope.length > 1 ? seedPool.filter(candidate => {
    const key = candidate.node.file ?? candidate.node.id;
    if (distinctFiles.has(key)) return false;
    distinctFiles.add(key); return true;
  }) : seedPool;
  const seeds = diverse.slice(0, capacity);
  for (const candidate of seedPool) if (seeds.length < capacity && !seeds.includes(candidate)) seeds.push(candidate);
  for (const seed of seeds) addNode(seed.node, seed.selectionReasons);
  // Old snapshots may attach a request to its local response variable. Containment selects the
  // existing request fact as context without creating a semantic edge or dispatch claim.
  for (const seed of seeds) if (seed.node.file && seed.node.location) {
    for (const call of httpByFile.get(seed.node.file) ?? []) if (call.location
      && call.location.start >= seed.node.location.start && call.location.end <= seed.node.location.end) {
      addNode(call, ["lexical-declaration-contained-http-call", "read-only-context-expansion-does-not-authorize-edits"]);
    }
  }
  const related: RepositoryEdge[] = [];
  const seenEdges = new Set<string>();
  const acceptedPairs = new Set<string>();
  let frontier = new Set(selected);
  for (let depth = 0; depth < 2 && frontier.size; depth++) {
    // A second hop follows concrete control/UI connections only. Test cases, shared files and
    // import inventories never become bridges to unrelated sibling cases or imported features.
    const traversable = new Set([...frontier].filter(id => {
      const node = summaries.get(id);
      return depth === 0 || !!node && !["file", "test", "test-suite", "import", "java-call"].includes(node.kind) && node.suite !== true;
    }));
    const incident = new Map<string, RepositoryEdge>();
    for (const id of traversable) for (const edge of adjacency.get(id) ?? []) incident.set(edge.id, edge);
    // Reserve the complete request/endpoint capsule ahead of dense consumer/local-reference
    // inventories. This follows existing edges and is still capped at two graph hops.
    if (depth === 0) for (const edge of [...incident.values()]) if (edge.kind === "calls") {
      const request = [edge.from, edge.to].find(id => summaries.get(id)?.kind === "http-call");
      if (request) for (const target of adjacency.get(request) ?? []) if (target.kind === "calls"
        && target.from === request && summaries.get(target.to)?.kind === "endpoint") incident.set(target.id, target);
    }
    const edgePriority = (edge: RepositoryEdge) => {
      const from = summaries.get(edge.from), to = summaries.get(edge.to);
      if (edge.kind === "calls" && from?.kind === "http-call" && to?.kind === "endpoint") return -7;
      if (edge.kind === "calls" && (from?.kind === "http-call" || to?.kind === "http-call")) return -6;
      if (edge.kind === "test-exercises") return -5;
      if (edge.kind === "test-references") return -4;
      if (edge.kind === "tests") return -3;
      if (from?.file && to?.file && from.file !== to.file && ["calls", "renders", "routes-to"].includes(edge.kind)) return -2;
      if (from?.file && to?.file && from.file !== to.file) return -1;
      return edge.kind === "references" && edge.metadata.binding === "lexical" ? 2 : 0;
    };
    const wave = [...incident.values()].filter(edge => !seenEdges.has(edge.id) && SUPPORT_EDGES.has(edge.kind)
      && (depth === 0 || ["calls", "renders", "routes-to"].includes(edge.kind))
      && (traversable.has(edge.from) || traversable.has(edge.to)
        || depth === 0 && edge.kind === "calls" && summaries.get(edge.from)?.kind === "http-call" && summaries.get(edge.to)?.kind === "endpoint")).sort((a, b) => {
        return edgePriority(a) - edgePriority(b) || a.id.localeCompare(b.id);
      });
    related.push(...wave); wave.forEach(edge => seenEdges.add(edge.id));
    const next = new Set<string>();
    for (const edge of wave) {
      if (packet.edges.length >= maxEdges) break;
      const requiredNodes = new Set([edge.from, edge.to].filter(id => !selected.has(id))).size;
      if (packet.nodes.length + requiredNodes > maxNodes) continue;
      const minimumChars = [...new Set([edge.from, edge.to])].filter(id => !selected.has(id)).reduce((sum, id) => sum + (summaries.get(id)?.minimumContextChars ?? 0), 0);
      if (JSON.stringify(packet).length + minimumChars + 300 > maxChars) continue;
      const from = byId.get(edge.from), to = byId.get(edge.to);
      if (!from || !to || from.kind === "java-call" || to.kind === "java-call" || from.kind === "test-suite" || to.kind === "test-suite" || from.metadata.suite === true || to.metadata.suite === true) continue;
      const pair = JSON.stringify([edge.from, edge.to, edge.kind]);
      if (acceptedPairs.has(pair)) continue;
      const before = packet.nodes.length;
      const oldIds = new Set(selected);
      const graphDepth = depth + (traversable.has(edge.from) || traversable.has(edge.to) ? 1 : 2);
      const reasons = [`graph-neighbor:${edge.kind}`, `graph-depth:${graphDepth}`, "read-only-context-expansion-does-not-authorize-edits"];
      if (addNode(from, reasons) && addNode(to, reasons)) {
        packet.edges.push({ id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, evidence: edge.evidence,
          metadata: pickMetadata(edge.metadata, ["binding", "association", "runtimeRoutingVerified", "pathPatternMatch", "requestPathPattern", "resolvedPath", "ambiguity", "scenario", "offset"]) });
        if (JSON.stringify(packet).length + 300 <= maxChars) {
          acceptedPairs.add(pair);
          for (const id of selected) if (!oldIds.has(id)) next.add(id);
          continue;
        }
        packet.edges.pop();
      }
      packet.nodes.splice(before); for (const id of selected) if (!oldIds.has(id)) selected.delete(id);
    }
    frontier = next;
  }
  for (const candidate of ranked) addNode(candidate.node, candidate.selectionReasons);
  for (const seed of seeds.filter(seed => selected.has(seed.node.id))) {
    const incoming = packet.edges.filter(edge => edge.to === seed.node.id);
    const testRelation = (edge: RepositoryEdge | { kind: string }) => ["tests", "test-references", "test-exercises"].includes(edge.kind);
    const group = { subject: seed.node.id, consumers: [...new Set(incoming.filter(edge => !testRelation(edge)).map(edge => edge.from))],
      tests: [...new Set(incoming.filter(testRelation).map(edge => edge.from))],
      related: [...new Set(packet.edges.filter(edge => edge.from === seed.node.id).map(edge => edge.to))] };
    packet.groups.push(group);
    if (JSON.stringify(packet).length + 200 > maxChars) { packet.groups.pop(); packet.truncated = true; break; }
  }
  packet.metrics.selected = packet.nodes.length;
  packet.metrics.readOnlyExpansion = packet.nodes.filter(node => node.access === "read-only").length;
  packet.metrics.omittedRelations = related.length - packet.edges.length;
  packet.truncated ||= ranked.some(candidate => !selected.has(candidate.node.id)) || packet.metrics.omittedRelations > 0;
  // Scope/query headers can themselves exceed the requested budget. Omit scope values without changing authorization.
  if (JSON.stringify(packet).length > maxChars) {
    packet.queryTerms = []; packet.limitations = []; packet.groups = []; packet.nodes = []; packet.edges = [];
    packet.writeScope = []; packet.writeScopeOmitted = true; packet.metrics.selected = 0; packet.metrics.readOnlyExpansion = 0; packet.truncated = true;
  }
  return packet;
}
