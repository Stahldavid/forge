import { readRepositoryManifest } from "../repository-manifest/index.ts";
import { analyzeRepository } from "../repository-analysis/analyze.ts";
import { repositoryContext } from "../repository-analysis/context.ts";

export interface FabricRepositoryContextMetadata {
  provider: "repository";
  phase: "prepared-input";
  status: "ready" | "unavailable";
  sourceRoot: string;
  cloneRoot: string;
  snapshotId?: string;
  diagnostics: string[];
}

/** Optional static maps, taken from the clone after upstream composition and preparation.
 * Nothing is written: an analysis cache in the clone would violate artifact write scope.
 * Suggested checks are never executed here and maps never relax publication obligations.
 */
export async function prepareFabricRepositoryContext(sourceRoot: string, cloneRoot: string, query: string, scope: string[] = []): Promise<{ metadata: FabricRepositoryContextMetadata; prompt: string } | undefined> {
  let loaded: ReturnType<typeof readRepositoryManifest>;
  try { loaded = readRepositoryManifest(cloneRoot); }
  catch { loaded = { manifest: null, diagnostics: ["Repository manifest cannot be read safely"] }; }
  const { manifest, diagnostics } = loaded;
  if (!manifest && !diagnostics.length) return undefined;
  // JSON parser diagnostics can echo source values. Public worker metadata needs only
  // an actionable status; detailed manifest validation is a separate user operation.
  const metadata: FabricRepositoryContextMetadata = { provider: "repository", phase: "prepared-input", status: "unavailable", sourceRoot, cloneRoot, diagnostics: diagnostics.length ? ["Repository manifest missing, invalid or unsafe"] : [] };
  if (!manifest) return { metadata, prompt: "Repository maps unavailable: invalid manifest. Inspect the code directly; no analysis result is claimed." };
  try {
    const snapshot = await analyzeRepository(cloneRoot, manifest, { write: false });
    // Executor prompts are natural-language instructions, not CAIR query programs.
    const context = await repositoryContext(cloneRoot, snapshot, `locate ${query.slice(0, 1000)}`, { snapshotId: snapshot.snapshotId, maxChars: 12000, limit: 20, includeSource: false });
    metadata.snapshotId = snapshot.snapshotId;
    metadata.diagnostics = context.diagnostics.slice(0, 20).map(item => item.slice(0, 512));
    if (!context.ok) return { metadata, prompt: "Repository maps unavailable or stale. Inspect current clone files directly; do not reuse source-checkout analysis." };
    metadata.status = "ready";
    const checks = (manifest.checks ?? []).slice(0, 20).map(check => ({ id: check.id, component: check.component }));
    const scoped = snapshot.nodes.filter(node => node.file && scope.some(path => node.file === path || node.file!.startsWith(`${path}/`)));
    const matches = new Set(context.items.map(item => item.id));
    const candidates = scoped.length ? scoped : snapshot.nodes.filter(node => ["component", "package", "endpoint", "page"].includes(node.kind));
    const rank = (node: typeof snapshot.nodes[number]) => matches.has(node.id) ? 0 : ["symbol", "endpoint", "ui-component", "page", "test"].includes(node.kind) ? 1 : node.kind === "file" ? 3 : 2;
    const selected = [...candidates].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id)).slice(0, 20);
    const ids = new Set(selected.map(node => node.id));
    const connected = snapshot.edges.filter(edge => ids.has(edge.from) || ids.has(edge.to));
    const nodeById = new Map(snapshot.nodes.map(node => [node.id, node]));
    const nodes = [...selected];
    const edges: typeof snapshot.edges = [];
    for (const edge of connected) {
      const additions = [...new Set([edge.from, edge.to])].filter(id => !ids.has(id));
      if (edges.length >= 20 || nodes.length + additions.length > 30 || additions.some(id => !nodeById.has(id))) continue;
      for (const id of additions) { nodes.push(nodeById.get(id)!); ids.add(id); }
      edges.push(edge);
    }
    const compact = nodes.map(({ id, kind, name, file, location, evidence }) => ({ id, kind, name, file, location, evidence }));
    // The entire packet has a hard bound in addition to the query's own item budget.
    // If the structured result cannot fit, omit it rather than truncate JSON evidence.
    const packet = { snapshotId: snapshot.snapshotId, cloneRoot, nodes: compact, edges: edges.map(({ id, from, to, kind, evidence }) => ({ id, from, to, kind, evidence })), truncated: candidates.length > selected.length || connected.length > edges.length || context.truncated > 0, coverage: { found: snapshot.coverage.found, analyzed: snapshot.coverage.analyzed, unsupported: snapshot.coverage.unsupported, errors: snapshot.coverage.errors, limitations: snapshot.coverage.limitations.slice(0, 10) }, suggestedCheckIds: checks };
    while (JSON.stringify(packet).length > 16000 && packet.nodes.length) {
      packet.truncated = true;
      const removed = packet.nodes.pop()!;
      packet.edges = packet.edges.filter(edge => edge.from !== removed.id && edge.to !== removed.id);
    }
    const serialized = JSON.stringify(packet);
    const text = serialized.length <= 16000 ? serialized : JSON.stringify({ snapshotId: snapshot.snapshotId, cloneRoot, truncated: true, reason: "Context packet exceeded budget; inspect clone directly" });
    return { metadata, prompt: `Repository analysis of THIS prepared clone (static evidence, not executed coverage). Source project identity: ${sourceRoot}. Snapshot handles apply only to this snapshot. Suggested checks are informational; only authorized workflow executors run checks. Maps do not replace required review, verification or file scope.\n${text}` };
  } catch {
    // Analysis is an optional aid. Do not expose parser exceptions or claim a fallback
    // graph from the source checkout; the existing worker and publication gates remain.
    metadata.diagnostics = ["Repository analysis unavailable in this prepared clone"];
    return { metadata, prompt: "Repository analysis failed in this clone. Inspect the current files directly; no map evidence is available." };
  }
}
