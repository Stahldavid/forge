import ts from "typescript";
import { posix } from "node:path";
import type { RepositoryManifest } from "../repository-manifest/types.ts";
import type { AdapterResult, AnalysisSource, RepositoryNode, RepositorySnapshot } from "./types.ts";
import { componentRootPath, normalizeRepositoryPath, repositoryGlobMatches } from "./scanner.ts";
import { emptyResult, evidence, makeEdge } from "./adapters/common.ts";

export interface NuxtImportResolution { file?: string; alias?: string; candidates: string[]; classification: "local" | "external" | "ambiguous" | "unresolved" }
interface ComponentDirectory { path: string; prefix: string; pathPrefix: boolean }
interface NuxtModel { component: string; root: string; source: string; aliases: Record<string, string>; declaredAliases: string[]; components: ComponentDirectory[]; imports: string[]; config?: string; diagnostics: AdapterResult["diagnostics"] }
interface ComponentAnalysis { aliases?: Record<string, string>; nuxt?: { rootDir?: string; srcDir?: string; components?: string[]; imports?: string[] } }

function localPath(base: string, value: string): string | undefined {
  if (posix.isAbsolute(value) || /^[A-Za-z]:/.test(value) || /\$\{|\0/.test(value)) return undefined;
  const path = posix.normalize(posix.join(base, normalizeRepositoryPath(value)));
  return path === ".." || path.startsWith("../") ? undefined : path;
}

function property(object: ts.ObjectLiteralExpression | undefined, name: string): ts.Expression | undefined {
  const found = object?.properties.find((item) => ts.isPropertyAssignment(item) && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && item.name.text === name);
  return found && ts.isPropertyAssignment(found) ? found.initializer : undefined;
}

function unwrap(node: ts.Expression | undefined): ts.Expression | undefined {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
}

function literal(node: ts.Expression | undefined): string | undefined {
  node = unwrap(node); return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

function object(node: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
  node = unwrap(node); return node && ts.isObjectLiteralExpression(node) ? node : undefined;
}

function literalArray(node: ts.Expression | undefined): string[] | undefined {
  node = unwrap(node); if (!node || !ts.isArrayLiteralExpression(node)) return undefined;
  const values = node.elements.map((item) => literal(item)); return values.every((item): item is string => item !== undefined) ? values : undefined;
}

function configObject(source: AnalysisSource): ts.ObjectLiteralExpression | undefined {
  const file = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
  for (const statement of file.statements) if (ts.isExportAssignment(statement)) {
    const expression = unwrap(statement.expression);
    if (expression && ts.isCallExpression(expression) && expression.expression.getText(file) === "defineNuxtConfig") return object(expression.arguments[0]);
    return object(expression);
  }
  return undefined;
}

function computeModels(sources: AnalysisSource[], manifest: RepositoryManifest): NuxtModel[] {
  return manifest.components.filter((component) => component.adapters.includes("nuxt") || sources.some((source) => source.component === component.id && /(?:^|\/)nuxt\.config\.[cm]?[jt]s$/.test(source.path))).map((component) => {
    const base = componentRootPath(component.root) || ".";
    const analysis = (component as typeof component & { analysis?: ComponentAnalysis }).analysis;
    const configSource = sources.find((source) => source.component === component.id && /(?:^|\/)nuxt\.config\.[cm]?[jt]s$/.test(source.path));
    const config = configSource && configObject(configSource);
    const diagnostics: AdapterResult["diagnostics"] = [];
    const warn = (message: string) => diagnostics.push({ code: "REPOSITORY_NUXT_CONFIG_PARTIAL", severity: "warning", file: configSource?.path, message });
    if (configSource && !config) warn("Nuxt configuration is not a supported literal export; defaults/manifest declarations used without execution");
    const spread = config?.properties.some((property) => ts.isSpreadAssignment(property));
    if (spread) warn("Spread Nuxt configuration is not evaluated; implicit directory defaults remain uncertain");
    const rootValue = analysis?.nuxt?.rootDir ?? literal(property(config, "rootDir"));
    const root = rootValue !== undefined ? localPath(base, rootValue) ?? base : base;
    if (property(config, "rootDir") && rootValue === undefined) warn("Dynamic Nuxt rootDir remains unresolved");
    const srcValue = analysis?.nuxt?.srcDir ?? literal(property(config, "srcDir"));
    let sourceRoot = srcValue !== undefined ? localPath(analysis?.nuxt?.srcDir !== undefined ? base : root, srcValue) ?? root : root;
    if (srcValue === undefined && property(config, "srcDir")) warn("Dynamic Nuxt srcDir remains unresolved");
    // Nuxt 4's app directory is selected only when the local package explicitly declares major 4.
    const pkg = sources.find((source) => source.component === component.id && source.path === posix.join(base, "package.json"));
    if (srcValue === undefined && pkg) { try { const parsed = JSON.parse(pkg.text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }; const version = parsed.dependencies?.nuxt ?? parsed.devDependencies?.nuxt; if (version && /^[~^]?4(?:\.|$)/.test(version) && sources.some((source) => source.path.startsWith(`${root === "." ? "" : `${root}/`}app/`))) sourceRoot = posix.join(root, "app"); } catch { /* package errors belong to package analyzer */ } }
    const uncertainRoot = !!property(config, "rootDir") && rootValue === undefined || !!spread && rootValue === undefined || !!configSource && !config && !analysis?.nuxt;
    const uncertainSource = uncertainRoot || !!property(config, "srcDir") && srcValue === undefined || !!spread && srcValue === undefined;
    const aliases: Record<string, string> = uncertainSource ? {} : { "~": sourceRoot, "@": sourceRoot, "~~": root, "@@": root };
    const declaredAliases = new Set(Object.keys(aliases));
    const configAliases = object(property(config, "alias"));
    for (const item of configAliases?.properties ?? []) if ((ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && (ts.isStringLiteral(item.name) || ts.isIdentifier(item.name))) {
      declaredAliases.add(item.name.text);
      const target = ts.isPropertyAssignment(item) ? literal(item.initializer) : undefined; const resolved = target !== undefined ? localPath(root, target) : undefined;
      if (resolved) aliases[item.name.text] = resolved; else { delete aliases[item.name.text]; warn(`Alias '${item.name.text}' is dynamic or outside the repository and remains unresolved`); }
    }
    for (const [name, target] of Object.entries(analysis?.aliases ?? {})) { declaredAliases.add(name); const resolved = localPath(base, target); if (resolved) aliases[name] = resolved; else delete aliases[name]; }
    const aliasPath = (path: string): string | undefined => {
      const name = [...declaredAliases].sort((a, b) => b.length - a.length).find((name) => path === name || path.startsWith(`${name}/`));
      return name ? Object.hasOwn(aliases, name) ? localPath(aliases[name], path.slice(name.length).replace(/^\//, "")) : undefined : localPath(sourceRoot, path);
    };
    const components: ComponentDirectory[] = [];
    const declared = analysis?.nuxt?.components;
    const configComponents = unwrap(property(config, "components"));
    if (declared) for (const path of declared) { const resolved = localPath(base, path); if (resolved) components.push({ path: resolved, prefix: "", pathPrefix: true }); }
    else if (configComponents?.kind !== ts.SyntaxKind.FalseKeyword) {
      let dirs: ts.Expression | undefined = configComponents;
      if (configComponents && ts.isObjectLiteralExpression(configComponents)) dirs = property(configComponents, "dirs");
      if (dirs && ts.isArrayLiteralExpression(dirs)) for (const entry of dirs.elements) {
        const settings = object(entry); const path = literal(entry) ?? literal(property(settings, "path"));
        const resolved = path !== undefined ? aliasPath(path) : undefined;
        if (resolved) components.push({ path: resolved, prefix: literal(property(settings, "prefix")) ?? "", pathPrefix: property(settings, "pathPrefix")?.kind !== ts.SyntaxKind.FalseKeyword }); else warn("Dynamic component directory remains unresolved");
      }
      else if ((!dirs || dirs.kind === ts.SyntaxKind.TrueKeyword) && !uncertainSource) components.push({ path: posix.join(sourceRoot, "components"), prefix: "", pathPrefix: true });
      else warn("Nonliteral Nuxt component discovery is not executed");
    }
    const importsSettings = object(property(config, "imports"));
    const imports = analysis?.nuxt?.imports?.flatMap((path) => { const resolved = localPath(base, path); return resolved ? [resolved] : []; }) ?? (property(importsSettings, "autoImport")?.kind === ts.SyntaxKind.FalseKeyword || uncertainSource ? [] : [posix.join(sourceRoot, "composables"), posix.join(sourceRoot, "utils"), ...(literalArray(property(importsSettings, "dirs")) ?? []).flatMap((path) => { const resolved = aliasPath(path); return resolved ? [resolved] : []; })]);
    return { component: component.id, root, source: sourceRoot, aliases, declaredAliases: [...declaredAliases], components, imports, config: configSource?.path, diagnostics };
  });
}

const modelCache = new WeakMap<AnalysisSource[], WeakMap<RepositoryManifest, NuxtModel[]>>();
const pathCache = new WeakMap<AnalysisSource[], Set<string>>();
function models(sources: AnalysisSource[], manifest: RepositoryManifest): NuxtModel[] {
  let byManifest = modelCache.get(sources); if (!byManifest) { byManifest = new WeakMap(); modelCache.set(sources, byManifest); }
  let result = byManifest.get(manifest); if (!result) { result = computeModels(sources, manifest); byManifest.set(manifest, result); }
  return result;
}

export function resolveNuxtImport(source: AnalysisSource, specifier: string, sources: AnalysisSource[], manifest: RepositoryManifest): NuxtImportResolution {
  let paths = pathCache.get(sources); if (!paths) { paths = new Set(sources.map((source) => source.path)); pathCache.set(sources, paths); }
  const model = models(sources, manifest).find((model) => model.component === source.component);
  const component = manifest.components.find((component) => component.id === source.component);
  const overrides = (component as typeof component & { analysis?: ComponentAnalysis } | undefined)?.analysis?.aliases ?? {};
  const aliases = { ...(model?.aliases ?? {}) };
  const declaredAliases = new Set([...(model?.declaredAliases ?? []), ...Object.keys(overrides)]);
  for (const [name, target] of Object.entries(overrides)) { const path = localPath(componentRootPath(component?.root ?? ".") || ".", target); if (path) aliases[name] = path; else delete aliases[name]; }
  const alias = [...declaredAliases].sort((a, b) => b.length - a.length).find((name) => specifier === name || specifier.startsWith(`${name}/`));
  if (!alias) return { candidates: [], classification: /^(?:\.|~\/|@\/|~~\/|@@\/)/.test(specifier) ? "unresolved" : "external" };
  if (!Object.hasOwn(aliases, alias)) return { alias, candidates: [], classification: "unresolved" };
  const base = localPath(aliases[alias], specifier.slice(alias.length).replace(/^\//, ""));
  if (!base) return { alias, candidates: [], classification: "unresolved" };
  const candidates = ["", ".ts", ".tsx", ".js", ".jsx", ".vue", "/index.ts", "/index.js"].map((suffix) => `${base}${suffix}`).filter((candidate) => paths.has(candidate));
  return { alias, candidates, classification: candidates.length === 1 ? "local" : candidates.length > 1 ? "ambiguous" : "unresolved", ...(candidates.length === 1 ? { file: candidates[0] } : {}) };
}

export function createNuxtImportResolver(sources: AnalysisSource[], manifest: RepositoryManifest): (source: AnalysisSource, specifier: string) => NuxtImportResolution {
  models(sources, manifest);
  return (source, specifier) => resolveNuxtImport(source, specifier, sources, manifest);
}

function componentName(file: string, directory: ComponentDirectory): string {
  const segments = (directory.pathPrefix ? posix.relative(directory.path, file).replace(/\.vue$/, "").replace(/\.(?:client|server)$/, "").split("/") : [posix.basename(file, ".vue").replace(/\.(?:client|server)$/, "")]).filter((segment) => segment.toLowerCase() !== "index");
  const words = [directory.prefix, ...segments].flatMap((segment) => segment.split(/[-_\s]+/).flatMap((word) => word.match(/[A-Z]+(?=[A-Z][a-z]|$)|[A-Z]?[a-z]+|[0-9]+/g) ?? [])).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1));
  return words.filter((word, index) => index === 0 || word !== words[index - 1]).join("");
}

function nameKey(name: string): string { return name.replace(/[-_]/g, "").toLowerCase(); }

export function enrichNuxtRepository(snapshot: RepositorySnapshot, sources: AnalysisSource[]): AdapterResult {
  const result = emptyResult();
  const byPath = new Map(sources.map((source) => [source.path, source]));
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const byComponent = new Map<string, RepositoryNode[]>();
  const fileOwners = new Map<string, RepositoryNode>();
  const uiOwners = new Map<string, RepositoryNode>();
  for (const node of snapshot.nodes) {
    const collection = byComponent.get(node.component) ?? []; collection.push(node); byComponent.set(node.component, collection);
    if (node.file && node.kind === "file") fileOwners.set(node.file, node);
    if (node.file && node.kind === "ui-component") uiOwners.set(node.file, node);
  }
  for (const model of models(sources, snapshot.manifest)) {
    result.diagnostics.push(...model.diagnostics);
    const components = new Map<string, RepositoryNode[]>();
    const local = byComponent.get(model.component) ?? [];
    const uiComponents = local.filter((node) => node.kind === "ui-component");
    for (const directory of model.components) for (const node of uiComponents.filter((node) => node.file?.startsWith(`${directory.path}/`))) {
      const name = nameKey(componentName(node.file!, directory)); components.set(name, [...(components.get(name) ?? []), node]);
    }
    const providers = new Map<string, RepositoryNode[]>();
    for (const node of local.filter((node) => node.kind === "symbol" && node.metadata.exported && node.file && model.imports.some((directory) => /[*?]/.test(directory) ? repositoryGlobMatches(node.file!, directory) || repositoryGlobMatches(node.file!, `${directory}/*`) : posix.dirname(node.file!) === directory))) providers.set(node.name, [...(providers.get(node.name) ?? []), node]);
    for (const reference of local.filter((node) => ["ui-reference", "unresolved-reference", "import-reference"].includes(node.kind))) {
      if (reference.kind === "ui-reference" && reference.metadata.dynamic) continue;
      if (reference.kind === "import-reference") {
        const imported = byId.get(String(reference.metadata.importId));
        if (!imported || !["#imports", "#components"].includes(imported.name)) continue;
      }
      const candidates = reference.kind === "ui-reference" ? components.get(nameKey(reference.name)) ?? [] : providers.get(String(reference.metadata.imported ?? reference.name)) ?? [];
      const unique = [...new Map(candidates.map((node) => [node.id, node])).values()];
      if (unique.length === 1) {
        const source = byPath.get(reference.file!)!;
        const owner = typeof reference.metadata.owner === "string" ? reference.metadata.owner : (reference.kind === "ui-reference" ? uiOwners : fileOwners).get(reference.file!)?.id ?? reference.id;
        result.edges.push(makeEdge(owner, unique[0], reference.kind === "ui-reference" ? "renders" : reference.metadata.call ? "calls" : "references", evidence(source, "inferred", "partial"), { association: "nuxt-static-autoimport", configuration: model.config ?? "manifest-or-convention", offset: reference.location?.start }));
        result.nodes.push({ ...reference, evidence: evidence(source, "inferred", "partial"), metadata: { ...reference.metadata, resolvedTo: unique[0].id, resolutionProvider: "nuxt-static-autoimport", resolved: true } });
      } else if (unique.length > 1) result.diagnostics.push({ code: "REPOSITORY_NUXT_AUTOIMPORT_AMBIGUOUS", severity: "warning", file: reference.file, message: `Autoimport '${reference.name}' has ${unique.length} local candidates; no target selected` });
      else if (reference.kind === "unresolved-reference") result.diagnostics.push({ code: "REPOSITORY_NUXT_AUTOIMPORT_EXTERNAL", severity: "info", file: reference.file, message: `Identifier '${reference.name}' has no local autoimport provider; module/global generation remains unresolved` });
      if (!unique.length) result.nodes.push({ ...reference, evidence: { ...reference.evidence, resolution: "unresolved" }, metadata: { ...reference.metadata, classification: "external-or-generated", resolved: false } });
    }
  }
  result.limitations.push("Nuxt: literal config and local conventions only; modules, layers, dynamic aliases, generated imports and runtime registration are not executed; autoimports are inferred candidates");
  return result;
}
