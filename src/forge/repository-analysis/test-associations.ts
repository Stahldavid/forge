import type { AnalysisSource, RepositoryNode, RepositorySnapshot } from "./types.ts";
import { evidence, makeEdge, makeNode } from "./adapters/common.ts";

/** Case-level static evidence. A file import alone never says a case exercises it. */
export function connectRepositoryTests(snapshot: RepositorySnapshot, sources: AnalysisSource[], importTargets: Map<string, string>): void {
  const byFile = new Map<string, RepositoryNode[]>();
  const byId = new Map(snapshot.nodes.map(node => [node.id, node]));
  const fileNodes = new Map(snapshot.nodes.filter(node => node.kind === "file").map(node => [node.file!, node]));
  const outgoing = new Map<string, typeof snapshot.edges>();
  const edgesByFile = new Map<string, typeof snapshot.edges>();
  for (const node of snapshot.nodes) if (node.file) { const list = byFile.get(node.file) ?? []; list.push(node); byFile.set(node.file, list); }
  for (const edge of snapshot.edges) if (["calls", "references"].includes(edge.kind)) {
    const list = outgoing.get(edge.from) ?? []; list.push(edge); outgoing.set(edge.from, list);
    const file = byId.get(edge.from)?.file;
    if (file && Number.isInteger(edge.metadata.offset)) { const local = edgesByFile.get(file) ?? []; local.push(edge); edgesByFile.set(file, local); }
  }
  for (const source of sources) {
    const nodes = byFile.get(source.path) ?? [];
    const cases = nodes.filter(node => node.kind === "test" && node.metadata.suite !== true && node.metadata.convention !== true);
    const imported = nodes.filter(node => node.kind === "import");
    const isTestFile = cases.length > 0 || /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[jt]sx?$/.test(source.path);
    if (!isTestFile) continue;
    if (!nodes.some(node => node.kind === "test")) snapshot.nodes.push(makeNode(source, "test", source.path.split("/").at(-1)!, 0, 0, { observedCoverage: false, convention: true }));
    for (const item of imported) {
      const target = importTargets.get(item.id), file = target && fileNodes.get(target);
      if (file) snapshot.edges.push(makeEdge(fileNodes.get(source.path)!, file, "test-file-depends-on", evidence(source, "syntactic", "partial"), { association: "static-import", observedCoverage: false }));
    }
    const sourceEdges = edgesByFile.get(source.path) ?? [];
    for (const test of cases) {
      const associatedFiles = new Set<string>();
      const body = test.metadata.testBody as { start?: number; end?: number } | undefined;
      const start = body?.start ?? test.location?.start ?? 0, end = body?.end ?? test.location?.end ?? 0;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) continue;
      const seeds = sourceEdges.filter(edge => Number(edge.metadata.offset) >= start && Number(edge.metadata.offset) < end);
      const visited = new Set<string>();
      const queue = seeds.map(edge => ({ edge, depth: 0 }));
      while (queue.length && visited.size < 128) {
        const { edge, depth } = queue.shift()!, target = byId.get(edge.to);
        if (!target || visited.has(`${edge.kind}:${target.id}`) || target.id === test.id) continue;
        visited.add(`${edge.kind}:${target.id}`);
        const proven = edge.evidence.assurance === "resolved" && edge.evidence.resolution === "complete";
        const kind = edge.kind === "calls" && proven ? "test-exercises" : "test-references";
        const metadata = { association: depth ? "static-helper-chain" : "case-body", depth, observedCoverage: false, ...(proven ? {} : { candidate: true }) };
        snapshot.edges.push(makeEdge(test, target, kind, evidence(source, proven ? "resolved" : "syntactic", proven ? "complete" : "partial"), metadata));
        if (target.file && target.file !== source.path && fileNodes.has(target.file)) { associatedFiles.add(target.file); snapshot.edges.push(makeEdge(test, fileNodes.get(target.file)!, "tests", evidence(source, "syntactic", "partial"), { association: "case-body", observedCoverage: false })); }
        if (edge.kind === "calls" && proven && depth < 3 && target.file === source.path) for (const next of outgoing.get(target.id) ?? []) queue.push({ edge: next, depth: depth + 1 });
      }
      // Imports with no exported symbol still give a case-level file reference.
      for (const reference of nodes.filter(node => node.kind === "import-reference" && node.location && node.location.start >= start && node.location.start < end)) {
        const target = importTargets.get(String(reference.metadata.importId)), file = target && fileNodes.get(target);
        if (file && !associatedFiles.has(target!)) {
          associatedFiles.add(target!);
          snapshot.edges.push(makeEdge(test, file, "test-references", evidence(source, "syntactic", "partial"), { association: "case-import-reference", observedCoverage: false }));
          snapshot.edges.push(makeEdge(test, file, "tests", evidence(source, "syntactic", "partial"), { association: "case-import-reference", observedCoverage: false }));
        }
      }
    }
  }
}
