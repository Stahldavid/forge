import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, posix, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import type { RepositoryManifest } from "../repository-manifest/types.ts";
import { validateRepositoryManifest } from "../repository-manifest/index.ts";
import { componentRootPath, hashRepositoryFile, normalizeRepositoryPath, repositoryGlobMatches, scanRepository } from "./scanner.ts";
import { REPOSITORY_ANALYZER_VERSION } from "./types.ts";
import type { AdapterResult, AnalysisSource, RepositorySnapshot } from "./types.ts";
import { emptyResult, evidence, httpPathMatches, makeEdge, makeNode, nodeId } from "./adapters/common.ts";
import { analyzeTypeScript } from "./adapters/typescript.ts";
import { analyzeVue } from "./adapters/vue.ts";
import { analyzeJava, analyzeJavaBuild } from "./adapters/java.ts";
import { analyzeComposeScenario, analyzeDockerfile, parseCompose } from "./adapters/docker.ts";
import { repositoryScenarioHash, repositorySnapshotId, sameRepositoryPath } from "./identity.ts";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function repositoryManifestHash(manifest: RepositoryManifest): string {
  return hashRepositoryFile(JSON.stringify(canonical(manifest)));
}

interface CachedFacts { schemaVersion: 1; version: string; manifestHash: string; files: Record<string, { hash: string; resultHash: string; result: AdapterResult }> }

export interface AnalyzeRepositoryOptions { write?: boolean; cacheRoot?: string }

function analyzePackage(source: AnalysisSource): AdapterResult {
  const result = emptyResult();
  try {
    const value = JSON.parse(source.text) as { name?: string; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; workspaces?: unknown };
    const pkg = makeNode(source, "package", typeof value.name === "string" ? value.name : source.component, 0, 0, { ecosystem: "node", workspaces: Array.isArray(value.workspaces) ? value.workspaces.filter((item) => typeof item === "string") : undefined });
    pkg.evidence = evidence(source, "declared"); result.nodes.push(pkg);
    for (const name of [...new Set([...Object.keys(value.dependencies ?? {}), ...Object.keys(value.devDependencies ?? {})])].sort()) {
      const dependency = makeNode(source, "dependency", name, 0, 0, { ecosystem: "node" });
      dependency.evidence = evidence(source, "declared"); result.nodes.push(dependency); result.edges.push(makeEdge(pkg, dependency, "depends-on", evidence(source, "declared")));
    }
  } catch { result.diagnostics.push({ code: "REPOSITORY_PACKAGE_PARSE", severity: "error", file: source.path, message: "Invalid package JSON" }); }
  return result;
}

function parseSource(source: AnalysisSource): AdapterResult {
  switch (source.adapter) {
    case "typescript": return analyzeTypeScript(source);
    case "vue": return analyzeVue(source);
    case "java": return analyzeJava(source);
    case "java-build": return analyzeJavaBuild(source);
    case "docker": return basename(source.path).startsWith("Dockerfile") ? analyzeDockerfile(source) : emptyResult();
    case "package": return analyzePackage(source);
    case "configuration": {
      const result = emptyResult();
      const parsed = ts.parseConfigFileTextToJson(source.path, source.text);
      if (parsed.error) result.diagnostics.push({ code: "REPOSITORY_CONFIG_PARSE", severity: "error", file: source.path, message: "Invalid static compiler configuration JSON" });
      const config = parsed.config as { extends?: unknown; references?: unknown } | undefined;
      if (config?.extends && (typeof config.extends !== "string" || !config.extends.startsWith("."))) result.diagnostics.push({ code: "REPOSITORY_CONFIG_EXTERNAL_EXTENDS", severity: "info", file: source.path, message: "External compiler configuration is not loaded; only scanned local configuration inheritance can be resolved" });
      if (Array.isArray(config?.extends)) result.diagnostics.push({ code: "REPOSITORY_CONFIG_MULTIPLE_EXTENDS", severity: "info", file: source.path, message: "Multiple-base compiler inheritance is not expanded; direct options remain analyzable" });
      result.limitations.push("Compiler config: static single local extends/references and path aliases; multiple-base inheritance, external config packages, package exports/types and dynamic bundler aliases remain unresolved");
      return result;
    }
    default: return emptyResult();
  }
}

function sameInventory(a: AnalysisSource[], b: AnalysisSource[]): boolean {
  return a.length === b.length && a.every((source, index) => source.path === b[index].path && source.hash === b[index].hash && source.adapter === b[index].adapter && source.component === b[index].component);
}

/** Complete inventory hash check: additions/deletions and local modifications invalidate old context. */
export function validateRepositorySnapshot(root: string, snapshot: RepositorySnapshot): string[] {
  const differences: string[] = [];
  try {
    const scan = scanRepository(root, snapshot.manifest);
    if (!sameRepositoryPath(scan.root, snapshot.root)) differences.push("Repository canonical root differs from snapshot");
    if (repositoryManifestHash(snapshot.manifest) !== snapshot.manifestHash) differences.push("Snapshot manifest hash is inconsistent");
    const current = new Map(scan.sources.map((source) => [source.path, source.hash]));
    for (const [path, file] of Object.entries(snapshot.files)) {
      if (!current.has(path)) differences.push(`Deleted/excluded source: ${path}`);
      else if (current.get(path) !== file.hash) differences.push(`Changed source: ${path}`);
    }
    for (const path of current.keys()) if (!snapshot.files[path]) differences.push(`New source: ${path}`);
  } catch (error) { differences.push(error instanceof Error ? error.message : "Cannot validate repository snapshot"); }
  return differences;
}

interface StaticCompilerConfig {
  compilerOptions?: { baseUrl?: unknown; paths?: unknown };
  extends?: unknown;
  references?: { path?: unknown }[];
  include?: unknown;
  exclude?: unknown;
  files?: unknown;
}

interface CompilerConfiguration {
  file: AnalysisSource;
  baseUrl?: string;
  pathsBase: string;
  paths: Record<string, string[]>;
  include?: string[];
  exclude?: string[];
  files?: string[];
  references: string[];
}

function relativeLogicalPath(...parts: string[]): string | undefined {
  if (parts.some((part) => posix.isAbsolute(part) || /^[a-zA-Z]:/.test(part))) return undefined;
  const path = posix.normalize(posix.join(...parts));
  return path === ".." || path.startsWith("../") ? undefined : path;
}

function localConfigurationPath(config: AnalysisSource, path: string, sources: Map<string, AnalysisSource>): string | undefined {
  const candidate = relativeLogicalPath(posix.dirname(config.path), normalizeRepositoryPath(path));
  if (!candidate) return undefined;
  for (const value of [candidate, `${candidate}.json`, `${candidate}/tsconfig.json`]) if (sources.get(value)?.adapter === "configuration") return value;
  return undefined;
}

function compilerConfiguration(file: AnalysisSource, sources: Map<string, AnalysisSource>, seen = new Set<string>()): CompilerConfiguration | undefined {
  if (seen.has(file.path) || seen.size >= 32) return undefined;
  const parsed = ts.parseConfigFileTextToJson(file.path, file.text);
  if (parsed.error || !parsed.config || typeof parsed.config !== "object") return undefined;
  const config = parsed.config as StaticCompilerConfig;
  const ancestors = new Set(seen); ancestors.add(file.path);
  let inherited: CompilerConfiguration | undefined;
  const bases = typeof config.extends === "string" ? [config.extends] : [];
  for (const base of bases) {
    if (!base.startsWith(".")) continue;
    const path = localConfigurationPath(file, base, sources);
    if (path) inherited = compilerConfiguration(sources.get(path)!, sources, ancestors) ?? inherited;
  }
  const strings = (value: unknown): string[] | undefined => Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : undefined;
  let paths = inherited?.paths ?? {};
  let pathsBase = inherited?.pathsBase ?? posix.dirname(file.path);
  if (config.compilerOptions?.paths && typeof config.compilerOptions.paths === "object" && !Array.isArray(config.compilerOptions.paths)) {
    paths = Object.fromEntries(Object.entries(config.compilerOptions.paths).flatMap(([pattern, targets]) => strings(targets) ? [[pattern, targets as string[]]] : []));
    pathsBase = posix.dirname(file.path);
  }
  const baseUrl = typeof config.compilerOptions?.baseUrl === "string" ? relativeLogicalPath(posix.dirname(file.path), config.compilerOptions.baseUrl) : inherited?.baseUrl;
  const rebase = (values: unknown, prior: string[] | undefined) => strings(values)?.flatMap((path) => {
    const rebased = relativeLogicalPath(posix.dirname(file.path), path); return rebased ? [rebased] : [];
  }) ?? prior;
  return {
    file, baseUrl, pathsBase, paths,
    include: rebase(config.include, inherited?.include), exclude: rebase(config.exclude, inherited?.exclude), files: rebase(config.files, inherited?.files),
    references: Array.isArray(config.references) ? config.references.flatMap((reference) => typeof reference?.path === "string" ? [localConfigurationPath(file, reference.path, sources)].filter((value): value is string => !!value) : []) : [],
  };
}

function configurationContains(config: CompilerConfiguration, path: string): boolean {
  if (config.exclude?.some((pattern) => repositoryGlobMatches(path, pattern))) return false;
  if (config.files?.includes(path)) return true;
  if (config.include) return config.include.some((pattern) => repositoryGlobMatches(path, pattern) || path.startsWith(`${pattern}/`));
  if (config.files) return false;
  const directory = posix.dirname(config.file.path);
  return directory === "." || path.startsWith(`${directory}/`);
}

function selectedCompilerConfiguration(source: AnalysisSource, sources: Map<string, AnalysisSource>): CompilerConfiguration | undefined {
  const configs = [...sources.values()].filter((file) => file.adapter === "configuration" && /(?:^|\/)(?:tsconfig|jsconfig)(?:\.[^/]*)?\.json$/.test(file.path) && (posix.dirname(file.path) === "." || source.path.startsWith(`${posix.dirname(file.path)}/`))).sort((a, b) => posix.dirname(b.path).length - posix.dirname(a.path).length || (/^(?:tsconfig|jsconfig)\.json$/.test(basename(a.path)) ? -1 : /^(?:tsconfig|jsconfig)\.json$/.test(basename(b.path)) ? 1 : a.path.localeCompare(b.path)));
  const selected = configs[0] && compilerConfiguration(configs[0], sources);
  if (!selected) return undefined;
  if (selected.references.length) {
    const referenced = selected.references.map((path) => compilerConfiguration(sources.get(path)!, sources)).filter((config): config is CompilerConfiguration => !!config && configurationContains(config, source.path));
    if (referenced.length === 1) return referenced[0];
    // Multiple matching source sets cannot choose an alias owner safely.
    if (referenced.length > 1) return undefined;
  }
  return configurationContains(selected, source.path) ? selected : undefined;
}

function resolveImport(specifier: string, source: AnalysisSource, sources: Map<string, AnalysisSource>, config: CompilerConfiguration | undefined): string | undefined {
  const candidates: string[] = [];
  const addCandidate = (...parts: string[]) => {
    const path = relativeLogicalPath(...parts); if (path) candidates.push(path);
  };
  if (specifier.startsWith(".")) addCandidate(posix.dirname(source.path), specifier);
  else {
    if (config) {
      const patterns = Object.keys(config.paths).filter((pattern) => {
        const star = pattern.indexOf("*"); return star < 0 ? pattern === specifier : pattern.indexOf("*", star + 1) < 0 && specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
      }).sort((a, b) => a === specifier ? -1 : b === specifier ? 1 : b.indexOf("*") - a.indexOf("*") || b.length - a.length);
      for (const pattern of patterns.slice(0, 1)) {
        const replacements = config.paths[pattern];
        const star = pattern.indexOf("*");
        const captured = star < 0 ? "" : specifier.slice(star, specifier.length - (pattern.length - star - 1));
        for (const replacement of replacements) addCandidate(config.baseUrl ?? config.pathsBase, replacement.replace("*", captured));
      }
      if (!patterns.length && config.baseUrl) addCandidate(config.baseUrl, specifier);
    }
  }
  for (const candidate of candidates) for (const suffix of ["", ".ts", ".tsx", ".js", ".jsx", ".vue", "/index.ts", "/index.js"]) if (sources.has(`${candidate}${suffix}`)) return `${candidate}${suffix}`;
  // Common ESM TS imports use a .js extension while the checked-in source is .ts.
  for (const candidate of candidates) if (candidate.endsWith(".js") && sources.has(candidate.slice(0, -3) + ".ts")) return candidate.slice(0, -3) + ".ts";
  return undefined;
}

function connectFacts(snapshot: RepositorySnapshot, sources: AnalysisSource[]): void {
  const byPath = new Map(sources.map((source) => [source.path, source]));
  const fileNodes = new Map(snapshot.nodes.filter((node) => node.kind === "file").map((node) => [node.file!, node]));
  const importTargets = new Map<string, string>();
  const configurations = new Map<string, CompilerConfiguration | undefined>();
  for (const source of sources.filter((source) => source.adapter === "configuration")) {
    const raw = ts.parseConfigFileTextToJson(source.path, source.text).config as StaticCompilerConfig | undefined;
    if (typeof raw?.extends === "string" && raw.extends.startsWith(".") && !localConfigurationPath(source, raw.extends, byPath)) snapshot.coverage.diagnostics.push({ code: "REPOSITORY_CONFIG_EXTENDS_UNRESOLVED", severity: "warning", file: source.path, message: "Local compiler base configuration is missing, excluded or outside the scanned repository" });
  }
  for (const imported of snapshot.nodes.filter((node) => node.kind === "import")) {
    const source = byPath.get(imported.file!)!;
    if (!configurations.has(source.path)) configurations.set(source.path, selectedCompilerConfiguration(source, byPath));
    const path = resolveImport(String(imported.metadata.specifier), source, byPath, configurations.get(source.path));
    if (path) {
      importTargets.set(imported.id, path);
      imported.metadata.resolvedFile = path;
      snapshot.edges.push(makeEdge(fileNodes.get(source.path)!, fileNodes.get(path)!, "imports", evidence(source, "resolved", "complete")));
      for (const edge of snapshot.edges.filter((edge) => edge.to === imported.id && ["renders", "routes-to"].includes(edge.kind))) {
        const ui = snapshot.nodes.find((node) => node.file === path && node.kind === "ui-component");
        if (ui) snapshot.edges.push(makeEdge(edge.from, ui, edge.kind, evidence(source, "resolved", "complete")));
      }
    } else {
      imported.evidence.resolution = "unresolved";
      snapshot.coverage.diagnostics.push({ code: "REPOSITORY_IMPORT_UNRESOLVED", severity: "info", file: source.path, message: `Import '${imported.name}' is external, excluded or unresolved` });
    }
  }
  for (const reference of snapshot.nodes.filter((node) => node.kind === "import-reference")) {
    const path = importTargets.get(String(reference.metadata.importId));
    if (!path) continue;
    const targets = snapshot.nodes.filter((node) => node.file === path && node.kind === "symbol" && (reference.metadata.imported === "default" ? node.metadata.defaultExport : node.name === reference.metadata.imported && node.metadata.exported));
    if (targets.length === 1) snapshot.edges.push(makeEdge(String(reference.metadata.owner ?? fileNodes.get(reference.file!)!.id), targets[0], reference.metadata.call ? "calls" : "references", evidence(byPath.get(reference.file!)!, "resolved", "complete"), { binding: "static-import", offset: reference.location?.start }));
  }
  // Tests import implementation: static association, never a claim of executed coverage.
  for (const source of sources.filter((source) => /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[jt]sx?$/.test(source.path))) {
    let tests = snapshot.nodes.filter((node) => node.file === source.path && node.kind === "test");
    if (!tests.length) {
      const test = makeNode(source, "test", basename(source.path), 0, 0, { observedCoverage: false, convention: true }); test.evidence = evidence(source, "inferred"); snapshot.nodes.push(test); tests = [test];
    }
    for (const imported of snapshot.nodes.filter((node) => node.file === source.path && node.kind === "import")) {
      const target = importTargets.get(imported.id); if (!target) continue;
      for (const test of tests) snapshot.edges.push(makeEdge(test, fileNodes.get(target)!, "tests", evidence(source, "syntactic"), { observedCoverage: false, association: "static-import" }));
    }
  }
  // Java imports bind named types; method calls remain syntactic candidates, not semantic references.
  for (const imported of snapshot.nodes.filter((node) => node.kind === "java-import")) {
    const targets = snapshot.nodes.filter((node) => node.kind === "symbol" && node.metadata.qualifiedName === imported.metadata.qualifiedName);
    if (targets.length === 1) snapshot.edges.push(makeEdge(fileNodes.get(imported.file!)!, targets[0], "imports", evidence(byPath.get(imported.file!)!, "syntactic", "partial")));
  }
  for (const call of snapshot.nodes.filter((node) => node.kind === "java-call")) {
    const targets = snapshot.nodes.filter((node) => node.kind === "symbol" && node.metadata.symbolKind === "method" && node.name === call.name && node.file === call.file);
    if (targets.length === 1 && !call.metadata.qualifier) snapshot.edges.push(makeEdge(String(call.metadata.owner), targets[0], "calls", evidence(byPath.get(call.file!)!, "syntactic", "partial"), { binding: "same-file-candidate", semantic: false }));
  }
  for (const call of snapshot.nodes.filter((node) => node.kind === "http-call" && typeof node.metadata.path === "string")) {
    const candidates = snapshot.nodes.filter((node) => node.kind === "endpoint" && [call.metadata.method, "ANY"].includes(String(node.metadata.method)) && httpPathMatches(String(node.metadata.path), String(call.metadata.path)));
    // Absolute URL host/proxy routing not resolved: cross-technology route match is only a candidate.
    if (candidates.length === 1 && !call.metadata.origin) snapshot.edges.push(makeEdge(call, candidates[0], "calls", evidence(byPath.get(call.file!)!, "inferred", "partial"), { association: "unique-method-path", runtimeRoutingVerified: false }));
    else if (candidates.length > 1) snapshot.coverage.diagnostics.push({ code: "REPOSITORY_HTTP_AMBIGUOUS", severity: "warning", file: call.file, message: `${call.name} matches ${candidates.length} endpoints; no target selected` });
  }
  for (const service of snapshot.nodes.filter((node) => node.kind === "container-service" && node.metadata.build && typeof node.metadata.build === "object")) {
    const build = service.metadata.build as { context?: unknown; dockerfile?: unknown };
    if (typeof build.context !== "string" || /\$\{|^(?:https?:|git:)/.test(build.context)) continue;
    if (posix.isAbsolute(build.context) || /^[a-zA-Z]:/.test(build.context)) continue;
    const baseDirectory = typeof service.metadata.composeBaseDirectory === "string" ? service.metadata.composeBaseDirectory : posix.dirname(service.file!);
    const context = posix.normalize(posix.join(baseDirectory, build.context));
    if (context === ".." || context.startsWith("../")) continue;
    const dockerfile = posix.normalize(posix.join(context, typeof build.dockerfile === "string" ? build.dockerfile : "Dockerfile"));
    if (dockerfile === ".." || dockerfile.startsWith("../") || posix.isAbsolute(dockerfile)) continue;
    const file = fileNodes.get(dockerfile);
    if (file) snapshot.edges.push(makeEdge(service, file, "builds", evidence(byPath.get(service.file!)!, "declared", "complete")));
    const component = snapshot.manifest.components.filter((component) => {
      const componentRoot = componentRootPath(component.root);
      return componentRoot && (context === componentRoot || context.startsWith(`${componentRoot}/`));
    }).sort((a, b) => b.root.length - a.root.length)[0];
    const componentNode = component && snapshot.nodes.find((node) => node.kind === "component" && node.name === component.id);
    if (componentNode) snapshot.edges.push(makeEdge(service, componentNode, "builds", evidence(byPath.get(service.file!)!, "declared", "partial"), { association: "build-context" }));
  }
}

function safeCacheDirectory(root: string, cacheRoot?: string): string {
  const path = resolve(cacheRoot ?? resolve(root, ".forge/repository"));
  // Walk existing parents before creating anything: an artifact destination must never traverse symlinks.
  let current = path;
  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Repository cache may not use symlinked paths: ${current}`);
    const parent = dirname(current); if (parent === current) break; current = parent;
  }
  return path;
}

function readCache(path: string): CachedFacts | undefined {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) return undefined;
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object") return undefined;
    const cache = value as CachedFacts;
    return cache.schemaVersion === 1 && cache.version === REPOSITORY_ANALYZER_VERSION && cache.files && typeof cache.files === "object" ? cache : undefined;
  } catch { return undefined; }
}

function validCachedFacts(cached: CachedFacts["files"][string] | undefined, source: AnalysisSource): cached is CachedFacts["files"][string] {
  if (!cached || cached.hash !== source.hash || typeof cached.resultHash !== "string" || !cached.result || !Array.isArray(cached.result.nodes) || !Array.isArray(cached.result.edges) || !Array.isArray(cached.result.diagnostics) || !Array.isArray(cached.result.limitations)) return false;
  if (hashRepositoryFile(JSON.stringify(canonical(cached.result))) !== cached.resultHash) return false;
  const ids = new Set<string>([nodeId("file", source.path, source.path)]);
  for (const node of cached.result.nodes) {
    if (!node || typeof node.id !== "string" || typeof node.name !== "string" || typeof node.kind !== "string" || node.file !== source.path || node.component !== source.component || node.evidence?.sourceHash !== source.hash || !node.metadata || typeof node.metadata !== "object" || Array.isArray(node.metadata)) return false;
    if (node.location && (!Number.isInteger(node.location.start) || !Number.isInteger(node.location.end) || node.location.start < 0 || node.location.end < node.location.start || node.location.end > source.text.length)) return false;
    if (ids.has(node.id)) return false;
    ids.add(node.id);
  }
  for (const edge of cached.result.edges) if (!edge || typeof edge.id !== "string" || typeof edge.kind !== "string" || !ids.has(edge.from) || !ids.has(edge.to) || edge.evidence?.sourceHash !== source.hash) return false;
  return cached.result.limitations.every((value) => typeof value === "string") && cached.result.diagnostics.every((diagnostic) => diagnostic && diagnostic.file === source.path && typeof diagnostic.code === "string" && typeof diagnostic.message === "string" && ["info", "warning", "error"].includes(diagnostic.severity));
}

/** Static, multitechnology analysis; the only optional write is a cache/snapshot in the declared destination. */
export async function analyzeRepository(rootInput: string, manifest: RepositoryManifest, options: AnalyzeRepositoryOptions = {}): Promise<RepositorySnapshot> {
  const validation = validateRepositoryManifest(manifest);
  if (!validation.manifest) throw new Error(`Invalid repository manifest: ${validation.diagnostics.join("; ")}`);
  const root = realpathSync(rootInput);
  const scan = scanRepository(root, manifest);
  const cacheRoot = safeCacheDirectory(root, options.cacheRoot);
  const manifestHash = repositoryManifestHash(manifest);
  const scenarioHash = repositoryScenarioHash(manifest);
  const previous = readCache(resolve(cacheRoot, "facts.json"));
  const cache: CachedFacts = { schemaVersion: 1, version: REPOSITORY_ANALYZER_VERSION, manifestHash, files: {} };
  const snapshot: RepositorySnapshot = { schemaVersion: 1, provider: "repository", snapshotId: "", root, manifestHash, scenarioHash, createdAt: new Date().toISOString(), files: {}, nodes: [], edges: [], manifest, coverage: { found: scan.sources.length, analyzed: 0, ignored: scan.ignored.length, unsupported: 0, errors: 0, reused: 0, limitations: [], diagnostics: [...scan.diagnostics], ignoredPaths: scan.ignored } };
  for (const component of manifest.components) snapshot.nodes.push({ id: nodeId("component", root, component.id), kind: "component", name: component.id, component: component.id, evidence: { assurance: "declared", resolution: "complete", adapter: "manifest", version: REPOSITORY_ANALYZER_VERSION }, metadata: { root: component.root, adapters: component.adapters } });
  for (const source of scan.sources) {
    const file = makeNode(source, "file", source.path, 0, 0, { adapter: source.adapter }); file.evidence = evidence(source, "resolved", "complete"); snapshot.nodes.push(file);
    snapshot.edges.push(makeEdge(nodeId("component", root, source.component), file, "contains", evidence(source, "declared", "complete")));
    let facts: AdapterResult;
    const cached = previous?.manifestHash === manifestHash ? previous.files[source.path] : undefined;
    if (validCachedFacts(cached, source)) { facts = structuredClone(cached.result); snapshot.coverage.reused++; }
    else {
      try { facts = parseSource(source); }
      catch { facts = emptyResult(); facts.diagnostics.push({ code: "REPOSITORY_ADAPTER_ERROR", severity: "error", file: source.path, message: `Static ${source.adapter} analyzer failed; source omitted from facts` }); }
    }
    cache.files[source.path] = { hash: source.hash, resultHash: hashRepositoryFile(JSON.stringify(canonical(facts))), result: facts };
    snapshot.nodes.push(...structuredClone(facts.nodes)); snapshot.edges.push(...structuredClone(facts.edges)); snapshot.coverage.diagnostics.push(...facts.diagnostics); snapshot.coverage.limitations.push(...facts.limitations);
    const status = source.adapter === "unsupported" ? "unsupported" : facts.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "error" : "analyzed";
    snapshot.files[source.path] = { hash: source.hash, size: Buffer.byteLength(source.text), component: source.component, adapter: source.adapter, status };
    snapshot.coverage[status === "error" ? "errors" : status]++;
  }
  const composeSources = scan.sources.filter((source) => source.adapter === "docker" && !basename(source.path).startsWith("Dockerfile"));
  const scenarioFiles = manifest.scenario?.composeFiles;
  const selected = scenarioFiles?.length ? scenarioFiles.map((path) => composeSources.find((source) => source.path === normalizeRepositoryPath(path))) : composeSources;
  if (selected.some((source) => !source)) throw new Error("Scenario Compose file is excluded, absent or not assigned a Docker adapter");
  if (!scenarioFiles?.length && selected.length > 1) snapshot.coverage.diagnostics.push({ code: "REPOSITORY_COMPOSE_SCENARIO_IMPLICIT", severity: "warning", message: "Multiple Compose files merged in deterministic filename order; declare scenario.composeFiles to select actual overlays" });
  const compose = analyzeComposeScenario((selected as AnalysisSource[]).map(parseCompose), manifest.scenario?.profiles);
  snapshot.nodes.push(...compose.nodes); snapshot.edges.push(...compose.edges); snapshot.coverage.diagnostics.push(...compose.diagnostics); snapshot.coverage.limitations.push(...compose.limitations);
  for (const diagnostic of compose.diagnostics.filter((diagnostic) => diagnostic.severity === "error" && diagnostic.file)) {
    const file = snapshot.files[diagnostic.file!]; if (file && file.status !== "error") { snapshot.coverage.analyzed--; snapshot.coverage.errors++; file.status = "error"; }
  }
  connectFacts(snapshot, scan.sources);
  snapshot.nodes = [...new Map(snapshot.nodes.map((node) => [node.id, node])).values()].sort((a, b) => a.id.localeCompare(b.id));
  snapshot.edges = [...new Map(snapshot.edges.map((edge) => [edge.id, edge])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set(snapshot.nodes.map((node) => node.id));
  if (snapshot.edges.some((edge) => !ids.has(edge.from) || !ids.has(edge.to))) throw new Error("Repository graph has dangling node references");
  snapshot.coverage.limitations = [...new Set(snapshot.coverage.limitations)].sort();
  snapshot.coverage.diagnostics.sort((a, b) => `${a.file ?? ""}:${a.code}:${a.message}`.localeCompare(`${b.file ?? ""}:${b.code}:${b.message}`));
  snapshot.snapshotId = repositorySnapshotId(snapshot);
  const verified = scanRepository(root, manifest);
  if (!sameInventory(scan.sources, verified.sources)) throw new Error("Repository changed during analysis; no snapshot was published, retry analysis");
  if (options.write === true) {
    mkdirSync(cacheRoot, { recursive: true });
    // Exclusive cache writer; never reclaim another process's lock based only on age.
    const lock = resolve(cacheRoot, "analysis.lock");
    const lockFd = await import("node:fs").then(({ openSync }) => openSync(lock, "wx"));
    const token = randomUUID();
    const temporaryFacts = resolve(cacheRoot, `facts.${token}.tmp`);
    const temporarySnapshot = resolve(cacheRoot, `snapshot.${token}.tmp`);
    try {
      writeFileSync(lockFd, JSON.stringify({ pid: process.pid, token }));
      const finalScan = scanRepository(root, manifest);
      if (!sameInventory(scan.sources, finalScan.sources)) throw new Error("Repository changed before snapshot publication; retry analysis");
      writeFileSync(temporaryFacts, JSON.stringify(cache)); writeFileSync(temporarySnapshot, JSON.stringify(snapshot, null, 2));
      renameSync(temporaryFacts, resolve(cacheRoot, "facts.json"));
      renameSync(temporarySnapshot, resolve(cacheRoot, "snapshot.json"));
    } finally {
      const { closeSync } = await import("node:fs"); closeSync(lockFd);
      for (const path of [temporaryFacts, temporarySnapshot, lock]) if (existsSync(path)) unlinkSync(path);
    }
  }
  return snapshot;
}
