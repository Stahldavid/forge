import { posix } from "node:path";
import { validateRepositoryManifest } from "../repository-manifest/index.ts";
import type { RepositoryCheck } from "../repository-manifest/types.ts";
import { componentRootPath, repositoryGlobMatches } from "./scanner.ts";
import type { RepositorySnapshot } from "./types.ts";
import { repositoryNodeLookup } from "./storage.ts";

export interface RepositoryCheckTask {
  /** Repository-relative file/directory scopes, with optional globs. */
  scope?: string[];
  nodeIds?: string[];
  components?: string[];
  /** Caller-reported capabilities, never probed or inferred by this selector. */
  capabilities?: string[];
}

export interface SuggestedRepositoryCheck {
  id: string;
  component: string;
  argv: string[];
  cwd: string;
  category?: RepositoryCheck["category"];
  cost?: RepositoryCheck["cost"];
  requires: string[];
  reasons: string[];
  requirements: { status: "unknown" | "satisfied" | "missing"; missing: string[] };
  execution: "not-executed";
}

export interface RepositoryCheckSelection {
  checks: SuggestedRepositoryCheck[];
  diagnostics: string[];
  execution: "not-executed";
}

const contained = (path: string) => typeof path === "string" && path.length > 0 && path.length <= 4096 && !/^[\\/]/.test(path) && !/[\\:\u0000-\u001f]/.test(path) && !path.split("/").includes("..");
const normalize = (path: string) => posix.normalize(path).replace(/\/$/, "") || ".";
const contains = (parent: string, path: string) => parent === "." || path === parent || path.startsWith(`${parent}/`);
const matches = (path: string, scope: string) => contains(scope, path) || repositoryGlobMatches(path, scope);
const globPrefix = (glob: string) => glob.split(/[?*]/, 1)[0]!.replace(/\/$/, "") || ".";

/** Pure relevance selection. Declarations provide argv, never permission or execution evidence. */
export function selectRepositoryChecks(snapshot: RepositorySnapshot, task: RepositoryCheckTask): RepositoryCheckSelection {
  const diagnostics: string[] = [];
  const result: RepositoryCheckSelection = { checks: [], diagnostics, execution: "not-executed" };
  const validation = validateRepositoryManifest(snapshot.manifest);
  if (!validation.manifest) { diagnostics.push(...validation.diagnostics); return result; }
  for (const field of ["scope", "nodeIds", "components", "capabilities"] as const) {
    const entries = task[field];
    if (entries !== undefined && (!Array.isArray(entries) || entries.length > 1000 || !entries.every(entry => typeof entry === "string" && entry.length > 0 && entry.length <= 4096))) {
      diagnostics.push(`Invalid task ${field}`); return result;
    }
  }
  if (task.scope?.some(path => !contained(path))) { diagnostics.push("Task scope must contain repository-relative paths/globs"); return result; }
  const scopes = [...new Set((task.scope ?? []).map(normalize))];
  const explicitComponents = new Set(task.components ?? []);
  const components = new Map(snapshot.manifest.components.map(component => [component.id, component]));
  for (const component of explicitComponents) if (!components.has(component)) diagnostics.push(`Unknown task component: ${component}`);
  const nodeIds = new Set(task.nodeIds ?? []);
  const nodes = nodeIds.size ? repositoryNodeLookup(snapshot) : new Map();
  for (const nodeId of nodeIds) if (!nodes.has(nodeId)) diagnostics.push(`Unknown task node: ${nodeId}`);
  const relatedIds = new Set<string>();
  if (nodeIds.size) for (const edge of snapshot.edges) {
    // Unresolved/inferred cross-component links do not justify check selection.
    if (edge.evidence.resolution !== "complete" || !["declared", "resolved"].includes(edge.evidence.assurance)) continue;
    if (nodeIds.has(edge.from)) relatedIds.add(edge.to);
    if (nodeIds.has(edge.to)) relatedIds.add(edge.from);
  }
  const nodeFiles = new Map<string, Set<string>>(), nodeComponents = new Set<string>(), relatedComponents = new Set<string>();
  for (const nodeId of [...nodeIds, ...relatedIds]) {
    const node = nodes.get(nodeId); if (!node) continue;
    (nodeIds.has(nodeId) ? nodeComponents : relatedComponents).add(node.component);
    if (node.file) { const files = nodeFiles.get(node.component) ?? new Set<string>(); files.add(node.file); nodeFiles.set(node.component, files); }
  }
  const scopedFiles = new Map<string, Set<string>>();
  if (scopes.length) for (const [file, metadata] of Object.entries(snapshot.files)) {
    if (!scopes.some(scope => matches(file, scope))) continue;
    const files = scopedFiles.get(metadata.component) ?? new Set<string>(); files.add(file); scopedFiles.set(metadata.component, files);
  }
  const componentScopes = new Map(snapshot.manifest.components.map(component => {
    const root = componentRootPath(component.root) || ".";
    return [component.id, scopes.filter(scope => contains(globPrefix(scope), root) || contains(root, globPrefix(scope)))] as const;
  }));
  for (const check of snapshot.manifest.checks ?? []) {
    const component = components.get(check.component)!;
    const root = componentRootPath(component.root) || ".";
    const reasons: string[] = [];
    if (explicitComponents.has(check.component)) reasons.push(`task-component:${check.component}`);
    if (nodeComponents.has(check.component)) reasons.push(`task-node-component:${check.component}`);
    if (relatedComponents.has(check.component)) reasons.push(`related-node-component:${check.component}`);
    const files = new Set([...(nodeFiles.get(check.component) ?? []), ...(scopedFiles.get(check.component) ?? [])]);
    const touchingScopes = componentScopes.get(check.component)!;
    if (touchingScopes.length || scopedFiles.get(check.component)?.size) reasons.push("task-scope-overlaps-component");
    if (!reasons.length) continue;
    if (check.files?.length && !explicitComponents.has(check.component)) {
      const patterns = check.files.map(pattern => normalize(root === "." ? pattern : `${root}/${pattern}`));
      const fileMatch = [...files].some(file => patterns.some(pattern => matches(file, pattern)));
      // Directory scopes include future/unindexed files. Compare literal glob prefixes
      // conservatively, without inventing dependency or test coverage evidence.
      const scopeMatch = touchingScopes.some(scope => {
        const literalFile = !/[?*]/.test(scope) && (snapshot.files[scope] !== undefined || posix.extname(scope) !== "");
        if (literalFile) return patterns.some(pattern => matches(scope, pattern));
        return patterns.some(pattern => contains(scope, globPrefix(pattern)) || contains(globPrefix(pattern), globPrefix(scope)));
      });
      if (!fileMatch && !scopeMatch) continue;
      reasons.push(fileMatch ? "check-files-match-task" : "check-files-overlap-scope");
    }
    const requires = [...(check.requires ?? [])];
    const known = task.capabilities !== undefined;
    const available = new Set(task.capabilities ?? []);
    const missing = requires.filter(capability => !available.has(capability));
    result.checks.push({
      id: check.id, component: check.component, argv: [...check.argv], cwd: check.cwd ?? ".",
      ...(check.category ? { category: check.category } : {}), ...(check.cost ? { cost: check.cost } : {}),
      requires, reasons: [...new Set(reasons)], requirements: { status: !requires.length || known && !missing.length ? "satisfied" : known ? "missing" : "unknown", missing: known ? missing : [] },
      execution: "not-executed",
    });
  }
  // Cheap checks first only when the manifest declared cost; stable IDs break ties.
  const rank = { low: 0, medium: 1, high: 2 };
  result.checks.sort((a, b) => (a.cost ? rank[a.cost] : 1) - (b.cost ? rank[b.cost] : 1) || a.id.localeCompare(b.id));
  return result;
}
