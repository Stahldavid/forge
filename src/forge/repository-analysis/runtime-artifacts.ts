import type { RepositoryRuntimeArtifactFormat } from "../repository-manifest/types.ts";

export interface RuntimeFact {
  kind: string;
  name: string;
  component: string;
  details: Record<string, string | string[] | number | boolean>;
}
export interface RuntimeArtifactCollection { facts: RuntimeFact[]; limitations: string[] }
export const RUNTIME_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
export const RUNTIME_ARTIFACT_MAX_FACTS = 2000;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const componentId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v);
const identifier = (v: unknown): v is string => typeof v === "string" && v.length <= 256 && /^[A-Za-z_$][A-Za-z0-9_$./:@-]*$/.test(v) && !/bearer|password|secret|token|credential|api[-_]?key/i.test(v);
const safePath = (v: unknown): string | undefined => {
  if (typeof v !== "string" || v.length > 1024 || !/^\/(?!\/)[A-Za-z0-9_{}:*~.,()!+@/-]*$/.test(v) || v.split("/").includes("..") || /password|secret|token|credential|api[-_]?key/i.test(v)) return undefined;
  // Concrete IDs and opaque/high entropy segments are intentionally not retained.
  return v.split("/").map(segment => /^\d+$/.test(segment) || segment.length > 48 || /^[a-f\d]{16,}$/i.test(segment) || /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(segment) ? "{id}" : segment).join("/");
};
const sourcePath = (v: unknown): v is string => {
  if (typeof v !== "string" || v.length > 1024 || !/^(?:\.\.?\/)*[A-Za-z0-9_$@.-][A-Za-z0-9_$@./-]*$/.test(v) || /secret|credential|\.env/i.test(v)) return false;
  const containedTail = v.replace(/^(?:\.\.?\/)+/, "");
  if (containedTail.split("/").some(part => !part || part === "." || part === "..")) return false;
  return /\.(?:vue|[cm]?[jt]sx?)$/.test(v) || (/^\.\.?\//.test(v) && /^[A-Za-z0-9_$@-]+$/.test(containedTail.split("/").at(-1)!));
};
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"]);
const factFields: Record<string, readonly string[]> = {
  "nuxt-component": ["sourcePath"],
  "nuxt-import": ["sourcePath", "exportName"],
  "spring-bean": ["type", "scope", "dependencies"],
  "docker-container": ["state", "running", "service", "networks"],
  "runtime-resource": ["type", "scope", "service", "state", "exportName", "sourcePath", "dependencies", "networks", "running"],
  "spring-route": ["method", "path"],
  "http-request": ["method", "path", "status"],
};
/** Validate a saved report independently of its digest. Unknown fields never survive reload. */
export function validateRuntimeFact(value: unknown, component: string): value is RuntimeFact {
  if (!object(value) || Object.keys(value).length !== 4 || !["kind", "name", "component", "details"].every(key => Object.hasOwn(value, key)) || value.component !== component || !componentId(component) || typeof value.kind !== "string" || !Object.hasOwn(factFields, value.kind) || !object(value.details)) return false;
  const fields = factFields[value.kind]!;
  for (const [key, item] of Object.entries(value.details)) {
    if (!fields.includes(key)) return false;
    if (key === "sourcePath") { if (!sourcePath(item)) return false; }
    else if (key === "path") { if (safePath(item) !== item || typeof item !== "string") return false; }
    else if (key === "method") { if (typeof item !== "string" || !methods.has(item)) return false; }
    else if (key === "status") { if (!Number.isInteger(item) || (item as number) < 100 || (item as number) > 599) return false; }
    else if (key === "running") { if (typeof item !== "boolean") return false; }
    else if (key === "dependencies" || key === "networks") { if (!Array.isArray(item) || item.length > 32 || !item.every(identifier)) return false; }
    else if (!identifier(item)) return false;
  }
  if (value.kind === "http-request" || value.kind === "spring-route") return typeof value.details.method === "string" && typeof value.details.path === "string" && value.name === `${value.details.method} ${value.details.path}`;
  return identifier(value.name);
}

const artifactLimitations = new Set([
  "Runtime artifact exceeds bounds or has invalid component",
  "Runtime facts truncated at 2000 entries",
  "Generated declarations describe registered resources; component rendering and call execution are not observed",
  "Declaration sourcePath is relative to the artifact and is not a validated repository source link",
  "Bare package and virtual alias imports are omitted; extensionless relative declarations remain artifact-relative references",
  "Runtime artifact is malformed or exceeds structural bounds",
  "Docker state reflects the supplied inspect export; environment, labels, addresses and mounts are omitted",
  "HTTP evidence retains method, sanitized pathname and status only; origins, queries, headers and bodies are omitted",
  "Pathname segments may still identify sensitive resources; field minimization cannot guarantee removal of every opaque credential",
  "Spring mappings reflect supplied exports; handlers without explicit HTTP methods are omitted",
  "Bean exports establish registration in one environment; invocation and profile completeness are not observed",
  "Explicit runtime exports are producer-reported structural evidence, not authenticated execution traces",
  "Unsupported runtime artifact format",
  "No supported structural runtime facts found",
  "Selected structural identifiers are producer supplied; field minimization is not a guarantee of universal secret redaction",
]);
export function isRuntimeArtifactLimitation(value: unknown): value is string {
  return typeof value === "string" && artifactLimitations.has(value);
}
function boundedJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  let count = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++count > 100000 || depth > 24) throw new Error("bounded");
    if (Array.isArray(value)) for (const item of value) visit(item, depth + 1);
    else if (object(value)) for (const item of Object.values(value)) visit(item, depth + 1);
  };
  visit(parsed, 0);
  return parsed;
}

/** Pure collector. Only selected structural fields leave this boundary; raw exports never do. */
export function collectRuntimeArtifact(format: RepositoryRuntimeArtifactFormat, text: string, component: string): RuntimeArtifactCollection {
  const facts: RuntimeFact[] = [], limitations = new Set<string>(), identities = new Set<string>();
  if (!componentId(component) || typeof text !== "string" || Buffer.byteLength(text) > RUNTIME_ARTIFACT_MAX_BYTES) return { facts, limitations: ["Runtime artifact exceeds bounds or has invalid component"] };
  const add = (kind: string, name: string, details: RuntimeFact["details"]): void => {
    if (!validateRuntimeFact({ kind, name, component, details }, component)) return;
    const key = JSON.stringify([kind, name, details]);
    if (identities.has(key)) return;
    if (facts.length >= RUNTIME_ARTIFACT_MAX_FACTS) { limitations.add("Runtime facts truncated at 2000 entries"); return; }
    identities.add(key); facts.push({ kind, name, component, details });
  };
  const route = (method: unknown, rawPath: unknown, status?: unknown): void => {
    if (typeof method !== "string" || !methods.has(method.toUpperCase()) || typeof rawPath !== "string") return;
    let clean: string | undefined;
    try {
      const pathname = rawPath.startsWith("/") && !rawPath.startsWith("//") ? rawPath.split(/[?#]/)[0]! : new URL(rawPath, "http://runtime.invalid").pathname;
      clean = safePath(pathname);
    } catch { return; }
    if (!clean) return;
    const details: RuntimeFact["details"] = { method: method.toUpperCase(), path: clean };
    if (Number.isInteger(status) && (status as number) >= 100 && (status as number) <= 599) details.status = status as number;
    add(format === "http-trace" ? "http-request" : "spring-route", `${method.toUpperCase()} ${clean}`, details);
  };
  if (format === "nuxt-components" || format === "nuxt-imports") {
    if (format === "nuxt-components") {
      const pattern = /(?:^|[\s;{])['"]?([A-Za-z_$][A-Za-z0-9_$]{0,255})['"]?\s*:\s*(?:typeof\s+)?import\(['"]([^'"\r\n]{1,1024})['"]\)/g;
      for (const match of text.matchAll(pattern)) if (identifier(match[1]) && sourcePath(match[2])) add("nuxt-component", match[1], { sourcePath: match[2] });
    } else {
      const pattern = /(?:export\s*\{([^}]{1,4096})\}\s*from\s*['"]([^'"\r\n]{1,1024})['"]|(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]{0,255})\s*:\s*typeof\s+import\(['"]([^'"\r\n]{1,1024})['"]\)\[['"]([A-Za-z_$][A-Za-z0-9_$]{0,255})['"]\])/g;
      for (const match of text.matchAll(pattern)) {
        if (match[2] && sourcePath(match[2])) for (const entry of match[1]!.split(",")) { const names = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?\s*$/.exec(entry); if (names && identifier(names[1]) && identifier(names[2] ?? names[1])) add("nuxt-import", names[2] ?? names[1], { sourcePath: match[2], exportName: names[1] }); }
        else if (sourcePath(match[4]) && identifier(match[3]) && identifier(match[5])) add("nuxt-import", match[3], { sourcePath: match[4], exportName: match[5] });
      }
    }
    limitations.add("Generated declarations describe registered resources; component rendering and call execution are not observed");
    limitations.add("Declaration sourcePath is relative to the artifact and is not a validated repository source link");
    limitations.add("Bare package and virtual alias imports are omitted; extensionless relative declarations remain artifact-relative references");
  } else {
    let data: unknown;
    try { data = boundedJson(text); } catch { return { facts, limitations: ["Runtime artifact is malformed or exceeds structural bounds"] }; }
    if (format === "docker-inspect") {
      for (const container of Array.isArray(data) ? data : [data]) {
        if (!object(container)) continue;
        const name = typeof container.Name === "string" ? container.Name.replace(/^\//, "") : undefined;
        if (!identifier(name)) continue;
        const details: RuntimeFact["details"] = {};
        const state = object(container.State) ? container.State : {};
        if (identifier(state.Status)) details.state = state.Status;
        if (typeof state.Running === "boolean") details.running = state.Running;
        const config = object(container.Config) ? container.Config : {}, labels = object(config.Labels) ? config.Labels : {};
        if (identifier(labels["com.docker.compose.service"])) details.service = labels["com.docker.compose.service"];
        const settings = object(container.NetworkSettings) ? container.NetworkSettings : {}, networks = object(settings.Networks) ? settings.Networks : {};
        details.networks = Object.keys(networks).filter(identifier).slice(0, 32);
        add("docker-container", name, details);
      }
      limitations.add("Docker state reflects the supplied inspect export; environment, labels, addresses and mounts are omitted");
    } else if (format === "http-trace") {
      const log = object(data) && object(data.log) ? data.log : data;
      const entries = Array.isArray(log) ? log : object(log) && Array.isArray(log.entries) ? log.entries : [];
      for (const entry of entries) if (object(entry)) { const request = object(entry.request) ? entry.request : entry, response = object(entry.response) ? entry.response : entry; route(request.method, request.url ?? request.path, response.status); }
      limitations.add("HTTP evidence retains method, sanitized pathname and status only; origins, queries, headers and bodies are omitted");
      limitations.add("Pathname segments may still identify sensitive resources; field minimization cannot guarantee removal of every opaque credential");
    } else if (format === "spring-mappings") {
      if (object(data) && object(data.paths)) for (const [path, operations] of Object.entries(data.paths)) if (object(operations)) for (const method of Object.keys(operations)) route(method, path);
      const contexts = object(data) && object(data.contexts) ? Object.values(data.contexts) : [data];
      for (const context of contexts) {
        if (!object(context)) continue;
        const mappings = object(context.mappings) ? context.mappings : {};
        const dispatchers = [mappings.dispatcherServlets, mappings.dispatcherHandlers].flatMap(group => object(group) ? Object.values(group) : []);
        for (const entries of dispatchers) if (Array.isArray(entries)) for (const entry of entries) {
          if (!object(entry)) continue;
          const details = object(entry.details) ? entry.details : {}, conditions = object(details.requestMappingConditions) ? details.requestMappingConditions : {};
          const patterns = Array.isArray(conditions.patterns) ? conditions.patterns : [], verbs = Array.isArray(conditions.methods) ? conditions.methods : [];
          for (const path of patterns.slice(0, 32)) for (const method of verbs.slice(0, 16)) route(method, path);
        }
      }
      limitations.add("Spring mappings reflect supplied exports; handlers without explicit HTTP methods are omitted");
    } else if (format === "spring-beans") {
      const contexts = object(data) && object(data.contexts) ? Object.values(data.contexts) : [data];
      for (const context of contexts) {
        if (!object(context) || !object(context.beans)) continue;
        for (const [name, bean] of Object.entries(context.beans)) if (identifier(name) && object(bean)) {
          const details: RuntimeFact["details"] = {};
          if (identifier(bean.type)) details.type = bean.type;
          if (identifier(bean.scope)) details.scope = bean.scope;
          if (Array.isArray(bean.dependencies)) details.dependencies = bean.dependencies.filter(identifier).slice(0, 32);
          add("spring-bean", name, details);
        }
      }
      limitations.add("Bean exports establish registration in one environment; invocation and profile completeness are not observed");
    } else if (format === "forge-runtime") {
      const entries = object(data) && Array.isArray(data.facts) ? data.facts : [];
      const kinds = new Set(["nuxt-component", "nuxt-import", "spring-bean", "docker-container", "runtime-resource"]);
      for (const entry of entries) if (object(entry) && identifier(entry.name) && typeof entry.kind === "string" && kinds.has(entry.kind)) {
        // A portable explicit export may describe resource identities and relationships only.
        const details: RuntimeFact["details"] = {}, raw = object(entry.details) ? entry.details : {};
        for (const key of ["type", "scope", "service", "state", "exportName"]) if (identifier(raw[key])) details[key] = raw[key];
        if (sourcePath(raw.sourcePath)) details.sourcePath = raw.sourcePath;
        for (const key of ["dependencies", "networks"]) if (Array.isArray(raw[key])) details[key] = raw[key].filter(identifier).slice(0, 32);
        if (typeof raw.running === "boolean") details.running = raw.running;
        const selected = Object.fromEntries(Object.entries(details).filter(([key]) => factFields[entry.kind as string]!.includes(key)));
        add(entry.kind, entry.name, selected);
      }
      limitations.add("Explicit runtime exports are producer-reported structural evidence, not authenticated execution traces");
    } else return { facts, limitations: ["Unsupported runtime artifact format"] };
  }
  if (!facts.length) limitations.add("No supported structural runtime facts found");
  limitations.add("Selected structural identifiers are producer supplied; field minimization is not a guarantee of universal secret redaction");
  return { facts, limitations: [...limitations] };
}
