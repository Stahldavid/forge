import { posix } from "node:path";
import type { AdapterResult, AnalysisSource, RepositoryNode, RepositorySnapshot } from "./types.ts";
import { componentRootPath, repositoryGlobMatches } from "./scanner.ts";
import { emptyResult, evidence, httpPathMatches, makeEdge, makeNode } from "./adapters/common.ts";

interface DeclaredHttpClient { id: string; component: string; files?: string[]; basePath?: string; apiComponent?: string }
interface Wrapper { method?: unknown; urlTemplate?: unknown; parameterIndex?: unknown; baseKnown?: unknown; path?: unknown; origin?: unknown; requestAbsolute?: unknown }
interface ResolutionIndex {
  byId: Map<string, RepositoryNode>;
  clientsByFile: Map<string, RepositoryNode[]>;
  providedClients: Map<string, RepositoryNode[]>;
  wrappersByFileName: Map<string, RepositoryNode[]>;
  autoimportWrappers: Map<string, RepositoryNode[]>;
  fileOwners: Map<string, RepositoryNode>;
  endpointsByMethod: Map<string, RepositoryNode[]>;
  declaredClients: Map<string, DeclaredHttpClient[]>;
}

function resolutionIndex(snapshot: RepositorySnapshot): ResolutionIndex {
  const index: ResolutionIndex = { byId: new Map(snapshot.nodes.map((node) => [node.id, node])), clientsByFile: new Map(), providedClients: new Map(), wrappersByFileName: new Map(), autoimportWrappers: new Map(), fileOwners: new Map(), endpointsByMethod: new Map(), declaredClients: new Map() };
  const add = (map: Map<string, RepositoryNode[]>, key: string, value: RepositoryNode) => { const values = map.get(key) ?? []; values.push(value); map.set(key, values); };
  for (const node of snapshot.nodes) {
    if (node.kind === "file" && node.file) index.fileOwners.set(node.file, node);
    if (node.kind === "http-client") {
      if (node.file) add(index.clientsByFile, node.file, node);
      if (Array.isArray(node.metadata.providedAs)) for (const alias of node.metadata.providedAs) add(index.providedClients, `${node.component}\0${alias}`, node);
    }
    if (node.kind === "symbol" && node.metadata.exported && node.metadata.httpWrapper && node.file) add(index.wrappersByFileName, `${node.file}\0${node.name}`, node);
    if (node.kind === "endpoint") add(index.endpointsByMethod, String(node.metadata.method), node);
  }
  for (const edge of snapshot.edges) if (["calls", "references"].includes(edge.kind) && edge.metadata.association === "nuxt-static-autoimport") {
    const from = index.byId.get(edge.from); const to = index.byId.get(edge.to);
    if (from?.file && to?.metadata.httpWrapper) add(index.autoimportWrappers, `${from.file}\0${edge.metadata.offset}`, to);
  }
  for (const client of (snapshot.manifest as typeof snapshot.manifest & { httpClients?: DeclaredHttpClient[] }).httpClients ?? []) { const key = `${client.component}\0${client.id}`; const values = index.declaredClients.get(key) ?? []; values.push(client); index.declaredClients.set(key, values); }
  return index;
}

function joinedPath(base: string | undefined, path: string): string {
  return base ? `/${`${base}/${path}`.split("/").filter(Boolean).join("/")}` : path;
}

function segmentPatternMatches(endpoint: string, pattern: string, parameters: unknown): boolean {
  const expected = endpoint.replace(/\/$/, "").split("/");
  const actual = pattern.replace(/\/$/, "").split("/");
  if (expected.length !== actual.length) return false;
  const kinds = new Map(Array.isArray(parameters) ? parameters.filter((item) => item && typeof item.name === "string" && typeof item.kind === "string").map((item) => [item.name, item.kind]) : []);
  return expected.every((segment, index) => {
    const requestParameter = /^\{([A-Za-z_$][\w$]*)\}$/.exec(actual[index]);
    const endpointParameter = /^(?:\{[^{}\/]+\}|:[A-Za-z_$][\w$]*)$/.test(segment);
    if (!requestParameter) return actual[index] === segment || endpointParameter && !!actual[index];
    const kind = kinds.get(requestParameter[1]);
    if (!kind || !segment || /[*?]/.test(segment)) return false;
    if (endpointParameter) return true;
    return kind === "number" ? /^[-+]?(?:\d+(?:\.\d+)?(?:e[-+]?\d+)?|Infinity|NaN)$/i.test(segment) : kind === "encoded-string";
  });
}

function declaredClients(snapshot: RepositorySnapshot, call: RepositoryNode, index: ResolutionIndex): DeclaredHttpClient[] {
  const clients = index.declaredClients.get(`${call.component}\0${call.metadata.clientId}`) ?? [];
  const component = snapshot.manifest.components.find((component) => component.id === call.component);
  const root = componentRootPath(component?.root ?? ".");
  const relative = call.file && (root ? posix.relative(root, call.file) : call.file);
  return clients.filter((client) => client.component === call.component && client.id === call.metadata.clientId && (!client.files?.length || !!relative && client.files.some((pattern) => repositoryGlobMatches(relative, pattern))));
}

function clientModels(call: RepositoryNode, index: ResolutionIndex): RepositoryNode[] {
  if (typeof call.metadata.clientModelId === "string") { const node = index.byId.get(call.metadata.clientModelId); return node?.kind === "http-client" ? [node] : []; }
  if (typeof call.metadata.clientImportId === "string") {
    const imported = index.byId.get(call.metadata.clientImportId);
    const binding = Array.isArray(imported?.metadata.bindings) ? (imported!.metadata.bindings as { local?: string; imported?: string }[]).find((binding) => binding.local === call.metadata.clientId) : undefined;
    if (typeof imported?.metadata.resolvedFile === "string") return (index.clientsByFile.get(imported.metadata.resolvedFile) ?? []).filter((node) => node.metadata.exported && (binding?.imported === "default" ? node.metadata.defaultExport : node.name === binding?.imported));
  }
  return index.providedClients.get(`${call.component}\0${call.metadata.clientId}`) ?? [];
}

function importedWrapper(reference: RepositoryNode, index: ResolutionIndex): RepositoryNode[] {
  if (reference.kind === "import-reference") {
    const imported = index.byId.get(String(reference.metadata.importId));
    if (typeof imported?.metadata.resolvedFile === "string") return index.wrappersByFileName.get(`${imported.metadata.resolvedFile}\0${reference.metadata.imported}`) ?? [];
  }
  return index.autoimportWrappers.get(`${reference.file}\0${reference.location?.start}`) ?? [];
}

/** Adds route candidate edges using observed static client models or explicit manifest declarations. */
export function enrichHttpRepository(snapshot: RepositorySnapshot, sources: AnalysisSource[]): AdapterResult {
  const result = emptyResult();
  const sourceMap = new Map(sources.map((source) => [source.path, source]));
  const index = resolutionIndex(snapshot);
  const calls = snapshot.nodes.filter((node) => node.kind === "http-call");
  const callIds = new Set(calls.map((node) => node.id));
  for (const reference of snapshot.nodes.filter((node) => ["import-reference", "unresolved-reference"].includes(node.kind) && node.metadata.call)) {
    const wrappers = importedWrapper(reference, index);
    if (wrappers.length > 1) { result.diagnostics.push({ code: "REPOSITORY_HTTP_WRAPPER_AMBIGUOUS", severity: "warning", file: reference.file, message: `Call '${reference.name}' has multiple wrapper definitions; no HTTP model selected` }); continue; }
    const wrapper = wrappers[0]?.metadata.httpWrapper as Wrapper | undefined;
    if (!wrapper || typeof wrapper.urlTemplate !== "string" || typeof wrapper.method !== "string" || typeof wrapper.parameterIndex !== "number") continue;
    const args = reference.metadata.argumentPaths as (string | undefined)[] | undefined;
    const path = args?.[wrapper.parameterIndex] ?? (wrapper.parameterIndex === 0 && typeof reference.metadata.argumentPath === "string" ? reference.metadata.argumentPath : undefined);
    if (!path) continue;
    const source = sourceMap.get(reference.file!)!;
    const requestPath = wrapper.urlTemplate.replace(`__FORGE_URL_PARAM_${wrapper.parameterIndex}__`, path);
    const fullPath = joinedPath(typeof wrapper.path === "string" ? wrapper.path : undefined, requestPath);
    const call = makeNode(source, "http-call", `${wrapper.method} ${fullPath}`, reference.location?.start ?? 0, reference.location?.end ?? 0, { method: wrapper.method, path: fullPath, requestPath, clientId: reference.name, clientConfidence: "wrapper", baseKnown: wrapper.baseKnown, origin: wrapper.origin, wrapperId: wrappers[0].id }, `wrapper-call:${reference.id}`);
    if (callIds.has(call.id)) continue;
    callIds.add(call.id);
    call.evidence = evidence(source, "syntactic", "partial"); result.nodes.push(call); calls.push(call);
    const owner = typeof reference.metadata.owner === "string" ? reference.metadata.owner : index.fileOwners.get(reference.file!)?.id;
    if (owner) result.edges.push(makeEdge(owner, call, "calls", evidence(source)));
  }
  for (const call of calls) {
    const concrete = typeof call.metadata.path === "string";
    const pattern = !concrete && typeof call.metadata.requestPathPattern === "string";
    if ((!concrete && !pattern) || typeof call.metadata.method !== "string") continue;
    const declarations = declaredClients(snapshot, call, index);
    if (declarations.length > 1) { result.diagnostics.push({ code: "REPOSITORY_HTTP_CLIENT_AMBIGUOUS", severity: "warning", file: call.file, message: `Multiple manifest client declarations match '${call.metadata.clientId}'; no route selected` }); continue; }
    const declared = declarations[0];
    const models = clientModels(call, index);
    if (!declared && models.length > 1) { result.diagnostics.push({ code: "REPOSITORY_HTTP_CLIENT_AMBIGUOUS", severity: "warning", file: call.file, message: `Multiple static client models match '${call.metadata.clientId}'; no route selected` }); continue; }
    const model = models[0];
    const baseKnown = !!declared || call.metadata.baseKnown === true || model?.metadata.baseKnown === true;
    if (!baseKnown || call.metadata.clientConfidence === "candidate" && !model && !declared) { result.diagnostics.push({ code: "REPOSITORY_HTTP_CLIENT_UNRESOLVED", severity: "info", file: call.file, message: `Client '${call.metadata.clientId}' base or implementation remains unresolved; no route selected` }); continue; }
    const requestPath = pattern ? String(call.metadata.requestPathPattern) : typeof call.metadata.requestPath === "string" ? call.metadata.requestPath : String(call.metadata.path);
    const prefix = declared?.basePath ?? (call.metadata.clientConfidence === "candidate" && typeof model?.metadata.path === "string" ? model.metadata.path : pattern && typeof call.metadata.basePath === "string" ? call.metadata.basePath : undefined);
    const path = prefix && !call.metadata.requestAbsolute ? joinedPath(prefix, requestPath) : pattern ? requestPath : String(call.metadata.path);
    const origin = call.metadata.origin ?? model?.metadata.origin;
    if (origin && !declared?.apiComponent) { result.diagnostics.push({ code: "REPOSITORY_HTTP_EXTERNAL_ORIGIN", severity: "info", file: call.file, message: "Absolute HTTP origin has no explicit target component mapping; no local route selected" }); continue; }
    const endpoints = [...(index.endpointsByMethod.get(call.metadata.method) ?? []), ...(call.metadata.method === "ANY" ? [] : index.endpointsByMethod.get("ANY") ?? [])];
    const candidates = endpoints.filter((node) => (!declared?.apiComponent || node.component === declared.apiComponent) && (pattern ? segmentPatternMatches(String(node.metadata.path), path, call.metadata.requestPatternParameters) : httpPathMatches(String(node.metadata.path), path)));
    if (candidates.length === 1) {
      result.edges.push(makeEdge(call, candidates[0], "calls", evidence(sourceMap.get(call.file!)!, declared ? "declared" : "inferred", "partial"), { association: declared ? "manifest-http-client" : pattern ? "static-client-method-path-pattern" : "static-client-method-path", clientId: call.metadata.clientId, ...(pattern ? { pathPatternMatch: true, requestPathPattern: path } : { resolvedPath: path }), runtimeRoutingVerified: false }));
    } else if (candidates.length > 1) result.diagnostics.push({ code: "REPOSITORY_HTTP_AMBIGUOUS", severity: "warning", file: call.file, message: `${call.metadata.method} ${path} matches ${candidates.length} endpoints; no target selected` });
  }
  result.limitations.push("HTTP: local immutable expressions, literal client factories, simple returned-call wrappers and bounded whole-segment numeric/encoded parameter patterns only; patterns are navigation candidates, not concrete URLs; dynamic env/runtime bases, interceptors, arbitrary wrappers and network reachability are not evaluated");
  return result;
}
