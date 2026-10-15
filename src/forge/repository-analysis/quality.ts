import type { RepositorySnapshot } from "./types.ts";
import { selectRepositoryContext } from "./retrieval.ts";

export interface RepositoryQualitySummary {
  completeness: "partial";
  runtimeObserved: false;
  factsReused: number;
  unresolvedLocalImports: number;
  unresolvedUiReferences: number;
  dynamicHttpCalls: number;
  httpEndpointLinks: number;
  analysisErrors: number;
}
export function repositoryQualitySummary(snapshot: RepositorySnapshot): RepositoryQualitySummary {
  const httpCalls = new Set<string>(), endpoints = new Set<string>();
  for (const node of snapshot.nodes) {
    if (node.kind === "http-call") httpCalls.add(node.id);
    if (node.kind === "endpoint") endpoints.add(node.id);
  }
  const aliases = new Map(snapshot.manifest.components.map(component => [component.id, Object.keys(component.analysis?.aliases ?? {})]));
  return { completeness: "partial", runtimeObserved: false, factsReused: snapshot.coverage.reused,
    unresolvedLocalImports: snapshot.nodes.filter(node => node.kind === "import" && node.evidence.resolution === "unresolved"
      && (/^(?:\.|~\/|@\/|~~\/|@@\/)/.test(node.name) || typeof node.metadata.resolutionAlias === "string" || (aliases.get(node.component) ?? []).some(alias => node.name === alias || node.name.startsWith(`${alias}/`)))).length,
    unresolvedUiReferences: snapshot.nodes.filter(node => node.kind === "ui-reference" && node.metadata.resolved !== true).length,
    dynamicHttpCalls: snapshot.nodes.filter(node => node.kind === "http-call" && typeof node.metadata.path !== "string").length,
    httpEndpointLinks: snapshot.edges.filter(edge => edge.kind === "calls" && httpCalls.has(edge.from) && endpoints.has(edge.to)).length,
    analysisErrors: snapshot.coverage.errors };
}
export interface RepositoryQualityCase { id: string; query: string; scope?: string[]; expectedFiles: string[]; expectedTests?: string[]; forbiddenFiles?: string[]; forbiddenTests?: string[] }

/** Shared reviewed-case validation, without querying the graph or executing anything. */
export function validateRepositoryQualityCases(cases: unknown): asserts cases is RepositoryQualityCase[] {
  const text = (value: unknown, maximum: number) => typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value);
  const relative = (value: unknown) => text(value, 4096) && !/^[\/\\]|[:\\]/.test(value as string) && !(value as string).split("/").includes("..");
  const list = (value: unknown, paths: boolean) => Array.isArray(value) && value.length <= 200 && new Set(value).size === value.length && value.every(item => paths ? relative(item) : text(item, 512));
  if (!Array.isArray(cases) || !cases.length || cases.length > 100 || new Set(cases.map(item => item?.id)).size !== cases.length || cases.some(item => !item
    || Object.keys(item).some(key => !["id", "query", "scope", "expectedFiles", "expectedTests", "forbiddenFiles", "forbiddenTests"].includes(key))
    || !text(item.id, 128) || !text(item.query, 4000) || !list(item.expectedFiles, true)
    || ["scope", "forbiddenFiles"].some(key => (item as any)[key] !== undefined && !list((item as any)[key], true))
    || ["expectedTests", "forbiddenTests"].some(key => (item as any)[key] !== undefined && !list((item as any)[key], false)))) throw new Error("Invalid repository quality cases");
}

/** Artifact quality, not model productivity or executed application coverage. */
export function evaluateRepositoryQuality(snapshot: RepositorySnapshot, cases: RepositoryQualityCase[], options: { maxChars?: number } = {}) {
  validateRepositoryQualityCases(cases);
  const results = cases.map(item => {
    const packet = selectRepositoryContext(snapshot, item.query, { writeScope: item.scope, maxChars: options.maxChars ?? 12000 });
    const files = new Set(packet.nodes.flatMap(node => node.file ? [node.file] : []));
    const tests = new Set(packet.nodes.filter(node => node.kind === "test").map(node => node.name));
    const hits = item.expectedFiles.filter(file => files.has(file)), missingFiles = item.expectedFiles.filter(file => !files.has(file));
    const missingTests = (item.expectedTests ?? []).filter(name => !tests.has(name));
    const forbiddenFiles = (item.forbiddenFiles ?? []).filter(file => files.has(file)), forbiddenTests = (item.forbiddenTests ?? []).filter(name => tests.has(name));
    return { id: item.id, files: [...files], tests: [...tests], missingFiles, missingTests, forbiddenFiles, forbiddenTests,
      expectedFileRecall: item.expectedFiles.length ? hits.length / item.expectedFiles.length : 1,
      expectedFilePrecision: files.size ? hits.length / files.size : item.expectedFiles.length ? 0 : 1,
      contextChars: JSON.stringify(packet).length, truncated: packet.truncated, passed: !missingFiles.length && !missingTests.length && !forbiddenFiles.length && !forbiddenTests.length };
  });
  return { snapshotId: snapshot.snapshotId, evidence: "reviewed-static-task-fixtures", modelExecuted: false, applicationTestsExecuted: false,
    quality: repositoryQualitySummary(snapshot), passed: results.every(item => item.passed), results };
}
